import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import AttendanceSelect from "./AttendanceSelect";

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
};

type PageProps = {
  searchParams?: Promise<{
    year?: string;
    month?: string;
  }>;
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

function toDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const date = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${date}`;
}

function toDateKeyFromParts(year: number, month: number, date = 1) {
  return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(
    2,
    "0"
  )}`;
}

function getMonthDaysMondayStart(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  const firstWeekday = firstDay.getDay();
  const offset = (firstWeekday + 6) % 7;
  const lastDate = lastDay.getDate();

  const cells: Array<Date | null> = [];

  for (let i = 0; i < offset; i++) {
    cells.push(null);
  }

  for (let date = 1; date <= lastDate; date++) {
    cells.push(new Date(year, month - 1, date));
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function getMonthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
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

function statusClass(status: string | null | undefined) {
  if (status === "attend") return "bg-green-100 text-green-800";
  if (status === "absent") return "bg-red-100 text-red-800";
  if (status === "pending") return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-600";
}

function statusShortLabel(status: string | null | undefined) {
  if (status === "attend") return "〇";
  if (status === "absent") return "×";
  if (status === "pending") return "△";
  return "未";
}

export default async function UserCalendarPage({ searchParams }: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const currentUser = await requireUser();

  const today = new Date();
  const todayKey = toDateKey(today);

  const yearParam = Number(resolvedSearchParams?.year);
  const monthParam = Number(resolvedSearchParams?.month);

  const currentYear = Number.isFinite(yearParam)
    ? yearParam
    : today.getFullYear();

  const currentMonth =
    Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12
      ? monthParam
      : today.getMonth() + 1;

  const prev = getPrevMonth(currentYear, currentMonth);
  const next = getNextMonth(currentYear, currentMonth);

  const monthDays = getMonthDaysMondayStart(currentYear, currentMonth);
  const monthRange = getMonthRange(currentYear, currentMonth);

  const { data: events, error: eventsError } = await supabase
    .from("calendar_events")
    .select(
      "id, title, description, location, time_text, start_at, is_holiday, title_color, location_color, time_color, attendance_required, display_type"
    )
    .eq("group_id", currentUser.group_id)
    .gte("start_at", monthRange.start)
    .lt("start_at", monthRange.end)
    .order("start_at", { ascending: true });

  if (eventsError) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-2xl font-bold">予定</h1>
          <p className="mt-6 rounded bg-red-100 p-4 text-red-700">
            予定取得エラー：{eventsError.message}
          </p>
        </div>
      </main>
    );
  }

  const eventList = (events ?? []) as CalendarEvent[];
  const eventIds = eventList.map((event) => event.id);

  const { data: myResponses } =
    eventIds.length > 0
      ? await supabase
          .from("event_responses")
          .select("id, event_id, user_id, status, note")
          .eq("user_id", currentUser.id)
          .in("event_id", eventIds)
      : { data: [] };

  const { data: allResponses } =
    eventIds.length > 0
      ? await supabase
          .from("event_responses")
          .select("event_id, status")
          .in("event_id", eventIds)
      : { data: [] };

  const myResponseList = (myResponses ?? []) as EventResponse[];

  const responsesByEvent = new Map<string, EventResponse>();

  for (const response of myResponseList) {
    responsesByEvent.set(response.event_id, response);
  }

  const summariesByEvent = new Map<string, EventSummary>();

  for (const event of eventList) {
    summariesByEvent.set(event.id, {
      attend: 0,
      pending: 0,
      absent: 0,
    });
  }

  for (const response of allResponses ?? []) {
    const summary = summariesByEvent.get(response.event_id);

    if (!summary) continue;

    if (response.status === "attend") summary.attend += 1;
    if (response.status === "pending") summary.pending += 1;
    if (response.status === "absent") summary.absent += 1;
  }

  const eventsByDate = eventList.reduce<Record<string, CalendarEvent[]>>(
    (acc, event) => {
      const dateKey = toDateKey(new Date(event.start_at));

      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }

      acc[dateKey].push(event);

      return acc;
    },
    {}
  );

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">予定・出欠</h1>
            <p className="mt-2 text-sm text-gray-600">
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

        <section className="mt-8 rounded-lg bg-white p-4 shadow">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold">
              {currentYear}年{currentMonth}月
            </h2>

            <div className="flex gap-2">
              <a
                href={`/user/calendar?year=${prev.year}&month=${prev.month}`}
                className="rounded border px-3 py-2 text-sm"
              >
                前月
              </a>

              <a
                href={`/user/calendar?year=${today.getFullYear()}&month=${
                  today.getMonth() + 1
                }`}
                className="rounded border px-3 py-2 text-sm"
              >
                今月
              </a>

              <a
                href={`/user/calendar?year=${next.year}&month=${next.month}`}
                className="rounded border px-3 py-2 text-sm"
              >
                翌月
              </a>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-7 border-l border-t text-center text-sm font-bold">
            {WEEKDAYS.map((day) => (
              <div
                key={day.label}
                className={
                  day.value === 6
                    ? "border-b border-r bg-blue-100 p-2"
                    : day.value === 0
                      ? "border-b border-r bg-red-100 p-2"
                      : "border-b border-r bg-gray-100 p-2"
                }
              >
                {day.label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 border-l text-sm">
            {monthDays.map((date, index) => {
              if (!date) {
                return (
                  <div
                    key={`empty-${index}`}
                    className="min-h-36 border-b border-r bg-gray-50 p-2"
                  />
                );
              }

              const dateKey = toDateKey(date);
              const dayEvents = eventsByDate[dateKey] ?? [];

              const normalEvents = dayEvents.filter(
                (event) => event.display_type !== "period"
              );

              const periodEvents = dayEvents.filter(
                (event) => event.display_type === "period"
              );

              const isToday = todayKey === dateKey;
              const dayOfWeek = date.getDay();
              const hasHolidayEvent = dayEvents.some(
                (event) => event.is_holiday
              );

              const cellClass =
                hasHolidayEvent || dayOfWeek === 0
                  ? "min-h-36 border-b border-r bg-red-50 p-2"
                  : dayOfWeek === 6
                    ? "min-h-36 border-b border-r bg-blue-50 p-2"
                    : "min-h-36 border-b border-r bg-white p-2";

              return (
                <div key={dateKey} className={cellClass}>
                  <div className="flex items-center justify-between">
                    <p
                      className={
                        isToday
                          ? "flex h-7 w-7 items-center justify-center rounded-full bg-black text-white"
                          : "flex h-7 w-7 items-center justify-center rounded-full"
                      }
                    >
                      {date.getDate()}
                    </p>
                  </div>

                  <div className="mt-2 space-y-1">
                    {normalEvents.map((event) => {
                      const response = responsesByEvent.get(event.id);
                      const summary = summariesByEvent.get(event.id);

                      return (
                        <div
                          key={event.id}
                          className="rounded border bg-white px-2 py-2 text-left text-xs"
                        >
                          <a
                            href={`/user/calendar/${event.id}`}
                            className="block hover:bg-gray-50"
                          >
                            <p
                              className="truncate font-bold"
                              style={{
                                color: event.title_color || "#000000",
                              }}
                            >
                              {event.title}
                            </p>

                            {event.location && (
                              <p
                                className="truncate"
                                style={{
                                  color: event.location_color || "#000000",
                                }}
                              >
                                {event.location}
                              </p>
                            )}

                            {event.time_text && (
                              <p
                                className="truncate"
                                style={{
                                  color: event.time_color || "#000000",
                                }}
                              >
                                {event.time_text}
                              </p>
                            )}
                          </a>

                          {event.attendance_required ? (
                            <div className="mt-2">
                              <AttendanceSelect
                                eventId={event.id}
                                userId={currentUser.id}
                                defaultStatus={response?.status ?? ""}
                              />
                            </div>
                          ) : (
                            <p className="mt-2 rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-600">
                              出欠回答不要
                            </p>
                          )}

                          {event.attendance_required && summary && (
                            <p className="mt-1 text-[11px] text-gray-600">
                              〇{summary.attend} △{summary.pending} ×
                              {summary.absent}
                            </p>
                          )}

                          <a
                            href={`/user/calendar/${event.id}`}
                            className="mt-1 inline-block text-[11px] text-gray-500 underline"
                          >
                            詳細を見る
                          </a>
                        </div>
                      );
                    })}
                  </div>

                  {periodEvents.length > 0 && (
                    <div className="mt-2 space-y-1 border-t pt-1">
                      {periodEvents.map((event) => (
                        <a
                          key={event.id}
                          href={`/user/calendar/${event.id}`}
                          className="block truncate rounded bg-teal-100 px-2 py-1 text-[11px] font-medium text-teal-800 hover:bg-teal-200"
                          title={event.title}
                        >
                          {event.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-8 rounded-lg bg-white p-5 shadow">
          <h2 className="text-lg font-bold">回答状態</h2>

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
            <span className="rounded bg-gray-100 px-3 py-1 text-gray-600">
              未 未回答
            </span>
            <span className="rounded bg-teal-100 px-3 py-1 text-teal-800">
              期間予定・出欠不要
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}