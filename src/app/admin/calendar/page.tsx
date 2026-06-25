import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";
import AdminCalendarClient from "./AdminCalendarClient";

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

type ProfileRole = {
  id: string;
  role: "admin" | "user";
};

type EventSummary = {
  attend: number;
  pending: number;
  absent: number;
  coachAttend: number;
  playerAttend: number;
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

function toTokyoDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
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

function getMonthRangeTokyo(year: number, month: number) {
  const startKey = toDateKeyFromParts(year, month, 1);

  const next =
    month === 12
      ? { year: year + 1, month: 1 }
      : { year, month: month + 1 };

  const endKey = toDateKeyFromParts(next.year, next.month, 1);

  return {
    start: toUtcISOStringFromDateKey(startKey),
    end: toUtcISOStringFromDateKey(endKey),
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

async function createEvent(formData: FormData) {
  "use server";

  const admin = await requireAdmin();

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

  if (!date || !title) {
    throw new Error("日付と予定名を入力してください");
  }

  const startAt = toUtcISOStringFromDateKey(date);

  const { error } = await supabase.from("calendar_events").insert({
    group_id: admin.group_id,
    created_by: admin.id,
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

async function bulkCreateEvents(formData: FormData) {
  "use server";

  const admin = await requireAdmin();

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

  if (!fromDate || !toDate || !title) {
    throw new Error("開始日、終了日、予定名を入力してください");
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
      dateKeys.push(toTokyoDateKey(cursor));
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
    .eq("group_id", admin.group_id)
    .gte("start_at", rangeStart)
    .lte("start_at", rangeEnd);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingByDate = new Map<string, string>();

  for (const event of existingEvents ?? []) {
    const dateKey = toTokyoDateKey(new Date(event.start_at));

    if (!existingByDate.has(dateKey)) {
      existingByDate.set(dateKey, event.id);
    }
  }

  const rowsToInsert = [];
  const rowsToUpdate = [];

  for (const dateKey of dateKeys) {
    const existingId = existingByDate.get(dateKey);

    const row = {
      group_id: admin.group_id,
      created_by: admin.id,
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
      .eq("id", id)
      .eq("group_id", admin.group_id);

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

  const todayKey = toTokyoDateKey(new Date());
  const [todayYear, todayMonth] = todayKey.split("-").map(Number);

  const yearParam = Number(resolvedSearchParams?.year);
  const monthParam = Number(resolvedSearchParams?.month);

  const currentYear = Number.isFinite(yearParam) ? yearParam : todayYear;

  const currentMonth =
    Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12
      ? monthParam
      : todayMonth;

  const selectedDate =
    resolvedSearchParams?.date && isValidDateString(resolvedSearchParams.date)
      ? resolvedSearchParams.date
      : todayKey;

  const monthRange = getMonthRangeTokyo(currentYear, currentMonth);

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
          <h1 className="text-2xl font-bold">カレンダー管理</h1>
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

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("group_id", admin.group_id);

  const responseList = (responses ?? []) as EventResponse[];
  const profileRoles = (profiles ?? []) as ProfileRole[];

  const roleByUser = new Map<string, "admin" | "user">();

  for (const profile of profileRoles) {
    roleByUser.set(profile.id, profile.role);
  }

  const adminResponses = responseList.filter(
    (response) => response.user_id === admin.id
  );

  const summariesByEvent: Record<string, EventSummary> = {};

  for (const event of eventList) {
    summariesByEvent[event.id] = {
      attend: 0,
      pending: 0,
      absent: 0,
      coachAttend: 0,
      playerAttend: 0,
    };
  }

  for (const response of responseList) {
    const summary = summariesByEvent[response.event_id];

    if (!summary) continue;

    if (response.status === "attend") {
      summary.attend += 1;

      const role = roleByUser.get(response.user_id);

      if (role === "admin") {
        summary.coachAttend += 1;
      }

      if (role === "user") {
        summary.playerAttend += 1;
      }
    }

    if (response.status === "pending") {
      summary.pending += 1;
    }

    if (response.status === "absent") {
      summary.absent += 1;
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-3 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              カレンダー管理
            </h1>
            <p className="mt-2 text-sm text-gray-700">
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

        <AdminCalendarClient
          currentAdmin={{
            id: admin.id,
            name: admin.name,
          }}
          currentYear={currentYear}
          currentMonth={currentMonth}
          todayKey={todayKey}
          events={eventList}
          adminResponses={adminResponses}
          summariesByEvent={summariesByEvent}
        />

        <section
          id="event-form"
          className="mt-8 scroll-mt-8 rounded-lg bg-white p-6 shadow"
        >
          <h2 className="text-lg font-bold">予定を登録</h2>
          <p className="mt-2 text-sm text-gray-700">
            選択中の日付：{formatDate(selectedDate)}
          </p>

          <form action={createEvent} className="mt-4 space-y-4">
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
                placeholder="例：通常練習 / 試合 / テスト期間 / OFF"
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
                placeholder="例：通常練習 / テスト期間"
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
