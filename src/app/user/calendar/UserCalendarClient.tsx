"use client";

import CalendarPeriodBands from "@/components/ui/CalendarPeriodBands";
import CalendarToolbar from "@/components/ui/CalendarToolbar";
import CalendarDayTimeline from "@/components/ui/CalendarDayTimeline";
import { isPullRefreshGestureActive } from "@/lib/pull-to-refresh";
import CalendarEventPreview, { CalendarAttendanceLegend, OwnAttendance } from "@/components/ui/CalendarEventPreview";
import { groupCalendarPeriods, calendarHref, compareCalendarEvents, getCalendarDays, summarizeAttendance, type CalendarView } from "@/lib/calendar";

import Link from "next/link";

import PageHeader from "@/components/ui/PageHeader";

import LogoutButton from "@/components/LogoutButton";

import type { PointerEvent as ReactPointerEvent } from "react";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SubmitButton from "@/components/SubmitButton";
import { updateUserCalendarAttendance } from "./actions";

type CurrentUser = {
  id: string;
  name: string;
};

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

type Props = {
  currentUser?: CurrentUser;
  currentProfile?: CurrentUser;
  targetMonth: string;
  view?: CalendarView;
  anchorDate?: string;
  todayKey: string;
  events: CalendarEvent[];
  responses: EventResponse[];
  profiles?: Profile[];
  members?: Profile[];
};

const fieldClass =
  "ui-field mt-1";

const weekLabels = ["月", "火", "水", "木", "金", "土", "日"];

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
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

function toggleDateInSet(set: Set<string>, dateKey: string) {
  const next = new Set(set);

  if (next.has(dateKey)) {
    next.delete(dateKey);
  } else {
    next.add(dateKey);
  }

  return next;
}

export default function UserCalendarClient({
  currentUser: currentUserProp,
  currentProfile,
  targetMonth,
  view = "month",
  todayKey,
  anchorDate = todayKey.startsWith(targetMonth) ? todayKey : `${targetMonth}-01`,
  events,
  responses,
  profiles,
  members,
}: Props) {
  const router = useRouter();
  const currentUser = currentUserProp ?? currentProfile;
  const currentUserId = currentUser?.id ?? "";

  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedDateKeys, setSelectedDateKeys] = useState<Set<string>>(
    new Set()
  );
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [isSelectionActive, setIsSelectionActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const actionLockRef = useRef(false);
  const pointerDownEventRef = useRef<string | null>(null);
  const pointerDownDateRef = useRef<string | null>(null);
  const isDraggingSelectionRef = useRef(false);
  const movedTooMuchRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastDraggedDateRef = useRef<string | null>(null);

  const profileList = useMemo(
    () => profiles ?? members ?? [],
    [profiles, members]
  );

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>();

    for (const profile of profileList) {
      map.set(profile.id, profile);
    }

    return map;
  }, [profileList]);

  const cells = useMemo(() => getCalendarDays(targetMonth, view, anchorDate), [targetMonth, view, anchorDate]);

  const calendarWeeks = useMemo(() => Array.from({ length: Math.ceil(cells.length / 7) }, (_, index) => cells.slice(index * 7, index * 7 + 7)), [cells]);
  const periodGroups = useMemo(() => groupCalendarPeriods(events), [events]);
  const periodEventIds = useMemo(() => new Set(periodGroups.flatMap(group => group.events.map(event => event.id))), [periodGroups]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();

    for (const event of events) {
      const dateKey = getDateKeyFromIso(event.start_at);
      const list = map.get(dateKey) ?? [];
      list.push(event);
      map.set(dateKey, list);
    }

    for (const list of map.values()) list.sort(compareCalendarEvents);
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

    if (!currentUserId) return map;

    for (const response of responses) {
      if (response.user_id === currentUserId) {
        map.set(response.event_id, response);
      }
    }

    return map;
  }, [responses, currentUserId]);

  const selectedDateEvents = selectedDateKey
    ? eventsByDate.get(selectedDateKey) ?? []
    : [];

  const selectedEvent = selectedEventId
    ? events.find((event) => event.id === selectedEventId) ?? null
    : null;

  const selectedDateKeyList = Array.from(selectedDateKeys).sort();

  const selectedBulkEvents = selectedDateKeyList.flatMap((dateKey) =>
    (eventsByDate.get(dateKey) ?? []).filter(
      (event) => event.attendance_required && event.display_type !== "period"
    )
  );

  if (!currentUser) {
    return (
      <main className="ui-page ui-calendar-page">
        <p className="rounded bg-white p-4 font-bold text-red-700 shadow">
          ログイン情報が見つかりません。
        </p>
      </main>
    );
  }

  function getEventSummary(eventId: string) {
    return summarizeAttendance(responsesByEvent.get(eventId) ?? [], profileById);
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
    setSelectedEventId(null);
    setErrorMessage("");
  }

  function selectEvent(eventId: string | null, dateKey = selectedDateKey) {
    if (actionLockRef.current) return;
    setErrorMessage("");
    setSelectedDateKey(dateKey);
    setSelectedEventId(eventId);
  }

  function closeBulkModal() {
    setIsBulkModalOpen(false);
    setSelectedDateKeys(new Set());
    setIsMultiSelectMode(false);
    setErrorMessage("");
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
    setSelectedEventId(null);
    setSelectedDateKeys(new Set());
    setIsMultiSelectMode(true);
  }

  function openBulkModal() {
    if (selectedDateKeyList.length === 0) return;

    setSelectedDateKey(null);
    setSelectedEventId(null);
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

    if (isMultiSelectMode) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    pointerDownEventRef.current = (event.target as HTMLElement | undefined)?.closest?.<HTMLElement>("[data-event-id]")?.dataset.eventId ?? null;
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
      setSelectedEventId(null);
    } else if (dateKey && !movedTooMuch) {
      const dayEvents = eventsByDate.get(dateKey) ?? [];
      const firstNormalEvent =
        dayEvents.find((event) => event.display_type !== "period") ?? null;

      selectEvent(pointerDownEventRef.current ?? firstNormalEvent?.id ?? null, dateKey);
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

  async function saveAttendance(input: {
    eventId: string;
    status: string;
    note: string;
  }) {
    await updateUserCalendarAttendance({
      eventId: input.eventId,
      event_id: input.eventId,
      status: input.status,
      note: input.note,
    });
  }

  function handleAttendance(formData: FormData) {
    setErrorMessage("");

    runLockedAction(async () => {
      try {
        const eventId = cleanText(formData.get("event_id"));
        const status = cleanText(formData.get("status"));
        const note = cleanText(formData.get("note"));

        await saveAttendance({
          eventId,
          status,
          note,
        });

        closeSingleModal();
        router.refresh();
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
    });
  }

  function handleBulkAttendance(formData: FormData) {
    setErrorMessage("");

    runLockedAction(async () => {
      try {
        const eventIds = formData
          .getAll("event_ids")
          .map((value) => String(value).trim())
          .filter(Boolean);

        const status = cleanText(formData.get("status"));
        const note = cleanText(formData.get("note"));

        if (eventIds.length === 0) {
          throw new Error("出欠回答できる予定がありません");
        }

        for (const eventId of eventIds) {
          await saveAttendance({
            eventId,
            status,
            note,
          });
        }

        closeBulkModal();
        router.refresh();
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
    });
  }

  function renderEventBlock(event: CalendarEvent, showOwnStatus: boolean) {
    return <CalendarEventPreview key={event.id} event={event} summary={getEventSummary(event.id)} ownStatus={myResponsesByEvent.get(event.id)?.status} showOwnStatus={showOwnStatus} />;
  }

  function renderSelectedEventDetail(event: CalendarEvent) {
    const summary = getEventSummary(event.id);
    const periodGroup = periodGroups.find(group => group.events.some(item => item.id === event.id));
    const myResponse = myResponsesByEvent.get(event.id);
    const coachNames = getParticipants(event.id, "admin");
    const playerNames = getParticipants(event.id, "user");

    return (
      <section className="ui-card mt-5">
        <h3 className="text-lg font-bold text-gray-900">{event.title}</h3>

        {periodGroup && periodGroup.events.length > 1 && <nav aria-label="期間予定の日付" className="ui-calendar-period-dates">
          {periodGroup.events.map(item => {
            const dateKey = getDateKeyFromIso(item.start_at);
            return <button key={item.id} type="button" className={`ui-button ${item.id === event.id ? "ui-button-primary" : "ui-button-secondary"}`} aria-pressed={item.id === event.id} onClick={() => {
              selectEvent(item.id, dateKey);
            }}>{Number(dateKey.slice(5, 7))}/{Number(dateKey.slice(8))}</button>;
          })}
        </nav>}

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

            <form key={`attendance:${event.id}`} action={handleAttendance} className="mt-4 space-y-3">
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
                className="ui-button ui-button-primary w-full"
              >
                出欠を保存
              </SubmitButton>
            </form>

            <details className="mt-4 rounded bg-gray-50 p-3">
              <summary className="cursor-pointer font-bold text-gray-900">
                参加者一覧
              </summary>

              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <p className="font-bold text-gray-900">指導者</p>
                  <p className="mt-1 font-medium text-gray-700">
                    {coachNames.length > 0 ? coachNames.join("、") : "なし"}
                  </p>
                </div>

                <div>
                  <p className="font-bold text-gray-900">選手</p>
                  <p className="mt-1 font-medium text-gray-700">
                    {playerNames.length > 0 ? playerNames.join("、") : "なし"}
                  </p>
                </div>
              </div>
            </details>
          </>
        ) : (
          <p className="mt-4 rounded bg-gray-50 p-3 text-sm font-bold text-gray-700">
            この予定は出欠回答不要です。
          </p>
        )}
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
            <h2 className="ui-section-title text-gray-900">
              {formatDate(selectedDateKey)}
            </h2>
            <Link href={calendarHref("/user/calendar", "day", selectedDateKey)} onClick={closeSingleModal} className="ui-button ui-button-secondary mt-2">日表示で開く</Link>
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

        {selectedDateEvents.length === 0 ? (
          <p className="mt-5 rounded bg-gray-50 p-4 font-medium text-gray-700">
            この日の予定はありません。
          </p>
        ) : (
          <section className="ui-card mt-5">
            <h3 className="font-bold text-gray-900">この日の予定</h3>

            <div className="mt-3 space-y-2">
              {normalEvents.map((event) => {
                const myResponse = myResponsesByEvent.get(event.id);

                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => selectEvent(event.id)}
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
                  onClick={() => selectEvent(event.id)}
                  className={
                    selectedEventId === event.id
                      ? "w-full rounded border-2 border-black bg-teal-50 p-3 text-left"
                      : "w-full rounded border border-teal-200 bg-teal-50 p-3 text-left"
                  }
                >
                  <p className="font-bold text-teal-900">{event.title}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {selectedEvent ? renderSelectedEventDetail(selectedEvent) : null}
      </>
    );
  }

  return (
    <main className="ui-page ui-calendar-page">
      <div className="ui-calendar-layout">
        <PageHeader title="カレンダー" backHref="/user" actions={<LogoutButton />} />

        <section className="ui-card ui-calendar-toolbar-card mt-5">
          <CalendarToolbar baseHref="/user/calendar" view={view} anchorDate={anchorDate} targetMonth={targetMonth} todayKey={todayKey}
            selectionActions={selectedDateKeyList.length > 0 ? <>
              <button type="button" onClick={openBulkModal} className="ui-button ui-button-primary">出欠回答</button>
              <button type="button" onClick={clearSelectedDates} className="ui-button ui-button-secondary">選択解除</button>
              <span className="ui-calendar-selection-count">{selectedDateKeyList.length}日選択</span>
            </> : null}
          >
            <button type="button" onClick={handleMultiSelectModeChange} aria-pressed={isMultiSelectMode}
              className={`ui-button ${isMultiSelectMode ? "ui-button-primary" : "ui-button-secondary"}`}>
              {isMultiSelectMode ? "選択終了" : "一括回答"}
            </button>
          </CalendarToolbar>
        </section>

        <section
          className={`ui-calendar ui-schedule-calendar ui-calendar-view-${view} mt-5 select-none`}
          data-pull-refresh-ignore={isMultiSelectMode || isSelectionActive ? "" : undefined}
          onPointerMove={handleCalendarPointerMove}
          onPointerUp={handleCalendarPointerUp}
          onPointerCancel={handleCalendarPointerCancel}
          style={{ touchAction: isSelectionActive || isMultiSelectMode ? "none" : "pan-y" }}
        >
          <div className="ui-calendar-grid">
            {view !== "day" && <div className="ui-calendar-weekday-row">{weekLabels.map((label, index) => (
              <div
                key={label}
                className={`ui-calendar-weekday ${index === 5 ? "is-saturday" : index === 6 ? "is-sunday" : ""}`}
              >
                {label}
              </div>
            ))}</div>}

            {calendarWeeks.map(week => <div className="ui-calendar-week" key={week[0].dateKey}>
              <div className="ui-calendar-week-days">
                {week.map((cell) => {
                  const dayEvents = eventsByDate.get(cell.dateKey) ?? [];
                  const normalEvents = dayEvents.filter(
                    (event) => !periodEventIds.has(event.id)
                  );
                  const periodEvents = dayEvents.filter(
                    (event) => periodEventIds.has(event.id)
                  );

                  const isSaturday = cell.weekday === 6;
                  const isSunday = cell.weekday === 0;
                  const isHoliday = dayEvents.some((event) => event.is_holiday);
                  const isToday = cell.dateKey === todayKey;
                  const isSelected = selectedDateKeys.has(cell.dateKey);

                  const attendanceEvents = normalEvents.filter(event => event.attendance_required);
                  const singleAttendanceEvent = attendanceEvents.length === 1 ? attendanceEvents[0] : null;

                  return (
                    <button
                      key={cell.dateKey}
                      type="button"
                      data-date-key={cell.dateKey}
                      aria-pressed={isSelected}
                      aria-label={`${cell.dateKey} ${dayEvents.length}件の予定 ${dayEvents.map(event => {
                        const summary = getEventSummary(event.id);
                        return `${event.title} ${event.time_text ?? ""}${event.attendance_required ? ` 指導者${summary.coachCount}人、選手${summary.playerCount}人 自分は${statusLabel(myResponsesByEvent.get(event.id)?.status)}` : ""}`;
                      }).join("、")}`}
                      disabled={!cell.valid}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        if (isMultiSelectMode) setSelectedDateKeys(current => toggleDateInSet(current, cell.dateKey));
                        else {
                          selectEvent(normalEvents[0]?.id ?? periodEvents[0]?.id ?? null, cell.dateKey);
                        }
                      }}
                      onPointerDown={(event) =>
                        handlePointerDown(event, cell.dateKey)
                      }
                      className={`ui-calendar-day ${!cell.isCurrentMonth ? "is-outside-month" : ""} ${isHoliday || isSunday ? "is-sunday" : isSaturday ? "is-saturday" : ""} ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""}`}
                    >
                      <div className="ui-calendar-day-header">
                        <span className="ui-calendar-date-number">
                          {view === "month" ? cell.day : `${Number(cell.dateKey.slice(5, 7))}/${cell.day}`}
                          {view !== "month" && <span className="ui-calendar-date-weekday">（{"日月火水木金土"[cell.weekday]}）</span>}
                        </span>
                        {view !== "day" && singleAttendanceEvent && <OwnAttendance status={myResponsesByEvent.get(singleAttendanceEvent.id)?.status} />}
                        {view === "month" && attendanceEvents.length > 1 && <span className="ui-calendar-own-statuses" aria-label="予定順の自分の出欠">
                          {attendanceEvents.map(event => <span key={event.id} data-event-id={event.id}>
                            <OwnAttendance status={myResponsesByEvent.get(event.id)?.status} eventTitle={event.title} />
                          </span>)}
                        </span>}
                      </div>
                      {view !== "day" && <div className="ui-calendar-day-events">
                        {normalEvents.map(event => renderEventBlock(event, !singleAttendanceEvent))}
                        {view !== "month" && dayEvents.length === 0 && <span className="ui-calendar-empty">予定なし</span>}
                      </div>}

                    </button>
                  );
                })}
              </div>
              <CalendarPeriodBands groups={periodGroups} dateKeys={week.map(cell => cell.dateKey)} disabled={isMultiSelectMode} onSelect={(dateKey, eventId) => {
                selectEvent(eventId, dateKey);
              }} />
              {view === "day" && <CalendarDayTimeline
                events={(eventsByDate.get(anchorDate) ?? []).filter(event => !periodEventIds.has(event.id))}
                getSummary={getEventSummary} getOwnStatus={eventId => myResponsesByEvent.get(eventId)?.status}
                onSelect={eventId => {
                  setErrorMessage("");
                  if (isMultiSelectMode) setSelectedDateKeys(current => toggleDateInSet(current, anchorDate));
                  else selectEvent(eventId, anchorDate);
                }}
              />}
            </div>)}
          </div>
          <CalendarAttendanceLegend />
        </section>
      </div>

      {selectedDateKey && (
        <div className="ui-modal-backdrop">
          <div className="ui-modal">
            {renderModalContents()}
          </div>
        </div>
      )}

      {isBulkModalOpen && (
        <div className="ui-modal-backdrop">
          <div className="ui-modal">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="ui-section-title text-gray-900">
                  まとめて出欠回答
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

            <div className="mt-4 max-h-40 overflow-y-auto rounded bg-gray-50 p-3 text-sm font-bold text-gray-900">
              {selectedDateKeyList.map((dateKey) => {
                const dayEvents = (eventsByDate.get(dateKey) ?? []).filter(
                  (event) =>
                    event.attendance_required &&
                    event.display_type !== "period"
                );

                return (
                  <div key={dateKey} className="border-b border-gray-200 py-2">
                    <div>{formatDate(dateKey)}</div>
                    {dayEvents.length > 0 ? (
                      <div className="mt-1 text-xs font-medium text-gray-700">
                        {dayEvents.map((event) => event.title).join(" / ")}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs font-medium text-gray-500">
                        出欠回答対象の予定なし
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <form action={handleBulkAttendance} className="mt-5 space-y-4">
              {selectedBulkEvents.map((event) => (
                <input
                  key={event.id}
                  type="hidden"
                  name="event_ids"
                  value={event.id}
                />
              ))}

              <div>
                <label className="block text-sm font-bold text-gray-900">
                  出欠
                </label>
                <select
                  name="status"
                  defaultValue="attend"
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
                <input name="note" className={fieldClass} placeholder="任意" />
              </div>

              <SubmitButton
                busy={isPending}
                pendingText="保存中..."
                className="ui-button ui-button-primary w-full"
              >
                選択日の予定にまとめて保存
              </SubmitButton>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
