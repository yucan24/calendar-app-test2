import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";
import AdminCalendarAttendanceSelect from "./AdminCalendarAttendanceSelect";

type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  time_text: string | null;
  start_at: string;
  end_at: string | null;
  is_holiday: boolean;
  title_color: string | null;
  location_color: string | null;
  time_color: string | null;
  attendance_required: boolean;
  display_type: string;
};

type EventResponse = {
  event_id: string;
  user_id: string;
  status: string;
};

type PageProps = {
  searchParams?: Promise<{
    year?: string;
    month?: string;
    date?: string;
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

function isValidDateString(value: string | undefined) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function safeColor(value: FormDataEntryValue | null, fallback = "#111827") {
  const text = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
}

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

function toUtcISOStringFromDateKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+09:00`).toISOString();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
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

async function createEvent(formData: FormData) {
  "use server";

  const groupId = String(formData.get("group_id"));
  const createdBy = String(formData.get("created_by"));
  const date = String(formData.get("date"));
  const title = String(formData.get("title"));
  const description = String(formData.get("description") ?? "");
  const location = String(formData.get("location") ?? "");
  const timeText = String(formData.get("time_text") ?? "");
  const isHoliday = formData.get("is_holiday") === "on";
  const isPeriod = formData.get("display_type_period") === "on";

  const attendanceRequired = isPeriod
    ? false
    : formData.get("attendance_required") === "on";

  const displayType = isPeriod ? "period" : "normal";

  const titleColor = safeColor(formData.get("title_color"));
  const locationColor = safeColor(formData.get("location_color"));
  const timeColor = safeColor(formData.get("time_color"));

  if (!groupId || !createdBy || !date || !title) {
    throw new Error("必須項目が不足しています");
  }

  const startAt = toUtcISOStringFromDateKey(date);

  const { error } = await supabase.from("calendar_events").insert({
    group_id: groupId,
    created_by: createdBy,
    title,
    description,
    location,
    time_text: timeText,
    start_at: startAt,
    end_at: null,
    is_holiday: isHoliday,
    title_color: titleColor,
    location_color: locationColor,
    time_color: timeColor,
    attendance_required: attendanceRequired,
    display_type: displayType,
  });

  if (error) {
    throw new Error(error.message);
  }

  const target = new Date(`${date}T00:00:00+09:00`);
  const year = target.getFullYear();
  const month = target.getMonth() + 1;

  revalidatePath("/admin/calendar");
  redirect(
    `/admin/calendar?year=${year}&month=${month}&date=${date}#event-form`
  );
}

async function deleteEvent(formData: FormData) {
  "use server";

  const eventId = String(formData.get("event_id"));
  const date = String(formData.get("date"));

  if (!eventId) {
    throw new Error("削除対象が不明です");
  }

  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("id", eventId);

  if (error) {
    throw new Error(error.message);
  }

  if (date) {
    const target = new Date(`${date}T00:00:00+09:00`);
    const year = target.getFullYear();
    const month = target.getMonth() + 1;

    revalidatePath("/admin/calendar");
    redirect(`/admin/calendar?year=${year}&month=${month}&date=${date}`);
  }

  revalidatePath("/admin/calendar");
  redirect("/admin/calendar");
}

async function bulkCreateEvents(formData: FormData) {
  "use server";

  const groupId = String(formData.get("group_id"));
  const createdBy = String(formData.get("created_by"));
  const fromDate = String(formData.get("from_date"));
  const toDate = String(formData.get("to_date"));
  const title = String(formData.get("bulk_title"));
  const description = String(formData.get("bulk_description") ?? "");
  const location = String(formData.get("bulk_location") ?? "");
  const timeText = String(formData.get("bulk_time_text") ?? "");
  const overwrite = formData.get("overwrite") === "on";
  const isHoliday = formData.get("bulk_is_holiday") === "on";
  const isPeriod = formData.get("bulk_display_type_period") === "on";

  const attendanceRequired = isPeriod
    ? false
    : formData.get("bulk_attendance_required") === "on";

  const displayType = isPeriod ? "period" : "normal";

  const titleColor = safeColor(formData.get("bulk_title_color"));
  const locationColor = safeColor(formData.get("bulk_location_color"));
  const timeColor = safeColor(formData.get("bulk_time_color"));

  const weekdays = formData
    .getAll("weekdays")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (!groupId || !createdBy || !fromDate || !toDate || !title) {
    throw new Error("必須項目が不足しています");
  }

  if (fromDate > toDate) {
    throw new Error("期間の開始日と終了日が逆です");
  }

  if (weekdays.length === 0) {
    throw new Error("曜日を1つ以上選択してください");
  }

  const dateKeys: string[] = [];

  const from = new Date(`${fromDate}T00:00:00+09:00`);
  const to = new Date(`${toDate}T00:00:00+09:00`);

  for (
    const cursor = new Date(from);
    cursor.getTime() <= to.getTime();
    cursor.setDate(cursor.getDate() + 1)
  ) {
    if (weekdays.includes(cursor.getDay())) {
      dateKeys.push(toDateKey(cursor));
    }
  }

  if (dateKeys.length === 0) {
    revalidatePath("/admin/calendar");
    redirect("/admin/calendar");
  }

  const rangeStart = toUtcISOStringFromDateKey(dateKeys[0]);
  const rangeEnd = new Date(`${dateKeys[dateKeys.length - 1]}T23:59:59+09:00`)
    .toISOString();

  const { data: existingEvents, error: existingError } = await supabase
    .from("calendar_events")
    .select("id, start_at")
    .eq("group_id", groupId)
    .gte("start_at", rangeStart)
    .lte("start_at", rangeEnd);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingByDate = new Map<string, string>();

  for (const event of existingEvents ?? []) {
    const dateKey = toDateKey(new Date(event.start_at));

    if (!existingByDate.has(dateKey)) {
      existingByDate.set(dateKey, event.id);
    }
  }

  const rowsToInsert = [];
  const rowsToUpdate = [];

  for (const dateKey of dateKeys) {
    const existingId = existingByDate.get(dateKey);

    const row = {
      group_id: groupId,
      created_by: createdBy,
      title,
      description,
      location,
      time_text: timeText,
      start_at: toUtcISOStringFromDateKey(dateKey),
      end_at: null,
      is_holiday: isHoliday,
      title_color: titleColor,
      location_color: locationColor,
      time_color: timeColor,
      attendance_required: attendanceRequired,
      display_type: displayType,
      updated_at: new Date().toISOString(),
    };

    if (existingId) {
      if (overwrite) {
        rowsToUpdate.push({ id: existingId, ...row });
      }
    } else {
      rowsToInsert.push(row);
    }
  }

  if (rowsToInsert.length > 0) {
    const { error } = await supabase.from("calendar_events").insert(rowsToInsert);

    if (error) {
      throw new Error(error.message);
    }
  }

  for (const row of rowsToUpdate) {
    const { id, ...values } = row;

    const { error } = await supabase
      .from("calendar_events")
      .update(values)
      .eq("id", id);

    if (error) {
      throw new Error(error.message);
    }
  }

  const target = new Date(`${fromDate}T00:00:00+09:00`);
  const year = target.getFullYear();
  const month = target.getMonth() + 1;

  revalidatePath("/admin/calendar");
  redirect(`/admin/calendar?year=${year}&month=${month}&date=${fromDate}`);
}

export default async function AdminCalendarPage({ searchParams }: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const admin = await requireAdmin();

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

  const selectedDate =
    resolvedSearchParams?.date && isValidDateString(resolvedSearchParams.date)
      ? resolvedSearchParams.date
      : todayKey;

  const prev = getPrevMonth(currentYear, currentMonth);
  const next = getNextMonth(currentYear, currentMonth);
  const prevDate = toDateKeyFromParts(prev.year, prev.month, 1);
  const nextDate = toDateKeyFromParts(next.year, next.month, 1);

  const monthDays = getMonthDaysMondayStart(currentYear, currentMonth);
  const monthRange = getMonthRange(currentYear, currentMonth);

  const { data: events, error } = await supabase
    .from("calendar_events")
    .select(
      "id, title, description, location, time_text, start_at, end_at, is_holiday, title_color, location_color, time_color, attendance_required, display_type"
    )
    .eq("group_id", admin.group_id)
    .gte("start_at", monthRange.start)
    .lt("start_at", monthRange.end)
    .order("start_at", { ascending: true });

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-3 text-gray-900 sm:p-8">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-2xl font-bold">カレンダー</h1>
          <p className="mt-6 rounded bg-red-100 p-4 text-red-700">
            データ取得エラー：{error.message}
          </p>
        </div>
      </main>
    );
  }

  const eventList = (events ?? []) as CalendarEvent[];
  const eventIds = eventList.map((event) => event.id);

  const { data: responses } =
    eventIds.length > 0
      ? await supabase
          .from("event_responses")
          .select("event_id, user_id, status")
          .in("event_id", eventIds)
      : { data: [] };

  const responseList = (responses ?? []) as EventResponse[];

  const currentAdminResponsesByEvent = new Map<string, EventResponse>();

  for (const response of responseList) {
    if (response.user_id === admin.id) {
      currentAdminResponsesByEvent.set(response.event_id, response);
    }
  }

  const summariesByEvent = new Map<
    string,
    { attend: number; pending: number; absent: number }
  >();

  for (const event of eventList) {
    summariesByEvent.set(event.id, {
      attend: 0,
      pending: 0,
      absent: 0,
    });
  }

  for (const response of responseList) {
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

  const selectedDateEvents = eventsByDate[selectedDate] ?? [];

  return (
    <main className="min-h-screen bg-gray-50 p-3 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              カレンダー管理
            </h1>
            <p className="mt-2 text-sm text-gray-700">
              日付をクリックすると、下部の予定登録欄に日付が入ります。
            </p>
            <p className="mt-1 text-sm text-gray-700">
              {admin.name} さんでログイン中
            </p>
          </div>

          <div className="flex gap-2">
            <a href="/admin" className="rounded border bg-white px-4 py-2">
              管理者画面に戻る
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
                href={`/admin/calendar?year=${prev.year}&month=${prev.month}&date=${prevDate}`}
                className="rounded border px-3 py-2 text-sm"
              >
                前月
              </a>

              <a
                href={`/admin/calendar?year=${today.getFullYear()}&month=${
                  today.getMonth() + 1
                }&date=${todayKey}`}
                className="rounded border px-3 py-2 text-sm"
              >
                今月
              </a>

              <a
                href={`/admin/calendar?year=${next.year}&month=${next.month}&date=${nextDate}`}
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
              const isSelected = selectedDate === dateKey;
              const dayOfWeek = date.getDay();
              const hasHolidayEvent = dayEvents.some((event) => event.is_holiday);

              const baseCellClass =
                "min-h-[118px] border-b border-r p-1 sm:min-h-36 sm:p-2";

              const cellClass =
                hasHolidayEvent || dayOfWeek === 0
                  ? `${baseCellClass} bg-red-50`
                  : dayOfWeek === 6
                    ? `${baseCellClass} bg-blue-50`
                    : isSelected
                      ? `${baseCellClass} bg-yellow-50`
                      : `${baseCellClass} bg-white`;

              return (
                <div key={dateKey} className={cellClass}>
                  <div className="flex items-start justify-between">
                    <a
                      href={`/admin/calendar?year=${currentYear}&month=${currentMonth}&date=${dateKey}#event-form`}
                      className={
                        isToday
                          ? "flex h-6 w-6 items-center justify-center rounded-full bg-black text-xs font-bold text-white sm:h-7 sm:w-7 sm:text-sm"
                          : isSelected
                            ? "flex h-6 w-6 items-center justify-center rounded-full bg-yellow-300 text-xs font-bold text-black sm:h-7 sm:w-7 sm:text-sm"
                            : "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-gray-900 hover:bg-gray-100 sm:h-7 sm:w-7 sm:text-sm"
                      }
                    >
                      {date.getDate()}
                    </a>

                    <a
                      href={`/admin/calendar?year=${currentYear}&month=${currentMonth}&date=${dateKey}#event-form`}
                      className="text-[10px] text-gray-700 underline sm:text-xs"
                    >
                      選択
                    </a>
                  </div>

                  <div className="mt-1 space-y-1 sm:mt-2">
                    {normalEvents.map((event) => {
                      const summary = summariesByEvent.get(event.id);
                      const adminResponse = currentAdminResponsesByEvent.get(
                        event.id
                      );

                      return (
                        <div
                          key={event.id}
                          className="rounded border bg-white p-1 text-left text-[10px] leading-tight shadow-sm sm:px-2 sm:py-2 sm:text-xs"
                        >
                          <a
                            href={`/admin/calendar/${event.id}`}
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

                          {event.attendance_required && (
                            <>
                              <div className="mt-2 hidden sm:block">
                                <AdminCalendarAttendanceSelect
                                  eventId={event.id}
                                  userId={admin.id}
                                  defaultStatus={adminResponse?.status ?? ""}
                                />
                              </div>

                              <a
                                href={`/admin/calendar/${event.id}`}
                                className={`mt-1 block rounded px-1 py-1 text-center text-[10px] font-bold sm:hidden ${statusPillClass(
                                  adminResponse?.status
                                )}`}
                              >
                                {statusLongLabel(adminResponse?.status)}
                              </a>
                            </>
                          )}

                          {event.attendance_required && summary && (
                            <p className="mt-1 whitespace-nowrap text-center text-[10px] font-medium text-gray-800 sm:text-left sm:text-[11px]">
                              〇{summary.attend} △{summary.pending} ×
                              {summary.absent}
                            </p>
                          )}

                          {!event.attendance_required && (
                            <p className="mt-1 rounded bg-gray-100 px-1 py-1 text-center text-[10px] font-medium text-gray-700">
                              出欠不要
                            </p>
                          )}

                          <a
                            href={`/admin/calendar/${event.id}`}
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
                          href={`/admin/calendar/${event.id}`}
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

        <section className="mt-8">
          <h2 className="text-lg font-bold">選択日の予定</h2>
          <p className="mt-1 text-sm text-gray-700">{formatDate(selectedDate)}</p>

          <div className="mt-4 space-y-3">
            {selectedDateEvents.map((event) => {
              const summary = summariesByEvent.get(event.id);

              return (
                <div key={event.id} className="rounded-lg bg-white p-5 shadow">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className="text-lg font-bold"
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

                      <p
                        className="mt-1 text-sm"
                        style={{ color: event.location_color || "#111827" }}
                      >
                        場所：{event.location || "未設定"}
                      </p>

                      <p
                        className="mt-1 text-sm"
                        style={{ color: event.time_color || "#111827" }}
                      >
                        時間：{event.time_text || "未設定"}
                      </p>

                      {event.description && (
                        <p className="mt-3 text-sm text-gray-700">
                          {event.description}
                        </p>
                      )}

                      {event.attendance_required && summary && (
                        <div className="mt-3 flex gap-2 text-sm">
                          <span className="rounded bg-green-100 px-2 py-1 text-green-800">
                            〇 出席 {summary.attend}
                          </span>
                          <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-800">
                            △ 未定 {summary.pending}
                          </span>
                          <span className="rounded bg-red-100 px-2 py-1 text-red-800">
                            × 欠席 {summary.absent}
                          </span>
                        </div>
                      )}

                      {event.attendance_required && (
                        <div className="mt-3 max-w-xs">
                          <p className="mb-1 text-xs text-gray-700">
                            自分の出欠
                          </p>
                          <AdminCalendarAttendanceSelect
                            eventId={event.id}
                            userId={admin.id}
                            defaultStatus={
                              currentAdminResponsesByEvent.get(event.id)
                                ?.status ?? ""
                            }
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <a
                        href={`/admin/calendar/${event.id}`}
                        className="rounded border px-3 py-2 text-sm"
                      >
                        詳細
                      </a>

                      <form action={deleteEvent}>
                        <input type="hidden" name="event_id" value={event.id} />
                        <input type="hidden" name="date" value={selectedDate} />
                        <button className="rounded border border-red-300 px-3 py-2 text-sm text-red-700">
                          削除
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}

            {selectedDateEvents.length === 0 && (
              <p className="rounded bg-white p-4 text-sm text-gray-700 shadow">
                選択日の予定はまだありません。
              </p>
            )}
          </div>
        </section>

        <section
          id="event-form"
          className="mt-8 scroll-mt-8 rounded-lg bg-white p-6 shadow"
        >
          <h2 className="text-lg font-bold">予定を登録</h2>
          <p className="mt-2 text-sm text-gray-700">
            選択中の日付：{formatDate(selectedDate)}
          </p>

          <form action={createEvent} className="mt-4 space-y-4">
            <input type="hidden" name="group_id" value={admin.group_id} />
            <input type="hidden" name="created_by" value={admin.id} />

            <div>
              <label className="block text-sm font-medium">日付</label>
              <input
                key={selectedDate}
                name="date"
                type="date"
                required
                defaultValue={selectedDate}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">予定名</label>
              <input
                name="title"
                required
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="例：通常練習 / 試合 / 〇〇中テスト / OFF"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">場所</label>
              <input
                name="location"
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="例：第一体育館"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">時間</label>
              <input
                name="time_text"
                type="text"
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="例：AM / PM / 終日 / 9:00-12:00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">内容</label>
              <textarea
                name="description"
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="例：基礎練習、試合形式、持ち物など"
              />
            </div>

            <details className="rounded border bg-gray-50 p-4">
              <summary className="cursor-pointer text-sm font-medium text-gray-700">
                詳細設定
              </summary>

              <div className="mt-4 space-y-4">
                <label className="flex items-center gap-2 text-sm">
                  <input name="is_holiday" type="checkbox" />
                  祝日扱いにする
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input name="attendance_required" type="checkbox" defaultChecked />
                  出欠回答を必要にする
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input name="display_type_period" type="checkbox" />
                  期間予定として下部に表示する
                </label>

                <div>
                  <p className="text-sm font-medium text-gray-700">文字色</p>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="flex items-center justify-between gap-3 rounded border bg-white px-3 py-2 text-sm">
                      <span>予定</span>
                      <input
                        name="title_color"
                        type="color"
                        defaultValue="#111827"
                        className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded border bg-white px-3 py-2 text-sm">
                      <span>場所</span>
                      <input
                        name="location_color"
                        type="color"
                        defaultValue="#111827"
                        className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded border bg-white px-3 py-2 text-sm">
                      <span>時間</span>
                      <input
                        name="time_color"
                        type="color"
                        defaultValue="#111827"
                        className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </details>

            <button className="rounded bg-black px-4 py-2 text-white">
              予定を登録
            </button>
          </form>
        </section>

        <section className="mt-8 rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-bold">予定まとめて登録</h2>
          <p className="mt-2 text-sm text-gray-700">
            期間と曜日を指定して、同じ予定をまとめて登録します。
          </p>

          <form action={bulkCreateEvents} className="mt-4 space-y-4">
            <input type="hidden" name="group_id" value={admin.group_id} />
            <input type="hidden" name="created_by" value={admin.id} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium">開始日</label>
                <input
                  name="from_date"
                  type="date"
                  required
                  defaultValue={toDateKeyFromParts(currentYear, currentMonth, 1)}
                  className="mt-1 w-full rounded border px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium">終了日</label>
                <input
                  name="to_date"
                  type="date"
                  required
                  defaultValue={toDateKeyFromParts(
                    currentYear,
                    currentMonth,
                    new Date(currentYear, currentMonth, 0).getDate()
                  )}
                  className="mt-1 w-full rounded border px-3 py-2"
                />
              </div>
            </div>

            <div>
              <p className="text-sm font-medium">曜日</p>
              <div className="mt-2 grid grid-cols-7 gap-2">
                {WEEKDAYS.map((day) => (
                  <label
                    key={day.value}
                    className="flex items-center justify-center gap-1 rounded border p-2 text-sm"
                  >
                    <input name="weekdays" type="checkbox" value={day.value} />
                    {day.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium">予定名</label>
              <input
                name="bulk_title"
                required
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="例：通常練習 / 〇〇中テスト"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">場所</label>
              <input
                name="bulk_location"
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="例：第一体育館"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">時間</label>
              <input
                name="bulk_time_text"
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="例：AM / PM / 終日 / 9:00-12:00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">内容</label>
              <textarea
                name="bulk_description"
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="例：基礎練習、試合形式、持ち物など"
              />
            </div>

            <details className="rounded border bg-gray-50 p-4">
              <summary className="cursor-pointer text-sm font-medium text-gray-700">
                詳細設定
              </summary>

              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input name="overwrite" type="checkbox" />
                    既存予定を上書きする
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input name="bulk_is_holiday" type="checkbox" />
                    祝日扱いにする
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      name="bulk_attendance_required"
                      type="checkbox"
                      defaultChecked
                    />
                    出欠回答を必要にする
                  </label>

                  <label className="flex items-center gap-2 text-sm">
                    <input name="bulk_display_type_period" type="checkbox" />
                    期間予定として下部に表示する
                  </label>
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-700">文字色</p>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="flex items-center justify-between gap-3 rounded border bg-white px-3 py-2 text-sm">
                      <span>予定</span>
                      <input
                        name="bulk_title_color"
                        type="color"
                        defaultValue="#111827"
                        className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded border bg-white px-3 py-2 text-sm">
                      <span>場所</span>
                      <input
                        name="bulk_location_color"
                        type="color"
                        defaultValue="#111827"
                        className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded border bg-white px-3 py-2 text-sm">
                      <span>時間</span>
                      <input
                        name="bulk_time_color"
                        type="color"
                        defaultValue="#111827"
                        className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </details>

            <button className="rounded bg-black px-4 py-2 text-white">
              まとめて登録
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}