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

function compactTextStyle(color: string | null | undefined) {
  return {
    color: color || "#111827",
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as const,
  };
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
      <main className="min-h-screen bg-gray-50 p-3 text-gray-900 sm:p-8">
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold text-gray-900">
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

          <div className="mt-4 grid grid-cols-7 border-l border-t text-center text-xs font-bold sm:text-sm">
            {WEEKDAYS.map((day) => (
              <div
                key={day.label}
                className={
                  day.value === 6
                    ? "border-b border-r bg-blue-100 p-1 text-blue-900 sm:p-2"
                    : day.value === 0
                      ? "border-b border-r bg-red-100 p-1 text-red-900 sm:p-2"
                      : "border-b border-r bg-gray-100 p-1 text-gray-900 sm:p-2"
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
                    className="min-h-[118px] border-b border-r bg-gray-50 p-1 sm:min-h-36 sm:p-2"
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

              const baseCellClass =
                "min-h-[118px] border-b border-r p-1 sm:min-h-36 sm:p-2";

              const cellClass =
                hasHolidayEvent || dayOfWeek === 0
                  ? `${baseCellClass} bg-red-50`
                  : dayOfWeek === 6
                    ? `${baseCellClass} bg-blue-50`
                    : `${baseCellClass} bg-white`;

              return (
                <div key={dateKey} className={cellClass}>
                  <div className="flex items-start justify-between">
                    <p
                      className={
                        isToday
                          ? "flex h-6 w-6 items-center justify-center rounded-full bg-black text-xs font-bold text-white sm:h-7 sm:w-7 sm:text-sm"
                          : "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-gray-900 sm:h-7 sm:w-7 sm:text-sm"
                      }
                    >
                      {date.getDate()}
                    </p>
                  </div>

                  <div className="mt-1 space-y-1 sm:mt-2">
                    {normalEvents.map((event) => {
                      const response = responsesByEvent.get(event.id);
                      const summary = summariesByEvent.get(event.id);

                      return (
                        <div
                          key={event.id}
                          className="rounded border bg-white p-1 text-left text-[10px] leading-tight shadow-sm sm:px-2 sm:py-2 sm:text-xs"
                        >
                          <a
                            href={`/user/calendar/${event.id}`}
                            className="block"
                          >
                            <p
                              className="font-bold"
                              style={compactTextStyle(event.title_color)}
                            >
                              {event.title}
                            </p>

                            {event.time_text && (
                              <p
                                className="mt-0.5 truncate font-medium"
                                style={{
                                  color: event.time_color || "#111827",
                                }}
                              >
                                {event.time_text}
                              </p>
                            )}

                            {event.location && (
                              <p
                                className="mt-0.5 hidden truncate sm:block"
                                style={{
                                  color: event.location_color || "#111827",
                                }}
                              >
                                {event.location}
                              </p>
                            )}
                          </a>

                          {event.attendance_required ? (
                            <>
                              <div className="mt-2 hidden sm:block">
                                <AttendanceSelect
                                  eventId={event.id}
                                  userId={currentUser.id}
                                  defaultStatus={response?.status ?? ""}
                                />
                              </div>

                              <a
                                href={`/user/calendar/${event.id}`}
                                className={`mt-1 block rounded px-1 py-1 text-center text-[10px] font-bold sm:hidden ${statusPillClass(
                                  response?.status
                                )}`}
                              >
                                {statusLongLabel(response?.status)}
                              </a>
                            </>
                          ) : (
                            <p className="mt-1 rounded bg-gray-100 px-1 py-1 text-center text-[10px] font-medium text-gray-700">
                              出欠不要
                            </p>
                          )}

                          {event.attendance_required && summary && (
                            <p className="mt-1 whitespace-nowrap text-center text-[10px] font-medium text-gray-800 sm:text-left sm:text-[11px]">
                              〇{summary.attend} △{summary.pending} ×
                              {summary.absent}
                            </p>
                          )}

                          <a
                            href={`/user/calendar/${event.id}`}
                            className="mt-1 hidden text-[11px] text-gray-700 underline sm:inline-block"
                          >
                            詳細を見る
                          </a>
                        </div>
                      );
                    })}
                  </div>

                  {periodEvents.length > 0 && (
                    <div className="mt-1 space-y-1 border-t pt-1 sm:mt-2">
                      {periodEvents.map((event) => (
                        <a
                          key={event.id}
                          href={`/user/calendar/${event.id}`}
                          className="block rounded bg-teal-500 px-1 py-1 text-center text-[10px] font-bold leading-tight text-white sm:px-2 sm:text-[11px]"
                          title={event.title}
                        >
                          <span
                            style={{
                              overflow: "hidden",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                            }}
                          >
                            {event.title}
                          </span>
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
            <span className="rounded bg-orange-100 px-3 py-1 text-orange-800">
              未 未回答
            </span>
            <span className="rounded bg-teal-100 px-3 py-1 text-teal-800">
              期間予定・出欠不要
            </span>
          </div>

          <p className="mt-3 text-sm text-gray-700">
            スマホでは予定内の「未回答 / 〇 出席 / △ 未定 / × 欠席」を押すと、詳細画面で回答できます。
          </p>
        </section>
      </div>
    </main>
  );
}