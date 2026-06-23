"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserAttendance } from "./actions";

type CurrentUser = {
  id: string;
  name: string;
  group_id: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  time_text: string | null;
  start_at: string;
  is_holiday: boolean;
  title_color: string | null;
  location_color: string | null;
  time_color: string | null;
  attendance_required: boolean;
  display_type: string;
};

type EventResponse = {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  note: string | null;
};

type EventSummary = {
  attend: number;
  pending: number;
  absent: number;
  coachAttend: number;
  playerAttend: number;
};

type UserCalendarClientProps = {
  currentUser: CurrentUser;
  currentYear: number;
  currentMonth: number;
  todayKey: string;
  events: CalendarEvent[];
  myResponses: EventResponse[];
  summariesByEvent: Record<string, EventSummary>;
};

const WEEKDAYS = [
  { label: "月", value: 1 },
  { label: "火", value: 2 },
  { label: "水", value: 3 },
  { label: "木", value: 4 },
  { label: "金", value: 5 },
  { label: "土", value: 6 },
  { label: "日", value: 0 },
];

const STATUS_OPTIONS = [
  { value: "", label: "未回答" },
  { value: "attend", label: "〇 出席" },
  { value: "pending", label: "△ 未定" },
  { value: "absent", label: "× 欠席" },
];

function toDateKeyFromParts(year: number, month: number, date = 1) {
  return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(
    2,
    "0"
  )}`;
}

function getEventDateKey(value: string) {
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

function formatDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${dateKey}T00:00:00+09:00`));
}

function getMonthDaysMondayStart(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  const firstWeekday = firstDay.getDay();
  const offset = (firstWeekday + 6) % 7;
  const lastDate = lastDay.getDate();

  const cells: Array<{
    dateKey: string;
    day: number;
    weekday: number;
  } | null> = [];

  for (let i = 0; i < offset; i++) {
    cells.push(null);
  }

  for (let date = 1; date <= lastDate; date++) {
    const value = new Date(year, month - 1, date);

    cells.push({
      dateKey: toDateKeyFromParts(year, month, date),
      day: date,
      weekday: value.getDay(),
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function getPrevMonth(year: number, month: number) {
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }

  return { year, month: month - 1 };
}

function getNextMonth(year: number, month: number) {
  if (month === 12) {
    return { year: year + 1, month: 1 };
  }

  return { year, month: month + 1 };
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

function compactStyle(
  value: string | null | undefined,
  color: string | null | undefined
) {
  const text = displayText(value);
  const length = visualLength(text);
  const hasLineBreak = text.includes("\n");

  if (!hasLineBreak && length <= 5) {
    return {
      color: color || "#111827",
      whiteSpace: "nowrap" as const,
      overflow: "hidden",
      textOverflow: "clip",
      lineHeight: "1.08",
      letterSpacing:
        length >= 5 ? "-0.1em" : length >= 4 ? "-0.06em" : "-0.03em",
    };
  }

  return {
    color: color || "#111827",
    whiteSpace: "pre-line" as const,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as const,
    lineHeight: "1.12",
    letterSpacing: length >= 10 ? "-0.08em" : "-0.04em",
  };
}

function compactFontClass(value: string | null | undefined) {
  const length = visualLength(value);

  if (length <= 3) {
    return "text-[12px]";
  }

  if (length <= 4) {
    return "text-[11px]";
  }

  if (length <= 5) {
    return "text-[10px]";
  }

  if (length <= 7) {
    return "text-[9px]";
  }

  return "text-[8px]";
}

function statusCalendarLabel(status: string | null | undefined) {
  if (status === "attend") return "〇";
  if (status === "pending") return "△";
  if (status === "absent") return "×";
  return "未回答";
}

function statusLongLabel(status: string | null | undefined) {
  if (status === "attend") return "〇 出席";
  if (status === "pending") return "△ 未定";
  if (status === "absent") return "× 欠席";
  return "未回答";
}

function statusPillClass(status: string | null | undefined) {
  if (status === "attend") return "bg-green-500 text-white";
  if (status === "pending") return "bg-yellow-500 text-white";
  if (status === "absent") return "bg-red-500 text-white";
  return "bg-orange-500 text-white";
}

function statusButtonClass(status: string, currentStatus: string) {
  const isSelected = status === currentStatus;

  if (!isSelected) {
    return "border-gray-300 bg-white text-gray-700";
  }

  if (status === "attend") {
    return "border-green-500 bg-green-500 text-white";
  }

  if (status === "pending") {
    return "border-yellow-500 bg-yellow-500 text-white";
  }

  if (status === "absent") {
    return "border-red-500 bg-red-500 text-white";
  }

  return "border-orange-500 bg-orange-500 text-white";
}

export default function UserCalendarClient({
  currentUser,
  currentYear,
  currentMonth,
  todayKey,
  events,
  myResponses,
  summariesByEvent,
}: UserCalendarClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const [localResponses, setLocalResponses] = useState<Record<string, string>>(
    () => {
      const result: Record<string, string> = {};

      for (const response of myResponses) {
        result[response.event_id] = response.status;
      }

      return result;
    }
  );

  useEffect(() => {
    const result: Record<string, string> = {};

    for (const response of myResponses) {
      result[response.event_id] = response.status;
    }

    setLocalResponses(result);
  }, [myResponses]);

  const monthCells = useMemo(
    () => getMonthDaysMondayStart(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const eventsByDate = useMemo(() => {
    const result: Record<string, CalendarEvent[]> = {};

    for (const event of events) {
      const dateKey = getEventDateKey(event.start_at);

      if (!result[dateKey]) {
        result[dateKey] = [];
      }

      result[dateKey].push(event);
    }

    return result;
  }, [events]);

  const selectedDateEvents = selectedDateKey
    ? eventsByDate[selectedDateKey] ?? []
    : [];

  const selectedEvent =
    selectedEventId && events.find((event) => event.id === selectedEventId)
      ? events.find((event) => event.id === selectedEventId) ?? null
      : null;

  const prev = getPrevMonth(currentYear, currentMonth);
  const next = getNextMonth(currentYear, currentMonth);

  function openDayModal(dateKey: string) {
    const dayEvents = eventsByDate[dateKey] ?? [];

    setSelectedDateKey(dateKey);
    setSelectedEventId(dayEvents[0]?.id ?? null);
    setErrorMessage("");
  }

  function openEventModal(dateKey: string, eventId: string) {
    setSelectedDateKey(dateKey);
    setSelectedEventId(eventId);
    setErrorMessage("");
  }

  function closeModal() {
    setSelectedDateKey(null);
    setSelectedEventId(null);
    setErrorMessage("");
  }

  function saveAttendance(eventId: string, nextStatus: string) {
    setErrorMessage("");

    setLocalResponses((prevState) => {
      const nextState = { ...prevState };

      if (nextStatus) {
        nextState[eventId] = nextStatus;
      } else {
        delete nextState[eventId];
      }

      return nextState;
    });

    startTransition(async () => {
      try {
        await updateUserAttendance(eventId, currentUser.id, nextStatus);
        router.refresh();
      } catch {
        setErrorMessage("保存に失敗しました。通信状態を確認してください。");
      }
    });
  }

  return (
    <main className="min-h-screen bg-gray-50 p-3 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">予定・出欠</h1>
            <p className="mt-2 text-sm text-gray-700">
              {currentUser.name} さんの予定と出欠回答
            </p>
          </div>

          <div className="flex gap-2">
            <a href="/user" className="rounded border bg-white px-4 py-2">
              ユーザー画面に戻る
            </a>

            <a href="/logout" className="rounded border bg-white px-4 py-2">
              ログアウト
            </a>
          </div>
        </div>

        <section className="mt-6 rounded-lg bg-white p-2 shadow sm:mt-8 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <a
              href={`/user/calendar?year=${prev.year}&month=${prev.month}`}
              className="rounded-full bg-gray-200 px-5 py-3 text-lg font-bold text-gray-900"
              aria-label="前月"
            >
              ◀
            </a>

            <h2 className="text-center text-2xl font-bold text-gray-900">
              {currentYear}年 {currentMonth}月
            </h2>

            <a
              href={`/user/calendar?year=${next.year}&month=${next.month}`}
              className="rounded-full bg-gray-200 px-5 py-3 text-lg font-bold text-gray-900"
              aria-label="翌月"
            >
              ▶
            </a>
          </div>

          <div className="mt-4 grid grid-cols-7 border-l border-t text-center text-sm font-bold">
            {WEEKDAYS.map((day) => (
              <div
                key={day.label}
                className={
                  day.value === 6
                    ? "border-b border-r border-gray-300 bg-blue-100 p-1 text-blue-900"
                    : day.value === 0
                      ? "border-b border-r border-gray-300 bg-red-100 p-1 text-red-900"
                      : "border-b border-r border-gray-300 bg-gray-100 p-1 text-gray-900"
                }
              >
                {day.label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 border-l border-gray-300 text-center">
            {monthCells.map((cell, index) => {
              if (!cell) {
                return (
                  <div
                    key={`empty-${index}`}
                    className="min-h-[112px] border-b border-r border-gray-300 bg-gray-50"
                  />
                );
              }

              const dayEvents = eventsByDate[cell.dateKey] ?? [];

              const normalEvents = dayEvents.filter(
                (event) => event.display_type !== "period"
              );

              const periodEvents = dayEvents.filter(
                (event) => event.display_type === "period"
              );

              const hasHolidayEvent = dayEvents.some(
                (event) => event.is_holiday
              );

              const baseCellClass =
                "min-h-[112px] cursor-pointer border-b border-r border-gray-300 p-1 text-center active:bg-yellow-100 sm:min-h-36";

              const cellClass =
                hasHolidayEvent || cell.weekday === 0
                  ? `${baseCellClass} bg-red-50`
                  : cell.weekday === 6
                    ? `${baseCellClass} bg-blue-50`
                    : `${baseCellClass} bg-white`;

              return (
                <div
                  key={cell.dateKey}
                  role="button"
                  tabIndex={0}
                  className={cellClass}
                  onClick={() => openDayModal(cell.dateKey)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      openDayModal(cell.dateKey);
                    }
                  }}
                >
                  <div className="flex justify-center">
                    <span
                      className={
                        todayKey === cell.dateKey
                          ? "flex h-7 w-7 items-center justify-center rounded-full bg-black text-base font-bold text-white"
                          : "flex h-7 w-7 items-center justify-center text-base font-bold text-gray-900"
                      }
                    >
                      {cell.day}
                    </span>
                  </div>

                  <div className="mt-1 space-y-1">
                    {normalEvents.slice(0, 2).map((event) => {
                      const summary = summariesByEvent[event.id];
                      const currentStatus = localResponses[event.id] ?? "";

                      return (
                        <button
                          key={event.id}
                          type="button"
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            openEventModal(cell.dateKey, event.id);
                          }}
                          className="block w-full rounded bg-white px-[1px] py-1 text-center leading-tight shadow-sm"
                        >
                          <span
                            className={`block font-bold ${compactFontClass(
                              event.title
                            )}`}
                            style={compactStyle(
                              event.title,
                              event.title_color
                            )}
                          >
                            {displayText(event.title)}
                          </span>

                          {event.location && (
                            <span
                              className={`mt-0.5 block ${compactFontClass(
                                event.location
                              )}`}
                              style={compactStyle(
                                event.location,
                                event.location_color
                              )}
                            >
                              {displayText(event.location)}
                            </span>
                          )}

                          {event.time_text && (
                            <span
                              className={`mt-0.5 block ${compactFontClass(
                                event.time_text
                              )}`}
                              style={compactStyle(
                                event.time_text,
                                event.time_color
                              )}
                            >
                              {displayText(event.time_text)}
                            </span>
                          )}

                          {event.attendance_required && summary && (
                            <span className="mt-0.5 block text-[9px] font-medium text-gray-900">
                              指導者：{summary.coachAttend}
                              <br />
                              選手：{summary.playerAttend}
                            </span>
                          )}

                          {event.attendance_required && (
                            <span
                              className={`mt-1 block rounded px-1 py-0.5 text-[10px] font-bold ${statusPillClass(
                                currentStatus
                              )}`}
                            >
                              {statusCalendarLabel(currentStatus)}
                            </span>
                          )}

                          {!event.attendance_required && (
                            <span className="mt-1 block rounded bg-gray-100 px-1 py-0.5 text-[9px] font-bold text-gray-700">
                              出欠不要
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {normalEvents.length > 2 && (
                      <button
                        type="button"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          openDayModal(cell.dateKey);
                        }}
                        className="block w-full rounded bg-gray-100 px-1 py-0.5 text-[9px] font-bold text-gray-700"
                      >
                        +{normalEvents.length - 2}件
                      </button>
                    )}
                  </div>

                  {periodEvents.length > 0 && (
                    <div className="mt-1 space-y-1 border-t border-gray-300 pt-1">
                      {periodEvents.slice(0, 1).map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            openEventModal(cell.dateKey, event.id);
                          }}
                          className="block w-full rounded bg-teal-500 px-[1px] py-1 text-center font-bold leading-tight text-white"
                        >
                          <span
                            className={`block ${compactFontClass(event.title)}`}
                            style={compactStyle(event.title, "#ffffff")}
                          >
                            {displayText(event.title)}
                          </span>
                        </button>
                      ))}

                      {periodEvents.length > 1 && (
                        <button
                          type="button"
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            openDayModal(cell.dateKey);
                          }}
                          className="block w-full rounded bg-teal-100 px-1 py-0.5 text-[9px] font-bold text-teal-800"
                        >
                          +{periodEvents.length - 1}件
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-6 rounded-lg bg-white p-5 shadow">
          <h2 className="text-lg font-bold">操作方法</h2>

          <p className="mt-2 text-sm text-gray-700">
            日付タイルまたは予定をタップすると、詳細モーダルが開きます。
            出欠回答もモーダル内で変更できます。
          </p>

          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded bg-green-100 px-3 py-1 text-green-800">
              〇 出席
            </span>
            <span className="rounded bg-yellow-100 px-3 py-1 text-yellow-800">
              △ 未定
            </span>
            <span className="rounded bg-red-100 px-3 py-1 text-red-800">
              × 欠席
            </span>
            <span className="rounded bg-orange-100 px-3 py-1 text-orange-800">
              未 未回答
            </span>
            <span className="rounded bg-teal-100 px-3 py-1 text-teal-800">
              期間予定
            </span>
          </div>
        </section>
      </div>

      {selectedDateKey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
          onClick={closeModal}
        >
          <div
            className="max-h-[calc(100vh-24px)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 text-gray-900 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-gray-600">
                  {formatDateLabel(selectedDateKey)}
                </p>
                <h2 className="mt-1 text-xl font-bold">予定詳細</h2>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="rounded-full bg-gray-100 px-3 py-1 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="mt-4">
              <p className="text-sm font-bold">この日の予定</p>

              {selectedDateEvents.length === 0 ? (
                <p className="mt-2 rounded bg-gray-50 p-3 text-sm text-gray-600">
                  この日の予定はありません。
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {selectedDateEvents.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => setSelectedEventId(event.id)}
                      className={
                        selectedEventId === event.id
                          ? "block w-full rounded border-2 border-black bg-gray-50 p-3 text-left"
                          : "block w-full rounded border bg-white p-3 text-left"
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className="font-bold"
                          style={{ color: event.title_color || "#111827" }}
                        >
                          {event.title}
                        </p>

                        {event.display_type === "period" && (
                          <span className="rounded bg-teal-100 px-2 py-1 text-xs text-teal-800">
                            期間予定
                          </span>
                        )}

                        {!event.attendance_required && (
                          <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                            出欠不要
                          </span>
                        )}
                      </div>

                      {event.time_text && (
                        <p
                          className="mt-1 text-sm"
                          style={{ color: event.time_color || "#111827" }}
                        >
                          時間：{event.time_text}
                        </p>
                      )}

                      {event.location && (
                        <p
                          className="mt-1 text-sm"
                          style={{ color: event.location_color || "#111827" }}
                        >
                          場所：{event.location}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedEvent && (
              <section className="mt-5 rounded-lg border bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3
                    className="text-xl font-bold"
                    style={{ color: selectedEvent.title_color || "#111827" }}
                  >
                    {selectedEvent.title}
                  </h3>

                  {selectedEvent.is_holiday && (
                    <span className="rounded bg-red-100 px-2 py-1 text-xs text-red-700">
                      祝日扱い
                    </span>
                  )}

                  {selectedEvent.display_type === "period" && (
                    <span className="rounded bg-teal-100 px-2 py-1 text-xs text-teal-800">
                      期間予定
                    </span>
                  )}

                  {!selectedEvent.attendance_required && (
                    <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                      出欠不要
                    </span>
                  )}
                </div>

                <div className="mt-3 space-y-1 text-sm">
                  <p style={{ color: selectedEvent.location_color || "#111827" }}>
                    場所：{selectedEvent.location || "未設定"}
                  </p>

                  <p style={{ color: selectedEvent.time_color || "#111827" }}>
                    時間：{selectedEvent.time_text || "未設定"}
                  </p>
                </div>

                {selectedEvent.description && (
                  <p className="mt-3 whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm text-gray-700">
                    {selectedEvent.description}
                  </p>
                )}

                {selectedEvent.attendance_required ? (
                  <>
                    <div className="mt-4 rounded bg-gray-50 p-3 text-sm">
                      <p className="font-bold">集計</p>

                      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded bg-green-100 p-2 text-green-800">
                          <p className="text-xs">出席</p>
                          <p className="text-lg font-bold">
                            {summariesByEvent[selectedEvent.id]?.attend ?? 0}
                          </p>
                        </div>

                        <div className="rounded bg-yellow-100 p-2 text-yellow-800">
                          <p className="text-xs">未定</p>
                          <p className="text-lg font-bold">
                            {summariesByEvent[selectedEvent.id]?.pending ?? 0}
                          </p>
                        </div>

                        <div className="rounded bg-red-100 p-2 text-red-800">
                          <p className="text-xs">欠席</p>
                          <p className="text-lg font-bold">
                            {summariesByEvent[selectedEvent.id]?.absent ?? 0}
                          </p>
                        </div>
                      </div>

                      <p className="mt-2 text-center text-sm text-gray-700">
                        指導者：
                        {summariesByEvent[selectedEvent.id]?.coachAttend ?? 0}
                        　選手：
                        {summariesByEvent[selectedEvent.id]?.playerAttend ?? 0}
                      </p>
                    </div>

                    <div className="mt-4">
                      <p className="text-sm font-bold">
                        現在の回答：
                        {statusLongLabel(localResponses[selectedEvent.id] ?? "")}
                      </p>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {STATUS_OPTIONS.map((option) => {
                          const currentStatus =
                            localResponses[selectedEvent.id] ?? "";

                          return (
                            <button
                              key={option.value}
                              type="button"
                              disabled={isPending}
                              onClick={() =>
                                saveAttendance(selectedEvent.id, option.value)
                              }
                              className={`rounded border px-3 py-3 text-sm font-bold ${statusButtonClass(
                                option.value,
                                currentStatus
                              )}`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-3 min-h-5 text-sm">
                        {isPending && (
                          <span className="text-gray-600">保存中...</span>
                        )}

                        {!isPending && errorMessage && (
                          <span className="text-red-600">{errorMessage}</span>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="mt-4 rounded bg-gray-50 p-3 text-sm text-gray-600">
                    この予定は出欠回答不要です。
                  </p>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </main>
  );
}