"use client";

import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SubmitButton from "@/components/SubmitButton";
import {
  createAdminCalendarEventFromModal,
  createAdminCalendarEventsForDates,
  updateAdminCalendarAttendance,
  updateAdminCalendarEventFromModal,
} from "./actions";
import { formatTargetMonth } from "@/lib/month";

type Profile = {
  id: string;
  name: string;
  email?: string | null;
  role: "admin" | "user";
};

type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at?: string | null;
  time_text: string | null;
  is_holiday: boolean;
  title_color: string | null;
  location_color: string | null;
  time_color: string | null;
  attendance_required: boolean;
  display_type: string | null;
};

type EventResponse = {
  id?: string;
  event_id: string;
  user_id: string;
  status: "attend" | "absent" | "pending";
  note: string | null;
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
  events: CalendarEvent[];
  responses: EventResponse[];
  profiles?: Profile[];
  members?: Profile[];
};

const fieldClass =
  "mt-1 block w-full min-w-0 max-w-full box-border rounded border border-gray-400 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500";

const weekLabels = ["月", "火", "水", "木", "金", "土", "日"];

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

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
      textAlign: "center",
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

function statusLabel(status: string | null | undefined) {
  if (status === "attend") return "〇 出席";
  if (status === "absent") return "× 欠席";
  if (status === "pending") return "△ 未定";
  return "未回答";
}

function statusClass(status: string | null | undefined) {
  if (status === "attend") return "bg-green-100 text-green-800";
  if (status === "absent") return "bg-red-100 text-red-800";
  if (status === "pending") return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-700";
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

function buildEventInput(formData: FormData) {
  const dateKey = cleanText(formData.get("date_key"));
  const title = cleanText(formData.get("title"));
  const description = cleanText(formData.get("description"));
  const location = cleanText(formData.get("location"));
  const timeText = cleanText(formData.get("time_text"));
  const titleColor = cleanText(formData.get("title_color")) || "#111827";
  const locationColor = cleanText(formData.get("location_color")) || "#111827";
  const timeColor = cleanText(formData.get("time_color")) || "#111827";
  const displayType = cleanText(formData.get("display_type")) || "normal";
  const isHoliday = formData.get("is_holiday") === "on";
  const attendanceRequired =
    displayType === "period" ? false : formData.get("attendance_required") === "on";

  return {
    dateKey,
    date_key: dateKey,
    title,
    description,
    location,
    timeText,
    time_text: timeText,
    isHoliday,
    is_holiday: isHoliday,
    titleColor,
    title_color: titleColor,
    locationColor,
    location_color: locationColor,
    timeColor,
    time_color: timeColor,
    attendanceRequired,
    attendance_required: attendanceRequired,
    displayType,
    display_type: displayType,
  };
}

export default function AdminCalendarClient({
  currentAdmin,
  targetMonth,
  currentMonth,
  prevMonth,
  nextMonth,
  todayKey,
  events,
  responses,
  profiles,
  members,
}: Props) {
  const router = useRouter();

  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedDateKeys, setSelectedDateKeys] = useState<Set<string>>(
    new Set()
  );
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isSelectionActive, setIsSelectionActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const actionLockRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const pointerDownDateRef = useRef<string | null>(null);
  const didLongPressRef = useRef(false);
  const movedTooMuchRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);

  const profileList = useMemo(() => profiles ?? members ?? [], [profiles, members]);

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();

    for (const profile of profileList) {
      map.set(profile.id, profile);
    }

    return map;
  }, [profileList]);

  const cells = useMemo(() => createCalendarCells(targetMonth), [targetMonth]);

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

  const responsesByEvent = useMemo(() => {
    const map = new Map<string, EventResponse[]>();

    for (const response of responses) {
      const list = map.get(response.event_id) ?? [];
      list.push(response);
      map.set(response.event_id, list);
    }

    return map;
  }, [responses]);

  const myResponsesByEvent = useMemo(() => {
    const map = new Map<string, EventResponse>();

    for (const response of responses) {
      if (response.user_id === currentAdmin.id) {
        map.set(response.event_id, response);
      }
    }

    return map;
  }, [responses, currentAdmin.id]);

  const selectedDateEvents = selectedDateKey
    ? eventsByDate.get(selectedDateKey) ?? []
    : [];

  const selectedEvent = selectedEventId
    ? events.find((event) => event.id === selectedEventId) ?? null
    : null;

  const selectedDateKeyList = Array.from(selectedDateKeys).sort();

  function getEventSummary(eventId: string) {
    const eventResponses = responsesByEvent.get(eventId) ?? [];

    let coachCount = 0;
    let playerCount = 0;
    let attend = 0;
    let pending = 0;
    let absent = 0;

    for (const response of eventResponses) {
      if (response.status === "attend") {
        attend += 1;

        const profile = profileById.get(response.user_id);

        if (profile?.role === "admin") {
          coachCount += 1;
        } else {
          playerCount += 1;
        }
      }

      if (response.status === "pending") pending += 1;
      if (response.status === "absent") absent += 1;
    }

    return {
      coachCount,
      playerCount,
      attend,
      pending,
      absent,
    };
  }

  function getParticipants(eventId: string, role: "admin" | "user") {
    const eventResponses = responsesByEvent.get(eventId) ?? [];

    return eventResponses
      .filter((response) => response.status === "attend")
      .map((response) => profileById.get(response.user_id))
      .filter((profile): profile is Profile => Boolean(profile))
      .filter((profile) => profile.role === role)
      .map((profile) => profile.name);
  }

function responseMark(status: string | null | undefined) {
  if (status === "attend") return "〇";
  if (status === "absent") return "×";
  if (status === "pending") return "△";
  return "未";
}

function roleLabel(role: "admin" | "user") {
  if (role === "admin") return "指導者";
  return "選手";
}

function getResponseRows(eventId: string) {
  const eventResponses = responsesByEvent.get(eventId) ?? [];
  const responseByUserId = new Map<string, EventResponse>();

  for (const response of eventResponses) {
    responseByUserId.set(response.user_id, response);
  }

  return profileList.map((profile) => {
    const response = responseByUserId.get(profile.id) ?? null;

    return {
      profile,
      response,
    };
  });
}
  
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
    setSelectedEventId(null);
    setErrorMessage("");
  }

  function closeBulkModal() {
    setIsBulkModalOpen(false);
    setSelectedDateKeys(new Set());
    setErrorMessage("");
  }

  function getDateKeyFromPoint(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    const dateElement = element?.closest(
      "[data-date-key]"
    ) as HTMLElement | null;

    return dateElement?.dataset.dateKey ?? null;
  }

  function runLockedAction(action: () => Promise<void>) {
    if (actionLockRef.current) return;

    actionLockRef.current = true;

    startTransition(async () => {
      try {
        await action();
      } finally {
        actionLockRef.current = false;
      }
    });
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
      const dayEvents = eventsByDate.get(dateKey) ?? [];
      const firstNormalEvent =
        dayEvents.find((event) => event.display_type !== "period") ?? null;

      setSelectedDateKey(dateKey);
      setSelectedEventId(firstNormalEvent?.id ?? null);
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

  function handleCreateEvent(formData: FormData) {
    setErrorMessage("");

    runLockedAction(async () => {
      try {
        const input = buildEventInput(formData);
        await createAdminCalendarEventFromModal(input as never);
        closeSingleModal();
        router.refresh();
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
    });
  }

  function handleUpdateEvent(formData: FormData) {
    setErrorMessage("");

    runLockedAction(async () => {
      try {
        const eventId = cleanText(formData.get("event_id"));
        const input = buildEventInput(formData);

        await updateAdminCalendarEventFromModal({
          ...input,
          eventId,
          event_id: eventId,
        } as never);

        closeSingleModal();
        router.refresh();
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
    });
  }

  function handleBulkCreateEvents(formData: FormData) {
    setErrorMessage("");

    runLockedAction(async () => {
      try {
        const input = buildEventInput(formData);
        const dateKeys = selectedDateKeyList;

        await createAdminCalendarEventsForDates({
          ...input,
          dateKeys,
          date_keys: dateKeys,
        } as never);

        closeBulkModal();
        router.refresh();
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
    });
  }

function handleAttendance(formData: FormData) {
  setErrorMessage("");

  runLockedAction(async () => {
    try {
      const eventId = cleanText(formData.get("event_id"));
      const status = cleanText(formData.get("status"));
      const note = cleanText(formData.get("note"));

      await updateAdminCalendarAttendance(eventId, status, note);
      
      closeSingleModal();
      router.refresh();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  });
}

function renderEventBlock(event: CalendarEvent) {
  const summary = getEventSummary(event.id);
  const myResponse = myResponsesByEvent.get(event.id);

  return (
    <div key={event.id} className="text-center">
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

      {event.attendance_required && (
        <>
        <div
          className={`mt-0.5 w-full rounded px-1 py-0.5 text-center text-[10px] font-black leading-tight ${statusClass(
            myResponse?.status
          )}`}
        >
          <span className="inline-block w-full">
            {myResponse?.status === "attend"
              ? "〇"
              : myResponse?.status === "absent"
                ? "×"
                : myResponse?.status === "pending"
                  ? "△"
                  : "未回答"}
          </span>
        </div>

          <div className="mt-0.5 text-[9px] font-bold leading-tight text-gray-800">
            <div>指導者:{summary.coachCount}人</div>
            <div>選手:{summary.playerCount}人</div>
          </div>
        </>
      )}
    </div>
  );
}

  function renderEventForm(input: {
    mode: "create" | "edit" | "bulk";
    dateKey: string;
    event?: CalendarEvent | null;
  }) {
    const eventDateKey = input.event
      ? getDateKeyFromIso(input.event.start_at)
      : input.dateKey;

    return (
      <div className="space-y-4">
        {input.mode !== "bulk" && (
          <div className="min-w-0">
            <label className="block text-sm font-bold text-gray-900">
              日付
            </label>
            <input
              name="date_key"
              type="date"
              required
              defaultValue={eventDateKey}
              className={fieldClass}
            />
          </div>
        )}

        {input.mode === "bulk" && (
          <input type="hidden" name="date_key" value={input.dateKey} />
        )}

        <div className="min-w-0">
          <label className="block text-sm font-bold text-gray-900">
            予定
          </label>
          <input
            name="title"
            required
            defaultValue={input.event?.title ?? ""}
            className={fieldClass}
            placeholder="例：通常練習"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="block text-sm font-bold text-gray-900">
              会場
            </label>
            <input
              name="location"
              defaultValue={input.event?.location ?? ""}
              className={fieldClass}
              placeholder="例：体育館"
            />
          </div>

          <div className="min-w-0">
            <label className="block text-sm font-bold text-gray-900">
              時間
            </label>
            <input
              name="time_text"
              defaultValue={input.event?.time_text ?? ""}
              className={fieldClass}
              placeholder="例：19:00-21:00"
            />
          </div>
        </div>

        <div className="min-w-0">
          <label className="block text-sm font-bold text-gray-900">
            備考
          </label>
          <textarea
            name="description"
            defaultValue={input.event?.description ?? ""}
            className={fieldClass}
            placeholder="連絡事項など"
          />
        </div>

        <details className="rounded border border-gray-300 bg-gray-50 p-4">
          <summary className="cursor-pointer font-bold text-gray-900">
            詳細設定
          </summary>

          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  予定色
                </label>
                <input
                  name="title_color"
                  type="color"
                  defaultValue={input.event?.title_color ?? "#111827"}
                  className="mt-1 h-10 w-full rounded border border-gray-400 bg-white"
                />
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  会場色
                </label>
                <input
                  name="location_color"
                  type="color"
                  defaultValue={input.event?.location_color ?? "#111827"}
                  className="mt-1 h-10 w-full rounded border border-gray-400 bg-white"
                />
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  時間色
                </label>
                <input
                  name="time_color"
                  type="color"
                  defaultValue={input.event?.time_color ?? "#111827"}
                  className="mt-1 h-10 w-full rounded border border-gray-400 bg-white"
                />
              </div>
            </div>

            <div className="min-w-0">
              <label className="block text-sm font-bold text-gray-900">
                表示形式
              </label>
              <select
                name="display_type"
                defaultValue={input.event?.display_type ?? "normal"}
                className={fieldClass}
              >
                <option value="normal">通常予定</option>
                <option value="period">期間予定・出欠不要</option>
              </select>
            </div>

            <label className="flex items-center gap-2 font-bold text-gray-900">
              <input
                name="attendance_required"
                type="checkbox"
                defaultChecked={input.event?.attendance_required ?? true}
              />
              出欠回答を必要にする
            </label>

            <label className="flex items-center gap-2 font-bold text-gray-900">
              <input
                name="is_holiday"
                type="checkbox"
                defaultChecked={input.event?.is_holiday ?? false}
              />
              祝日扱いにする
            </label>
          </div>
        </details>
      </div>
    );
  }

  function renderSelectedEventDetail(event: CalendarEvent) {
    const summary = getEventSummary(event.id);
    const myResponse = myResponsesByEvent.get(event.id);
    const coachNames = getParticipants(event.id, "admin");
    const playerNames = getParticipants(event.id, "user");

    return (
      <section className="mt-5 rounded border border-gray-300 bg-white p-4">
        <h3 className="text-lg font-bold text-gray-900">{event.title}</h3>

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
          <p className="mt-3 rounded bg-gray-50 p-3 text-sm font-medium text-gray-800">
            {event.description}
          </p>
        )}

        {event.attendance_required ? (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <div className="rounded bg-green-50 p-2">
                <p className="font-bold text-green-800">出席</p>
                <p className="font-bold text-green-900">{summary.attend}人</p>
              </div>

              <div className="rounded bg-yellow-50 p-2">
                <p className="font-bold text-yellow-800">未定</p>
                <p className="font-bold text-yellow-900">{summary.pending}人</p>
              </div>

              <div className="rounded bg-red-50 p-2">
                <p className="font-bold text-red-800">欠席</p>
                <p className="font-bold text-red-900">{summary.absent}人</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded bg-blue-50 p-2">
                <p className="font-bold text-blue-800">指導者</p>
                <p className="font-bold text-blue-900">
                  {summary.coachCount}人
                </p>
              </div>

              <div className="rounded bg-gray-50 p-2">
                <p className="font-bold text-gray-800">選手</p>
                <p className="font-bold text-gray-900">
                  {summary.playerCount}人
                </p>
              </div>
            </div>

            <form action={handleAttendance} className="mt-4 space-y-3">
              <input type="hidden" name="event_id" value={event.id} />

              <div>
                <label className="block text-sm font-bold text-gray-900">
                  自分の出欠
                </label>
                <select
                  name="status"
                  defaultValue={myResponse?.status ?? "attend"}
                  className={fieldClass}
                >
                  <option value="attend">〇 出席</option>
                  <option value="pending">△ 未定</option>
                  <option value="absent">× 欠席</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-900">
                  メモ
                </label>
                <input
                  name="note"
                  defaultValue={myResponse?.note ?? ""}
                  className={fieldClass}
                  placeholder="任意"
                />
              </div>

              <SubmitButton
                busy={isPending}
                pendingText="保存中..."
                className="w-full rounded bg-black px-4 py-3 font-bold text-white"
              >
                出欠を保存
              </SubmitButton>
            </form>

            <details className="mt-4 rounded bg-gray-50 p-3" open>
              <summary className="cursor-pointer font-bold text-gray-900">
                回答状況一覧
              </summary>
            
              <div className="mt-3 overflow-hidden rounded border border-gray-200 bg-white text-sm">
                {getResponseRows(event.id).map(({ profile, response }) => (
                  <div
                    key={profile.id}
                    className="border-b border-gray-200 p-3 last:border-b-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-gray-900">{profile.name}</p>
                        <p className="mt-0.5 text-xs font-bold text-gray-600">
                          {roleLabel(profile.role)}
                        </p>
                      </div>
            
                      <span
                        className={`shrink-0 rounded px-2 py-1 text-xs font-bold ${statusClass(
                          response?.status
                        )}`}
                      >
                        {statusLabel(response?.status)}
                      </span>
                    </div>
            
                    {response?.note ? (
                      <p className="mt-2 rounded bg-gray-50 p-2 text-xs font-medium text-gray-800">
                        備考：{response.note}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs font-medium text-gray-500">
                        備考なし
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </details>
          </>
        ) : (
          <p className="mt-4 rounded bg-gray-50 p-3 text-sm font-bold text-gray-700">
            この予定は出欠回答不要です。
          </p>
        )}

        <details className="mt-4 rounded bg-gray-50 p-3">
          <summary className="cursor-pointer font-bold text-gray-900">
            予定を編集
          </summary>

          <form action={handleUpdateEvent} className="mt-4 space-y-4">
            <input type="hidden" name="event_id" value={event.id} />
            {renderEventForm({
              mode: "edit",
              dateKey: getDateKeyFromIso(event.start_at),
              event,
            })}

            <SubmitButton
              busy={isPending}
              pendingText="保存中..."
              className="w-full rounded bg-black px-4 py-3 font-bold text-white"
            >
              予定を保存
            </SubmitButton>
          </form>
        </details>
      </section>
    );
  }

  function renderModalContents() {
    if (!selectedDateKey) return null;

    const normalEvents = selectedDateEvents.filter(
      (event) => event.display_type !== "period"
    );
    const periodEvents = selectedDateEvents.filter(
      (event) => event.display_type === "period"
    );

    return (
      <>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {formatDate(selectedDateKey)}
            </h2>
            <p className="mt-1 text-sm font-medium text-gray-700">
              予定の確認・出欠・編集を行います。
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

        {selectedDateEvents.length > 0 && (
          <section className="mt-5 rounded border border-gray-300 bg-white p-4">
            <h3 className="font-bold text-gray-900">この日の予定</h3>

            <div className="mt-3 space-y-2">
              {normalEvents.map((event) => {
                const myResponse = myResponsesByEvent.get(event.id);

                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setSelectedEventId(event.id)}
                    className={
                      selectedEventId === event.id
                        ? "w-full rounded border-2 border-black bg-gray-50 p-3 text-left"
                        : "w-full rounded border border-gray-300 bg-white p-3 text-left"
                    }
                  >
                    <p className="font-bold text-gray-900">{event.title}</p>

                    {(event.location || event.time_text) && (
                      <p className="mt-1 text-sm font-medium text-gray-700">
                        {[event.location, event.time_text]
                          .filter(Boolean)
                          .join(" / ")}
                      </p>
                    )}

                    {event.attendance_required && (
                      <span
                        className={`mt-2 inline-block rounded px-2 py-1 text-xs font-bold ${statusClass(
                          myResponse?.status
                        )}`}
                      >
                        {statusLabel(myResponse?.status)}
                      </span>
                    )}
                  </button>
                );
              })}

              {periodEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelectedEventId(event.id)}
                  className={
                    selectedEventId === event.id
                      ? "w-full rounded border-2 border-black bg-teal-50 p-3 text-left"
                      : "w-full rounded border border-teal-200 bg-teal-50 p-3 text-left"
                  }
                >
                  <p className="font-bold text-teal-900">{event.title}</p>
                  <p className="mt-1 text-xs font-bold text-teal-700">
                    期間予定・出欠不要
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {selectedEvent ? renderSelectedEventDetail(selectedEvent) : null}

        <section className="mt-5 rounded border border-gray-300 bg-white p-4">
          <details open={selectedDateEvents.length === 0}>
            <summary className="cursor-pointer font-bold text-gray-900">
              予定を追加
            </summary>

            <form action={handleCreateEvent} className="mt-4 space-y-4">
              {renderEventForm({
                mode: "create",
                dateKey: selectedDateKey,
              })}

              <SubmitButton
                busy={isPending}
                pendingText="保存中..."
                className="w-full rounded bg-black px-4 py-3 font-bold text-white"
              >
                予定を保存
              </SubmitButton>
            </form>
          </details>
        </section>
      </>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-3 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              カレンダー
            </h1>
            <p className="mt-2 text-sm font-medium text-gray-700">
              日付タップで予定確認・追加、長押しドラッグで複数日にまとめて予定登録できます。
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
                href={`/admin/calendar?month=${prevMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                前月
              </a>
              <a
                href={`/admin/calendar?month=${currentMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                今月
              </a>
              <a
                href={`/admin/calendar?month=${nextMonth}`}
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
              const dayEvents = eventsByDate.get(cell.dateKey) ?? [];
              const normalEvents = dayEvents.filter(
                (event) => event.display_type !== "period"
              );
              const periodEvents = dayEvents.filter(
                (event) => event.display_type === "period"
              );

              const weekIndex = index % 7;
              const isSaturday = weekIndex === 5;
              const isSunday = weekIndex === 6;
              const isHoliday = dayEvents.some((event) => event.is_holiday);
              const isToday = cell.dateKey === todayKey;
              const isSelected = selectedDateKeys.has(cell.dateKey);

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
                    {normalEvents.slice(0, 2).map((event) => renderEventBlock(event))}

                    {normalEvents.length > 2 && (
                      <div className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-bold text-gray-700">
                        他 {normalEvents.length - 2}件
                      </div>
                    )}
                  </div>

                  <div className="mt-auto space-y-1 pt-1">
                    {periodEvents.slice(0, 1).map((event) => (
                      <div
                        key={event.id}
                        className="rounded bg-teal-100 px-1 py-0.5 text-center text-[10px] font-bold text-teal-800"
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
      </div>

      {selectedDateKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <div className="max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-md overflow-x-hidden overflow-y-auto rounded-2xl bg-white p-4 text-gray-900 shadow-xl">
            {renderModalContents()}
          </div>
        </div>
      )}

      {isBulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <div className="max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-md overflow-x-hidden overflow-y-auto rounded-2xl bg-white p-4 text-gray-900 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  まとめて予定登録
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
              {selectedDateKeyList.map((dateKey) => (
                <div key={dateKey} className="border-b border-gray-200 py-2">
                  {formatDate(dateKey)}
                </div>
              ))}
            </div>

            <form action={handleBulkCreateEvents} className="mt-5 space-y-4">
              {selectedDateKeyList.map((dateKey) => (
                <input
                  key={dateKey}
                  type="hidden"
                  name="date_keys"
                  value={dateKey}
                />
              ))}

              {renderEventForm({
                mode: "bulk",
                dateKey: selectedDateKeyList[0] ?? todayKey,
              })}

              <SubmitButton
                busy={isPending}
                pendingText="保存中..."
                className="w-full rounded bg-black px-4 py-3 font-bold text-white"
              >
                選択日にまとめて保存
              </SubmitButton>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
