"use client";

import Link from "next/link";
import CalendarToolbar from "@/components/ui/CalendarToolbar";
import CalendarEventPreview, { AttendanceRoleIcon } from "@/components/ui/CalendarEventPreview";
import CalendarPeriodBands from "@/components/ui/CalendarPeriodBands";
import CalendarDayTimeline from "@/components/ui/CalendarDayTimeline";
import { calendarHref, compareCalendarEvents, getCalendarDays, groupCalendarPeriods, type CalendarView } from "@/lib/calendar";
import { isPullRefreshGestureActive } from "@/lib/pull-to-refresh";

import PageHeader from "@/components/ui/PageHeader";

import LogoutButton from "@/components/LogoutButton";

import type { PointerEvent as ReactPointerEvent } from "react";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import SubmitButton from "@/components/SubmitButton";
import {
  createCoachWorkLogs,
  createCoachWorkLogsForDates,
  deleteCoachWorkLog,
  updateCoachWorkLog,
} from "./actions";
import { formatTargetMonth, formatYen, getJstDateKey } from "@/lib/month";

export type Coach = {
  id: string;
  name: string;
  email: string;
  can_record?: boolean;
};

export type CoachWorkLog = {
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

export type CalendarEvent = {
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

type Props = {
  currentAdmin: {
    id: string;
    name: string;
  };
  targetMonth: string;
  view?: CalendarView;
  anchorDate?: string;
  todayKey: string;
  coaches: Coach[];
  logs: CoachWorkLog[];
  events: CalendarEvent[];
};

const fieldClass =
  "ui-field mt-1";

const weekLabels = ["月", "火", "水", "木", "金", "土", "日"];

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

function toggleDateInSet(set: Set<string>, dateKey: string) {
  const next = new Set(set);

  if (next.has(dateKey)) {
    next.delete(dateKey);
  } else {
    next.add(dateKey);
  }

  return next;
}

function WorkAdminIcon() {
  return <svg className="ui-calendar-role-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M9 5H5v16h14V5h-4M9 3h6v4H9zM8 12h8M8 16h6" /></svg>;
}

export default function CoachWorkCalendarClient({
  currentAdmin,
  targetMonth,
  todayKey,
  view = "month",
  anchorDate = targetMonth === todayKey.slice(0, 7) ? todayKey : `${targetMonth}-01`,
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
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [isSelectionActive, setIsSelectionActive] = useState(false);
  const [selectedSummaryCoachId, setSelectedSummaryCoachId] = useState<
    string | null
  >(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const actionLockRef = useRef(false);
  const pointerDownDateRef = useRef<string | null>(null);
  const isDraggingSelectionRef = useRef(false);
  const movedTooMuchRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastDraggedDateRef = useRef<string | null>(null);

  const coachNameById = useMemo(() => {
    const map = new Map<string, string>();

    for (const coach of coaches) {
      map.set(coach.id, coach.name);
    }

    return map;
  }, [coaches]);

  const cells = useMemo(() => getCalendarDays(targetMonth, view, anchorDate), [targetMonth, view, anchorDate]);
  const calendarWeeks = useMemo(() => Array.from({ length: Math.ceil(cells.length / 7) }, (_, index) => cells.slice(index * 7, index * 7 + 7)), [cells]);
  const periodGroups = useMemo(() => groupCalendarPeriods(events), [events]);
  const periodEventIds = useMemo(() => new Set(periodGroups.flatMap(group => group.events.map(event => event.id))), [periodGroups]);

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
      const dateKey = getJstDateKey(event.start_at);
      const list = map.get(dateKey) ?? [];
      list.push(event);
      map.set(dateKey, list);
    }

    for (const list of map.values()) list.sort(compareCalendarEvents);
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
      if (!log.work_date.startsWith(`${targetMonth}-`)) continue;
      const summary = map.get(log.coach_id);

      if (!summary) continue;

      summary.coachingMinutes += log.coaching_minutes;
      summary.adminMinutes += log.admin_minutes;
      summary.travelExpense += log.travel_expense;
      summary.otherExpense += log.other_expense;
      summary.count += 1;
    }

    return map;
  }, [coaches, logs, targetMonth]);

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
      .filter((log) => log.coach_id === selectedSummaryCoachId && log.work_date.startsWith(`${targetMonth}-`))
      .slice()
      .sort((a, b) => {
        const dateCompare = a.work_date.localeCompare(b.work_date);
        if (dateCompare !== 0) return dateCompare;
        return a.created_at.localeCompare(b.created_at);
      });
  }, [logs, selectedSummaryCoachId, targetMonth]);

  function resetPointerState() {
    pointerDownDateRef.current = null;
    isDraggingSelectionRef.current = false;
    movedTooMuchRef.current = false;
    startPointRef.current = null;
    lastDraggedDateRef.current = null;
    setIsSelectionActive(false);
  }

  function closeSingleModal() {
    setSelectedDateKey(null);
    setErrorMessage("");
  }

  function closeBulkModal() {
    setIsBulkModalOpen(false);
    setSelectedDateKeys(new Set());
    setIsMultiSelectMode(false);
    setErrorMessage("");
  }

  function closeSummaryModal() {
    setSelectedSummaryCoachId(null);
  }

  function clearSelectedDates() {
    setSelectedDateKeys(new Set());
    setIsMultiSelectMode(false);
    setIsBulkModalOpen(false);
    setErrorMessage("");
  }

  function handleMultiSelectModeChange() {
    setErrorMessage("");

    if (isMultiSelectMode) {
      clearSelectedDates();
      return;
    }

    setSelectedDateKey(null);
    setSelectedDateKeys(new Set());
    setIsMultiSelectMode(true);
  }

  function openBulkModal() {
    if (selectedDateKeyList.length === 0) return;

    setSelectedDateKey(null);
    setErrorMessage("");
    setIsBulkModalOpen(true);
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

    if (isMultiSelectMode) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    pointerDownDateRef.current = dateKey;
    isDraggingSelectionRef.current = false;
    movedTooMuchRef.current = false;
    lastDraggedDateRef.current = null;
    startPointRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
  }

  function handleCalendarPointerMove(
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    const startPoint = startPointRef.current;

    if (!startPoint || !pointerDownDateRef.current) return;

    const diffX = Math.abs(event.clientX - startPoint.x);
    const diffY = Math.abs(event.clientY - startPoint.y);
    const dragThreshold = event.pointerType === "touch" ? 18 : 8;

    if (!isDraggingSelectionRef.current && diffX + diffY <= dragThreshold) {
      return;
    }

    if (!isMultiSelectMode) {
      movedTooMuchRef.current = true;
      return;
    }

    if (!isDraggingSelectionRef.current) {
      isDraggingSelectionRef.current = true;
      movedTooMuchRef.current = true;
      setIsSelectionActive(true);
      lastDraggedDateRef.current = pointerDownDateRef.current;
      setSelectedDateKeys((current) =>
        addDateToSet(current, pointerDownDateRef.current as string)
      );
    }

    event.preventDefault();

    const dateKey = getDateKeyFromPoint(event.clientX, event.clientY);

    if (!dateKey) return;
    if (lastDraggedDateRef.current === dateKey) return;

    lastDraggedDateRef.current = dateKey;
    setSelectedDateKeys((current) => addDateToSet(current, dateKey));
  }

  function handleCalendarPointerUp() {
    if (isPullRefreshGestureActive()) { resetPointerState(); return; }
    const dateKey = pointerDownDateRef.current;
    const isDraggingSelection = isDraggingSelectionRef.current;
    const movedTooMuch = movedTooMuchRef.current;

    if (isMultiSelectMode && dateKey && !movedTooMuch) {
      setSelectedDateKeys((current) => toggleDateInSet(current, dateKey));
    } else if (isMultiSelectMode && isDraggingSelection) {
      setSelectedDateKey(null);
    } else if (dateKey && !movedTooMuch) {
      openDate(dateKey);
    }

    pointerDownDateRef.current = null;
    isDraggingSelectionRef.current = false;
    movedTooMuchRef.current = false;
    startPointRef.current = null;
    lastDraggedDateRef.current = null;
    setIsSelectionActive(false);
  }

  function handleCalendarPointerCancel() {
    resetPointerState();
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

  function handleCreate(formData: FormData) {
    setErrorMessage("");

    runLockedAction(async () => {
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

    runLockedAction(async () => {
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

    runLockedAction(async () => {
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

    runLockedAction(async () => {
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
        {coaches.filter(coach => coach.can_record !== false).map((coach) => (
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

  function openDate(dateKey: string) {
    if (actionLockRef.current) return;
    setErrorMessage("");
    setSelectedDateKey(dateKey);
  }

  function renderWorkTimeOnCalendar(dateKey: string) {
    const dayLogs = logsByDate.get(dateKey) ?? [];
    const myLogs = dayLogs.filter(log => log.coach_id === currentAdmin.id);
    const sum = (rows: CoachWorkLog[], field: "coaching_minutes" | "admin_minutes") => rows.reduce((total, log) => total + log[field], 0);
    const times = [
      { label: "指導", className: "is-coaching", my: sum(myLogs, "coaching_minutes"), all: sum(dayLogs, "coaching_minutes") },
      { label: "事務", className: "is-admin", my: sum(myLogs, "admin_minutes"), all: sum(dayLogs, "admin_minutes") },
    ].filter(time => time.all > 0);
    if (!times.length && !dayLogs.length) return null;
    return <div className="ui-coach-work-times" aria-label="入力済みの勤怠">
      {times.map(time => <span key={time.label} className={`ui-coach-work-time ${time.className}`} aria-label={`自分の${time.label}${formatMinutes(time.my)}、全員の${time.label}${formatMinutes(time.all)}`} title={`${time.label}：自分 ${formatMinutes(time.my)} / 全員 ${formatMinutes(time.all)}`}>
        {time.className === "is-coaching" ? <AttendanceRoleIcon role="coach" /> : <WorkAdminIcon />}
        <span>{formatHoursShort(time.my).replace(/h$/, "")}<wbr />/{formatHoursShort(time.all)}</span>
      </span>)}
      {!times.length && <span className="ui-coach-work-time">立替 {dayLogs.length}件</span>}
    </div>;
  }

  function renderEventBlock(event: CalendarEvent) {
    return <CalendarEventPreview key={event.id} event={event} showOwnStatus={false} showAttendance={false} />;
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
    <main className="ui-page ui-calendar-page ui-coach-work-page">
      <div className="ui-calendar-layout">
        <PageHeader title="指導者勤怠・立替管理" backHref="/admin" actions={<LogoutButton />} />

        <section className="ui-card ui-calendar-toolbar-card mt-5">
          <CalendarToolbar baseHref="/admin/coach-work" view={view} anchorDate={anchorDate} targetMonth={targetMonth} todayKey={todayKey}
            selectionActions={selectedDateKeyList.length > 0 ? <>
              <button type="button" onClick={openBulkModal} className="ui-button ui-button-primary">勤怠入力</button>
              <button type="button" onClick={clearSelectedDates} className="ui-button ui-button-secondary">選択解除</button>
              <span className="ui-calendar-selection-count">{selectedDateKeyList.length}日選択</span>
            </> : null}
          >
            <button type="button" onClick={handleMultiSelectModeChange} aria-pressed={isMultiSelectMode}
              className={`ui-button ${isMultiSelectMode ? "ui-button-primary" : "ui-button-secondary"}`}>
              {isMultiSelectMode ? "選択終了" : "複数登録"}
            </button>
          </CalendarToolbar>
        </section>

        <section className={`ui-calendar ui-schedule-calendar ui-calendar-view-${view} mt-5 select-none`}
          data-pull-refresh-ignore={isMultiSelectMode || isSelectionActive ? "" : undefined}
          onPointerMove={handleCalendarPointerMove} onPointerUp={handleCalendarPointerUp} onPointerCancel={handleCalendarPointerCancel}
          style={{ touchAction: isSelectionActive || isMultiSelectMode ? "none" : "pan-y" }}>
          <div className="ui-calendar-grid">
            {view !== "day" && <div className="ui-calendar-weekday-row">{weekLabels.map((label, index) => <div key={label} className={`ui-calendar-weekday ${index === 5 ? "is-saturday" : index === 6 ? "is-sunday" : ""}`}>{label}</div>)}</div>}
            {calendarWeeks.map(week => <div className="ui-calendar-week" key={week[0].dateKey}>
              <div className="ui-calendar-week-days">
                {week.map(cell => {
                  const dayEvents = eventsByDate.get(cell.dateKey) ?? [];
                  const dayLogs = logsByDate.get(cell.dateKey) ?? [];
                  const normalEvents = dayEvents.filter(event => !periodEventIds.has(event.id));
                  const isHoliday = dayEvents.some(event => event.is_holiday);
                  const isSelected = selectedDateKeys.has(cell.dateKey);
                  return <button key={cell.dateKey} type="button" data-date-key={cell.dateKey} aria-pressed={isSelected} disabled={!cell.valid}
                    aria-label={`${cell.dateKey} ${dayEvents.length}件の予定 ${dayEvents.map(event => event.title).join("、")}、勤怠${dayLogs.length}件。勤怠を入力`}
                    onPointerDown={event => handlePointerDown(event, cell.dateKey)}
                    onKeyDown={event => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      if (isMultiSelectMode) setSelectedDateKeys(current => toggleDateInSet(current, cell.dateKey));
                      else openDate(cell.dateKey);
                    }}
                    className={`ui-calendar-day ${!cell.isCurrentMonth ? "is-outside-month" : ""} ${isHoliday || cell.weekday === 0 ? "is-sunday" : cell.weekday === 6 ? "is-saturday" : ""} ${cell.dateKey === todayKey ? "is-today" : ""} ${isSelected ? "is-selected" : ""}`}>
                    <div className="ui-calendar-day-header"><span className="ui-calendar-date-number">
                      {view === "month" ? cell.day : `${Number(cell.dateKey.slice(5, 7))}/${cell.day}`}
                      {view !== "month" && <span className="ui-calendar-date-weekday">（{"日月火水木金土"[cell.weekday]}）</span>}
                    </span>{view === "day" && <span className="ui-coach-work-input-hint">勤怠を入力</span>}</div>
                    {view !== "day" && <div className="ui-calendar-day-events">
                      {normalEvents.map(renderEventBlock)}
                      {view === "week" && !dayEvents.length && <span className="ui-calendar-empty">予定なし</span>}
                    </div>}
                    {renderWorkTimeOnCalendar(cell.dateKey)}
                  </button>;
                })}
              </div>
              <CalendarPeriodBands groups={periodGroups} dateKeys={week.map(cell => cell.dateKey)} disabled={isMultiSelectMode} onSelect={dateKey => openDate(dateKey)} />
              {view === "day" && <CalendarDayTimeline events={(eventsByDate.get(anchorDate) ?? []).filter(event => !periodEventIds.has(event.id))} showAttendance={false} onSelect={() => {
                if (isMultiSelectMode) setSelectedDateKeys(current => toggleDateInSet(current, anchorDate));
                else openDate(anchorDate);
              }} />}
            </div>)}
          </div>
          <div className="ui-calendar-legend"><span><AttendanceRoleIcon role="coach" />指導</span><span><WorkAdminIcon />事務</span><span>時間：自分 / 全員</span></div>
        </section>

        <section className="ui-card mt-5">
          <h2 className="ui-section-title text-gray-900">月間集計</h2>
          <p className="ui-page-meta">{formatTargetMonth(targetMonth)}</p>

          <div className="ui-coach-work-summary-grid mt-3">
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
                  className="ui-card"
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
        <div className="ui-modal-backdrop">
          <div className="ui-modal">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="ui-section-title text-gray-900">
                  {formatDate(selectedDateKey)}
                </h2>
                <Link href={calendarHref("/admin/coach-work", "day", selectedDateKey)} onClick={closeSingleModal} className="ui-button ui-button-secondary mt-2">日表示で開く</Link>
                <p className="mt-1 text-sm font-medium text-gray-700">
                  予定を確認しながら勤怠を入力します。
                </p>
              </div>

              <button
                type="button"
                onClick={closeSingleModal}
                className="ui-icon-button"
               aria-label="閉じる">
                ×
              </button>
            </div>

            {errorMessage && (
              <div className="mt-4 rounded bg-red-100 p-3 font-bold text-red-700">
                {errorMessage}
              </div>
            )}

            <section className="ui-card mt-5">
              <h3 className="font-bold text-gray-900">この日の予定</h3>
              {renderSelectedDayEvents()}
            </section>

            <form key={`create:${selectedDateKey}`} action={handleCreate} className="mt-5 space-y-4">
              <input type="hidden" name="work_date" value={selectedDateKey} />

              {renderWorkInputFields()}

              <details className="rounded border border-gray-300 bg-gray-50 p-4">
                <summary className="cursor-pointer font-bold text-gray-900">
                  詳細設定：他の指導者も追加
                </summary>

                {renderCoachCheckboxes()}
              </details>

              <SubmitButton
                busy={isPending}
                pendingText="保存中..."
                className="ui-button ui-button-primary w-full"
              >
                保存
              </SubmitButton>
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
                                  {coaches.filter(coach => coach.can_record !== false || coach.id === log.coach_id).map((coach) => (
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

                              <SubmitButton
                                busy={isPending}
                                pendingText="修正中..."
                                className="ui-button ui-button-primary w-full"
                              >
                                修正
                              </SubmitButton>
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

                            <SubmitButton
                              busy={isPending}
                              pendingText="削除中..."
                              className="ui-button ui-button-danger h-full w-full"
                            >
                              削除
                            </SubmitButton>
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
        <div className="ui-modal-backdrop">
          <div className="ui-modal">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="ui-section-title text-gray-900">
                  まとめて勤怠入力
                </h2>
                <p className="mt-1 text-sm font-medium text-gray-700">
                  選択日数：{selectedDateKeyList.length}日
                </p>
              </div>

              <button
                type="button"
                onClick={closeBulkModal}
                className="ui-icon-button"
               aria-label="閉じる">
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

              <SubmitButton
                busy={isPending}
                pendingText="保存中..."
                className="ui-button ui-button-primary w-full"
              >
                選択日にまとめて保存
              </SubmitButton>
            </form>
          </div>
        </div>
      )}

      {selectedSummaryCoach && (
        <div className="ui-modal-backdrop">
          <div className="ui-modal">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="ui-section-title text-gray-900">
                  {selectedSummaryCoach.name} の登録詳細
                </h2>
                <p className="mt-1 text-sm font-medium text-gray-700">
                  {formatTargetMonth(targetMonth)} の勤怠・立替記録
                </p>
              </div>

              <button
                type="button"
                onClick={closeSummaryModal}
                className="ui-icon-button"
               aria-label="閉じる">
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
                      className="ui-card"
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
