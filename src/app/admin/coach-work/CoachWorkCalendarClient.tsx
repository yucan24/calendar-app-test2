"use client";

import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCoachWorkLogs,
  createCoachWorkLogsForDates,
  deleteCoachWorkLog,
  updateCoachWorkLog,
} from "./actions";
import { formatTargetMonth, formatYen } from "@/lib/month";

type Coach = {
  id: string;
  name: string;
  email: string;
};

type CoachWorkLog = {
  id: string;
  batch_id: string;
  coach_id: string;
  entered_by: string | null;
  work_date: string;
  coaching_minutes: number;
  admin_minutes: number;
  travel_expense: number;
  other_expense: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  time_text: string | null;
  is_holiday: boolean;
  title_color: string | null;
  location_color: string | null;
  time_color: string | null;
  attendance_required: boolean;
  display_type: string | null;
};

type CalendarCell = {
  dateKey: string;
  day: number;
  isCurrentMonth: boolean;
};

type Props = {
  currentAdmin: {
    id: string;
    name: string;
  };
  targetMonth: string;
  currentMonth: string;
  prevMonth: string;
  nextMonth: string;
  todayKey: string;
  coaches: Coach[];
  logs: CoachWorkLog[];
  events: CalendarEvent[];
};

const fieldClass =
  "mt-1 block w-full min-w-0 max-w-full box-border rounded border border-gray-400 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500";

const weekLabels = ["月", "火", "水", "木", "金", "土", "日"];

function makeDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}

function createCalendarCells(targetMonth: string): CalendarCell[] {
  const [year, month] = targetMonth.split("-").map(Number);

  const firstDate = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0);
  const firstWeekIndex = (firstDate.getDay() + 6) % 7;
  const daysInMonth = lastDate.getDate();

  const cells: CalendarCell[] = [];

  const prevLastDate = new Date(year, month - 1, 0);
  const prevDaysInMonth = prevLastDate.getDate();

  for (let i = firstWeekIndex - 1; i >= 0; i--) {
    const day = prevDaysInMonth - i;
    const prevMonthDate = new Date(year, month - 2, day);

    cells.push({
      dateKey: makeDateKey(
        prevMonthDate.getFullYear(),
        prevMonthDate.getMonth() + 1,
        prevMonthDate.getDate()
      ),
      day,
      isCurrentMonth: false,
    });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({
      dateKey: makeDateKey(year, month, day),
      day,
      isCurrentMonth: true,
    });
  }

  let nextDay = 1;

  while (cells.length % 7 !== 0) {
    const nextMonthDate = new Date(year, month, nextDay);

    cells.push({
      dateKey: makeDateKey(
        nextMonthDate.getFullYear(),
        nextMonthDate.getMonth() + 1,
        nextMonthDate.getDate()
      ),
      day: nextDay,
      isCurrentMonth: false,
    });

    nextDay++;
  }

  return cells;
}

function getDateKeyFromIso(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  if (hours === 0 && minutes === 0) return "0時間";
  if (minutes === 0) return `${hours}時間`;
  if (hours === 0) return `${minutes}分`;

  return `${hours}時間${minutes}分`;
}

function formatHoursShort(value: number) {
  const hours = value / 60;

  if (hours === 0) return "0h";

  const rounded = Math.round(hours * 100) / 100;

  if (Number.isInteger(rounded)) {
    return `${rounded}h`;
  }

  return `${rounded}h`;
}

function formatHoursInputValue(minutes: number) {
  const hours = minutes / 60;

  if (Number.isInteger(hours)) {
    return String(hours);
  }

  return String(Math.round(hours * 100) / 100);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "処理に失敗しました";
}

function addDateToSet(set: Set<string>, dateKey: string) {
  const next = new Set(set);
  next.add(dateKey);
  return next;
}

function visualLength(value: string | null | undefined) {
  const text = String(value ?? "").replace(/\s+/g, "");
  let count = 0;

  for (const char of Array.from(text)) {
    count += /^[\x20-\x7E]$/.test(char) ? 0.5 : 1;
  }

  return count;
}

function displayText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("\n");
}

function isTimeLikeText(value: string | null | undefined) {
  const text = String(value ?? "").trim();

  return /^\d{1,2}[:：]\d{2}\s*[-ー－〜~]\s*\d{1,2}[:：]\d{2}$/.test(
    text
  );
}

function calendarTextStyle(
  value: string | null | undefined,
  color: string | null | undefined
): CSSProperties {
  const text = displayText(value);
  const length = visualLength(text);
  const hasLineBreak = text.includes("\n");
  const isTimeText = isTimeLikeText(text);

  if (isTimeText) {
    return {
      color: color || "#111827",
      display: "block",
      width: "100%",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "clip",
      fontSize: "8.5px",
      lineHeight: "1.08",
      letterSpacing: "-0.03em",
      transform: "none",
      fontVariantNumeric: "tabular-nums",
    };
  }

  if (!hasLineBreak && length <= 5) {
    const fontSize = length <= 4 ? "10.2px" : "8.6px";
    const letterSpacing = length >= 5 ? "-0.14em" : "-0.04em";

    return {
      color: color || "#111827",
      display: "block",
      width: "100%",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "clip",
      fontSize,
      lineHeight: "1.08",
      letterSpacing,
      transform: "none",
      transformOrigin: "center",
    };
  }

  return {
    color: color || "#111827",
    display: "-webkit-box",
    overflow: "hidden",
    whiteSpace: "pre-line",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    fontSize: length >= 12 ? "8px" : length >= 8 ? "8.5px" : "9px",
    lineHeight: "1.1",
    letterSpacing: length >= 10 ? "-0.06em" : "-0.03em",
  };
}

export default function CoachWorkCalendarClient({
  currentAdmin,
  targetMonth,
  currentMonth,
  prevMonth,
  nextMonth,
  todayKey,
  coaches,
  logs,
  events,
}: Props) {
  const router = useRouter();

  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [selectedDateKeys, setSelectedDateKeys] = useState<Set<string>>(
    new Set()
  );
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isSelectionActive, setIsSelectionActive] = useState(false);
  const [selectedSummaryCoachId, setSelectedSummaryCoachId] = useState<
    string | null
  >(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const longPressTimerRef = useRef<number | null>(null);
  const pointerDownDateRef = useRef<string | null>(null);
  const didLongPressRef = useRef(false);
  const movedTooMuchRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);

  const coachNameById = useMemo(() => {
    const map = new Map<string, string>();

    for (const coach of coaches) {
      map.set(coach.id, coach.name);
    }

    return map;
  }, [coaches]);

  const cells = useMemo(() => createCalendarCells(targetMonth), [targetMonth]);

  const logsByDate = useMemo(() => {
    const map = new Map<string, CoachWorkLog[]>();

    for (const log of logs) {
      const list = map.get(log.work_date) ?? [];
      list.push(log);
      map.set(log.work_date, list);
    }

    return map;
  }, [logs]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();

    for (const event of events) {
      const dateKey = getDateKeyFromIso(event.start_at);
      const list = map.get(dateKey) ?? [];
      list.push(event);
      map.set(dateKey, list);
    }

    return map;
  }, [events]);

  const monthlySummaryByCoach = useMemo(() => {
    const map = new Map<
      string,
      {
        coachingMinutes: number;
        adminMinutes: number;
        travelExpense: number;
        otherExpense: number;
        count: number;
      }
    >();

    for (const coach of coaches) {
      map.set(coach.id, {
        coachingMinutes: 0,
        adminMinutes: 0,
        travelExpense: 0,
        otherExpense: 0,
        count: 0,
      });
    }

    for (const log of logs) {
      const summary = map.get(log.coach_id);

      if (!summary) continue;

      summary.coachingMinutes += log.coaching_minutes;
      summary.adminMinutes += log.admin_minutes;
      summary.travelExpense += log.travel_expense;
      summary.otherExpense += log.other_expense;
      summary.count += 1;
    }

    return map;
  }, [coaches, logs]);

  const selectedLogs = selectedDateKey
    ? logsByDate.get(selectedDateKey) ?? []
    : [];

  const selectedEvents = selectedDateKey
    ? eventsByDate.get(selectedDateKey) ?? []
    : [];

  const selectedDateKeyList = Array.from(selectedDateKeys).sort();

  const selectedSummaryCoach = selectedSummaryCoachId
    ? coaches.find((coach) => coach.id === selectedSummaryCoachId) ?? null
    : null;

  const selectedSummaryLogs = useMemo(() => {
    if (!selectedSummaryCoachId) return [];

    return logs
      .filter((log) => log.coach_id === selectedSummaryCoachId)
      .slice()
      .sort((a, b) => {
        const dateCompare = a.work_date.localeCompare(b.work_date);
        if (dateCompare !== 0) return dateCompare;
        return a.created_at.localeCompare(b.created_at);
      });
  }, [logs, selectedSummaryCoachId]);

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function resetPointerState() {
    clearLongPressTimer();
    pointerDownDateRef.current = null;
    didLongPressRef.current = false;
    movedTooMuchRef.current = false;
    startPointRef.current = null;
    setIsSelectionActive(false);
  }

  function closeSingleModal() {
    setSelectedDateKey(null);
    setErrorMessage("");
  }

  function closeBulkModal() {
    setIsBulkModalOpen(false);
    setSelectedDateKeys(new Set());
    setErrorMessage("");
  }

  function closeSummaryModal() {
    setSelectedSummaryCoachId(null);
  }

  function getDateKeyFromPoint(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    const dateElement = element?.closest(
      "[data-date-key]"
    ) as HTMLElement | null;

    return dateElement?.dataset.dateKey ?? null;
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    dateKey: string
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    setErrorMessage("");
    clearLongPressTimer();

    pointerDownDateRef.current = dateKey;
    didLongPressRef.current = false;
    movedTooMuchRef.current = false;
    startPointRef.current = {
      x: event.clientX,
      y: event.clientY,
    };

    longPressTimerRef.current = window.setTimeout(() => {
      didLongPressRef.current = true;
      setIsSelectionActive(true);
      setSelectedDateKeys(new Set([dateKey]));
    }, 450);
  }

  function handleCalendarPointerMove(
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    const startPoint = startPointRef.current;

    if (!startPoint || !pointerDownDateRef.current) return;

    const diffX = Math.abs(event.clientX - startPoint.x);
    const diffY = Math.abs(event.clientY - startPoint.y);

    if (!didLongPressRef.current && diffX + diffY > 12) {
      movedTooMuchRef.current = true;
      clearLongPressTimer();
      return;
    }

    if (!didLongPressRef.current) return;

    event.preventDefault();

    const dateKey = getDateKeyFromPoint(event.clientX, event.clientY);

    if (!dateKey) return;

    setSelectedDateKeys((current) => addDateToSet(current, dateKey));
  }

  function handleCalendarPointerUp() {
    const dateKey = pointerDownDateRef.current;
    const didLongPress = didLongPressRef.current;
    const movedTooMuch = movedTooMuchRef.current;

    clearLongPressTimer();

    if (didLongPress) {
      setIsBulkModalOpen(true);
    } else if (dateKey && !movedTooMuch) {
      setSelectedDateKey(dateKey);
    }

    pointerDownDateRef.current = null;
    didLongPressRef.current = false;
    movedTooMuchRef.current = false;
    startPointRef.current = null;
    setIsSelectionActive(false);
  }

  function handleCalendarPointerCancel() {
    resetPointerState();
  }

  function handleCreate(formData: FormData) {
    setErrorMessage("");

    startTransition(async () => {
      try {
        await createCoachWorkLogs(formData);
        closeSingleModal();
        router.refresh();
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
    });
  }

  function handleBulkCreate(formData: FormData) {
    setErrorMessage("");

    startTransition(async () => {
      try {
        await createCoachWorkLogsForDates(formData);
        closeBulkModal();
        router.refresh();
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
    });
  }

  function handleUpdate(formData: FormData) {
    setErrorMessage("");

    startTransition(async () => {
      try {
        await updateCoachWorkLog(formData);
        closeSingleModal();
        router.refresh();
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
    });
  }

  function handleDelete(formData: FormData) {
    setErrorMessage("");

    startTransition(async () => {
      try {
        await deleteCoachWorkLog(formData);
        closeSingleModal();
        router.refresh();
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
    });
  }

  function renderCoachCheckboxes() {
    return (
      <div className="mt-3 grid gap-2">
        {coaches.map((coach) => (
          <label
            key={coach.id}
            className="flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-900"
          >
            <input
              name="coach_ids"
              type="checkbox"
              value={coach.id}
              defaultChecked={coach.id === currentAdmin.id}
            />
            {coach.name}
          </label>
        ))}
      </div>
    );
  }

  function renderWorkInputFields() {
    return (
      <>
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="block text-sm font-bold text-gray-900">
              指導時間
            </label>
            <input
              name="coaching_hours"
              type="number"
              min={0}
              step="0.25"
              defaultValue={0}
              className={fieldClass}
              placeholder="例：2 / 1.5"
            />
            <p className="mt-1 text-xs font-medium text-gray-700">
              30分は 0.5、15分は 0.25
            </p>
          </div>

          <div className="min-w-0">
            <label className="block text-sm font-bold text-gray-900">
              事務作業時間
            </label>
            <input
              name="admin_hours"
              type="number"
              min={0}
              step="0.25"
              defaultValue={0}
              className={fieldClass}
              placeholder="例：1 / 0.5"
            />
            <p className="mt-1 text-xs font-medium text-gray-700">
              30分は 0.5、15分は 0.25
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="block text-sm font-bold text-gray-900">
              交通費
            </label>
            <input
              name="travel_expense"
              type="number"
              min={0}
              defaultValue={0}
              className={fieldClass}
            />
          </div>

          <div className="min-w-0">
            <label className="block text-sm font-bold text-gray-900">
              その他立替
            </label>
            <input
              name="other_expense"
              type="number"
              min={0}
              defaultValue={0}
              className={fieldClass}
            />
          </div>
        </div>

        <div className="min-w-0">
          <label className="block text-sm font-bold text-gray-900">備考</label>
          <textarea
            name="note"
            className={fieldClass}
            placeholder="例：交通費内訳、立替内容、代理入力など"
          />
        </div>
      </>
    );
  }

  function renderWorkTimeOnCalendar(input: {
    myCoachingTotal: number;
    allCoachingTotal: number;
    myAdminTotal: number;
    allAdminTotal: number;
  }) {
    if (input.allCoachingTotal === 0 && input.allAdminTotal === 0) {
      return null;
    }

    return (
      <div className="mt-1 space-y-0.5">
        {input.allCoachingTotal > 0 && (
          <div className="rounded bg-blue-50 px-1 py-0.5 text-[9px] font-bold leading-tight text-blue-800">
            指:{formatHoursShort(input.myCoachingTotal)}
            <br />(全
            {formatHoursShort(input.allCoachingTotal)})
          </div>
        )}

        {input.allAdminTotal > 0 && (
          <div className="rounded bg-purple-50 px-1 py-0.5 text-[9px] font-bold leading-tight text-purple-800">
            事:{formatHoursShort(input.myAdminTotal)}
            <br />(全
            {formatHoursShort(input.allAdminTotal)})
          </div>
        )}
      </div>
    );
  }

  function renderEventBlock(event: CalendarEvent) {
    return (
      <div key={event.id}>
        <div style={calendarTextStyle(event.title, event.title_color)}>
          {displayText(event.title)}
        </div>

        {event.location && (
          <div style={calendarTextStyle(event.location, event.location_color)}>
            {displayText(event.location)}
          </div>
        )}

        {event.time_text && (
          <div style={calendarTextStyle(event.time_text, event.time_color)}>
            {displayText(event.time_text)}
          </div>
        )}
      </div>
    );
  }

  function renderSelectedDayEvents() {
    if (selectedEvents.length === 0) {
      return (
        <p className="mt-2 rounded bg-gray-50 p-3 text-sm font-medium text-gray-700">
          この日の予定はありません。
        </p>
      );
    }

    return (
      <div className="mt-3 space-y-2">
        {selectedEvents.map((event) => (
          <div
            key={event.id}
            className="rounded border border-gray-300 bg-gray-50 p-3"
          >
            <p className="font-bold text-gray-900">{event.title}</p>

            {event.location && (
              <p className="mt-1 text-sm font-medium text-gray-700">
                会場：{event.location}
              </p>
            )}

            {event.time_text && (
              <p className="mt-1 text-sm font-medium text-gray-700">
                時間：{event.time_text}
              </p>
            )}

            {event.description && (
              <p className="mt-2 rounded bg-white p-2 text-sm font-medium text-gray-800">
                {event.description}
              </p>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-3 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              指導者勤怠・立替管理
            </h1>
            <p className="mt-2 text-sm font-medium text-gray-700">
              予定を確認しながら、日付タップで勤怠を入力できます。
            </p>
          </div>

          <div className="flex gap-2">
            <a
              href="/admin"
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
            >
              管理者画面に戻る
            </a>
            <a
              href="/logout"
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
            >
              ログアウト
            </a>
          </div>
        </div>

        <section className="mt-5 rounded-lg bg-white p-4 shadow">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              {formatTargetMonth(targetMonth)}
            </h2>

            <div className="flex gap-2">
              <a
                href={`/admin/coach-work?month=${prevMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                前月
              </a>
              <a
                href={`/admin/coach-work?month=${currentMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                今月
              </a>
              <a
                href={`/admin/coach-work?month=${nextMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                翌月
              </a>
            </div>
          </div>
        </section>

        <section
          className="mt-5 select-none overflow-hidden rounded-lg bg-gray-300 shadow"
          onPointerMove={handleCalendarPointerMove}
          onPointerUp={handleCalendarPointerUp}
          onPointerCancel={handleCalendarPointerCancel}
          style={{ touchAction: isSelectionActive ? "none" : "pan-y" }}
        >
          <div className="grid grid-cols-7 gap-px bg-gray-300">
            {weekLabels.map((label, index) => (
              <div
                key={label}
                className={
                  index === 5
                    ? "bg-blue-50 py-2 text-center text-sm font-bold text-blue-700"
                    : index === 6
                      ? "bg-red-50 py-2 text-center text-sm font-bold text-red-700"
                      : "bg-white py-2 text-center text-sm font-bold text-gray-900"
                }
              >
                {label}
              </div>
            ))}

            {cells.map((cell, index) => {
              const dayLogs = logsByDate.get(cell.dateKey) ?? [];
              const dayEvents = eventsByDate.get(cell.dateKey) ?? [];

              const normalEvents = dayEvents.filter(
                (event) => event.display_type !== "period"
              );
              const periodEvents = dayEvents.filter(
                (event) => event.display_type === "period"
              );

              const allCoachingTotal = dayLogs.reduce(
                (sum, log) => sum + log.coaching_minutes,
                0
              );
              const allAdminTotal = dayLogs.reduce(
                (sum, log) => sum + log.admin_minutes,
                0
              );

              const myLogs = dayLogs.filter(
                (log) => log.coach_id === currentAdmin.id
              );

              const myCoachingTotal = myLogs.reduce(
                (sum, log) => sum + log.coaching_minutes,
                0
              );
              const myAdminTotal = myLogs.reduce(
                (sum, log) => sum + log.admin_minutes,
                0
              );

              const isToday = cell.dateKey === todayKey;
              const isSelected = selectedDateKeys.has(cell.dateKey);
              const weekIndex = index % 7;
              const isSaturday = weekIndex === 5;
              const isSunday = weekIndex === 6;
              const isHoliday = dayEvents.some((event) => event.is_holiday);

              const dateColorClass = !cell.isCurrentMonth
                ? "text-gray-400"
                : isSunday || isHoliday
                  ? "text-red-600"
                  : isSaturday
                    ? "text-blue-600"
                    : "text-gray-900";

              return (
                <button
                  key={cell.dateKey}
                  type="button"
                  data-date-key={cell.dateKey}
                  onPointerDown={(event) =>
                    handlePointerDown(event, cell.dateKey)
                  }
                  className={
                    cell.isCurrentMonth
                      ? "flex min-h-32 flex-col bg-white p-1 text-left align-top"
                      : "flex min-h-32 flex-col bg-gray-100 p-1 text-left align-top text-gray-400"
                  }
                  style={
                    isSelected
                      ? { boxShadow: "inset 0 0 0 2px #facc15" }
                      : undefined
                  }
                >
                  <div
                    className={
                      isToday
                        ? `inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-black text-sm font-bold ${dateColorClass}`
                        : `inline-flex h-7 w-7 items-center justify-center text-sm font-bold ${dateColorClass}`
                    }
                  >
                    {cell.day}
                  </div>

                  <div className="mt-1 space-y-1">
                    {normalEvents.slice(0, 2).map((event) =>
                      renderEventBlock(event)
                    )}

                    {normalEvents.length > 2 && (
                      <div className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-bold text-gray-700">
                        他 {normalEvents.length - 2}件
                      </div>
                    )}

                    {renderWorkTimeOnCalendar({
                      myCoachingTotal,
                      allCoachingTotal,
                      myAdminTotal,
                      allAdminTotal,
                    })}
                  </div>

                  <div className="mt-auto space-y-1 pt-1">
                    {periodEvents.slice(0, 1).map((event) => (
                      <div
                        key={event.id}
                        className="rounded bg-teal-100 px-1 py-0.5 text-[10px] font-bold text-teal-800"
                      >
                        {displayText(event.title)}
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-5 rounded-lg bg-white p-4 shadow">
          <h2 className="text-lg font-bold text-gray-900">月間集計</h2>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {coaches.map((coach) => {
              const summary = monthlySummaryByCoach.get(coach.id);
              const coachingMinutes = summary?.coachingMinutes ?? 0;
              const adminMinutes = summary?.adminMinutes ?? 0;
              const travelExpense = summary?.travelExpense ?? 0;
              const otherExpense = summary?.otherExpense ?? 0;
              const totalExpense = travelExpense + otherExpense;

              return (
                <article
                  key={coach.id}
                  className="rounded border border-gray-300 bg-white p-3"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedSummaryCoachId(coach.id)}
                    className="text-left text-lg font-bold text-gray-900 underline decoration-gray-400 underline-offset-4"
                  >
                    {coach.name}
                  </button>

                  <p className="mt-1 text-xs font-medium text-gray-600">
                    名前を押すと登録内容の詳細を確認できます。
                  </p>

                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded bg-blue-50 p-2">
                      <p className="font-bold text-blue-800">指導時間</p>
                      <p className="font-bold text-blue-900">
                        {formatMinutes(coachingMinutes)}
                      </p>
                    </div>

                    <div className="rounded bg-purple-50 p-2">
                      <p className="font-bold text-purple-800">事務作業</p>
                      <p className="font-bold text-purple-900">
                        {formatMinutes(adminMinutes)}
                      </p>
                    </div>

                    <div className="rounded bg-gray-50 p-2">
                      <p className="font-bold text-gray-800">交通費</p>
                      <p className="font-bold text-gray-900">
                        {formatYen(travelExpense)}
                      </p>
                    </div>

                    <div className="rounded bg-red-50 p-2">
                      <p className="font-bold text-red-800">立替合計</p>
                      <p className="font-bold text-red-900">
                        {formatYen(totalExpense)}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {selectedDateKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <div className="max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-md overflow-x-hidden overflow-y-auto rounded-2xl bg-white p-4 text-gray-900 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {formatDate(selectedDateKey)}
                </h2>
                <p className="mt-1 text-sm font-medium text-gray-700">
                  予定を確認しながら勤怠を入力します。
                </p>
              </div>

              <button
                type="button"
                onClick={closeSingleModal}
                className="rounded bg-gray-200 px-3 py-1 font-bold text-gray-900"
              >
                ×
              </button>
            </div>

            {errorMessage && (
              <div className="mt-4 rounded bg-red-100 p-3 font-bold text-red-700">
                {errorMessage}
              </div>
            )}

            <section className="mt-5 rounded border border-gray-300 bg-white p-4">
              <h3 className="font-bold text-gray-900">この日の予定</h3>
              {renderSelectedDayEvents()}
            </section>

            <form action={handleCreate} className="mt-5 space-y-4">
              <input type="hidden" name="work_date" value={selectedDateKey} />

              {renderWorkInputFields()}

              <details className="rounded border border-gray-300 bg-gray-50 p-4">
                <summary className="cursor-pointer font-bold text-gray-900">
                  詳細設定：他の指導者も追加
                </summary>

                {renderCoachCheckboxes()}
              </details>

              <button
                disabled={isPending}
                className="w-full rounded bg-black px-4 py-3 font-bold text-white disabled:opacity-50"
              >
                保存
              </button>
            </form>

            <div className="mt-6">
              <h3 className="font-bold text-gray-900">この日の入力済み</h3>

              {selectedLogs.length === 0 ? (
                <p className="mt-2 rounded bg-gray-50 p-3 text-sm font-medium text-gray-700">
                  この日の勤怠記録はありません。
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {selectedLogs.map((log) => {
                    const coachName =
                      coachNameById.get(log.coach_id) ?? "不明な指導者";

                    const enteredByName = log.entered_by
                      ? coachNameById.get(log.entered_by) ?? "不明"
                      : "不明";

                    return (
                      <div
                        key={log.id}
                        className="rounded border border-gray-300 bg-white p-4"
                      >
                        <h4 className="text-lg font-bold text-gray-900">
                          {coachName}
                        </h4>
                        <p className="mt-1 text-sm font-medium text-gray-700">
                          入力者：{enteredByName}
                        </p>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                          <div className="rounded bg-blue-50 p-2">
                            <p className="font-bold text-blue-800">指導</p>
                            <p className="font-bold text-blue-900">
                              {formatMinutes(log.coaching_minutes)}
                            </p>
                          </div>

                          <div className="rounded bg-purple-50 p-2">
                            <p className="font-bold text-purple-800">事務</p>
                            <p className="font-bold text-purple-900">
                              {formatMinutes(log.admin_minutes)}
                            </p>
                          </div>

                          <div className="rounded bg-gray-50 p-2">
                            <p className="font-bold text-gray-800">交通費</p>
                            <p className="font-bold text-gray-900">
                              {formatYen(log.travel_expense)}
                            </p>
                          </div>

                          <div className="rounded bg-red-50 p-2">
                            <p className="font-bold text-red-800">その他</p>
                            <p className="font-bold text-red-900">
                              {formatYen(log.other_expense)}
                            </p>
                          </div>
                        </div>

                        {log.note && (
                          <p className="mt-3 rounded bg-gray-50 p-2 text-sm font-medium text-gray-800">
                            備考：{log.note}
                          </p>
                        )}

                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <details className="rounded bg-gray-50 p-3">
                            <summary className="cursor-pointer font-bold text-gray-900">
                              修正
                            </summary>

                            <form
                              action={handleUpdate}
                              className="mt-3 space-y-3"
                            >
                              <input
                                type="hidden"
                                name="log_id"
                                value={log.id}
                              />

                              <input
                                type="hidden"
                                name="work_date"
                                value={selectedDateKey}
                              />

                              <div className="min-w-0">
                                <label className="block text-sm font-bold text-gray-900">
                                  対象指導者
                                </label>
                                <select
                                  name="coach_id"
                                  defaultValue={log.coach_id}
                                  className={fieldClass}
                                >
                                  {coaches.map((coach) => (
                                    <option key={coach.id} value={coach.id}>
                                      {coach.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div className="min-w-0">
                                  <label className="block text-sm font-bold text-gray-900">
                                    指導時間
                                  </label>
                                  <input
                                    name="coaching_hours"
                                    type="number"
                                    min={0}
                                    step="0.25"
                                    defaultValue={formatHoursInputValue(
                                      log.coaching_minutes
                                    )}
                                    className={fieldClass}
                                  />
                                </div>

                                <div className="min-w-0">
                                  <label className="block text-sm font-bold text-gray-900">
                                    事務作業時間
                                  </label>
                                  <input
                                    name="admin_hours"
                                    type="number"
                                    min={0}
                                    step="0.25"
                                    defaultValue={formatHoursInputValue(
                                      log.admin_minutes
                                    )}
                                    className={fieldClass}
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  name="travel_expense"
                                  type="number"
                                  min={0}
                                  defaultValue={log.travel_expense}
                                  className={fieldClass}
                                />
                                <input
                                  name="other_expense"
                                  type="number"
                                  min={0}
                                  defaultValue={log.other_expense}
                                  className={fieldClass}
                                />
                              </div>

                              <textarea
                                name="note"
                                defaultValue={log.note ?? ""}
                                className={fieldClass}
                              />

                              <button
                                disabled={isPending}
                                className="w-full rounded bg-black px-4 py-3 font-bold text-white disabled:opacity-50"
                              >
                                修正
                              </button>
                            </form>
                          </details>

                          <form
                            action={handleDelete}
                            onSubmit={(event) => {
                              if (
                                !window.confirm("この勤怠記録を削除しますか？")
                              ) {
                                event.preventDefault();
                              }
                            }}
                          >
                            <input type="hidden" name="log_id" value={log.id} />
                            <button
                              disabled={isPending}
                              className="h-full w-full rounded bg-red-600 px-4 py-3 font-bold text-white disabled:opacity-50"
                            >
                              削除
                            </button>
                          </form>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isBulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <div className="max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-md overflow-x-hidden overflow-y-auto rounded-2xl bg-white p-4 text-gray-900 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  まとめて勤怠入力
                </h2>
                <p className="mt-1 text-sm font-medium text-gray-700">
                  選択日数：{selectedDateKeyList.length}日
                </p>
              </div>

              <button
                type="button"
                onClick={closeBulkModal}
                className="rounded bg-gray-200 px-3 py-1 font-bold text-gray-900"
              >
                ×
              </button>
            </div>

            {errorMessage && (
              <div className="mt-4 rounded bg-red-100 p-3 font-bold text-red-700">
                {errorMessage}
              </div>
            )}

            <div className="mt-4 max-h-28 overflow-y-auto rounded bg-gray-50 p-3 text-sm font-bold text-gray-900">
              {selectedDateKeyList.map((dateKey) => {
                const dayEvents = eventsByDate.get(dateKey) ?? [];

                return (
                  <div key={dateKey} className="border-b border-gray-200 py-2">
                    <div>{formatDate(dateKey)}</div>
                    {dayEvents.length > 0 && (
                      <div className="mt-1 text-xs font-medium text-gray-700">
                        {dayEvents.map((event) => event.title).join(" / ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <form action={handleBulkCreate} className="mt-5 space-y-4">
              {selectedDateKeyList.map((dateKey) => (
                <input
                  key={dateKey}
                  type="hidden"
                  name="date_keys"
                  value={dateKey}
                />
              ))}

              {renderWorkInputFields()}

              <details
                open
                className="rounded border border-gray-300 bg-gray-50 p-4"
              >
                <summary className="cursor-pointer font-bold text-gray-900">
                  対象指導者
                </summary>

                {renderCoachCheckboxes()}
              </details>

              <button
                disabled={isPending}
                className="w-full rounded bg-black px-4 py-3 font-bold text-white disabled:opacity-50"
              >
                選択日にまとめて保存
              </button>
            </form>
          </div>
        </div>
      )}

      {selectedSummaryCoach && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <div className="max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-md overflow-y-auto rounded-2xl bg-white p-4 text-gray-900 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {selectedSummaryCoach.name} の登録詳細
                </h2>
                <p className="mt-1 text-sm font-medium text-gray-700">
                  {formatTargetMonth(targetMonth)} の勤怠・立替記録
                </p>
              </div>

              <button
                type="button"
                onClick={closeSummaryModal}
                className="rounded bg-gray-200 px-3 py-1 font-bold text-gray-900"
              >
                ×
              </button>
            </div>

            {selectedSummaryLogs.length === 0 ? (
              <p className="mt-4 rounded bg-gray-50 p-3 text-sm font-medium text-gray-700">
                この月の登録はありません。
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {selectedSummaryLogs.map((log) => {
                  const dayEvents = eventsByDate.get(log.work_date) ?? [];
                  const enteredByName = log.entered_by
                    ? coachNameById.get(log.entered_by) ?? "不明"
                    : "不明";

                  return (
                    <article
                      key={log.id}
                      className="rounded border border-gray-300 bg-white p-4"
                    >
                      <h3 className="font-bold text-gray-900">
                        {formatDate(log.work_date)}
                      </h3>

                      {dayEvents.length > 0 && (
                        <div className="mt-2 rounded bg-gray-50 p-2 text-sm font-medium text-gray-800">
                          <p className="font-bold text-gray-900">予定</p>
                          {dayEvents.map((event) => (
                            <div key={event.id} className="mt-1">
                              {event.title}
                              {event.location ? ` / ${event.location}` : ""}
                              {event.time_text ? ` / ${event.time_text}` : ""}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded bg-blue-50 p-2">
                          <p className="font-bold text-blue-800">指導</p>
                          <p className="font-bold text-blue-900">
                            {formatMinutes(log.coaching_minutes)}
                          </p>
                        </div>

                        <div className="rounded bg-purple-50 p-2">
                          <p className="font-bold text-purple-800">事務</p>
                          <p className="font-bold text-purple-900">
                            {formatMinutes(log.admin_minutes)}
                          </p>
                        </div>

                        <div className="rounded bg-gray-50 p-2">
                          <p className="font-bold text-gray-800">交通費</p>
                          <p className="font-bold text-gray-900">
                            {formatYen(log.travel_expense)}
                          </p>
                        </div>

                        <div className="rounded bg-red-50 p-2">
                          <p className="font-bold text-red-800">その他</p>
                          <p className="font-bold text-red-900">
                            {formatYen(log.other_expense)}
                          </p>
                        </div>
                      </div>

                      {log.note && (
                        <p className="mt-3 rounded bg-gray-50 p-2 text-sm font-medium text-gray-800">
                          備考：{log.note}
                        </p>
                      )}

                      <p className="mt-2 text-xs font-medium text-gray-600">
                        入力者：{enteredByName}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}