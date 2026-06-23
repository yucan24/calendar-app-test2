import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";

type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  time_text: string | null;
};

type PageProps = {
  searchParams?: Promise<{
    year?: string;
    month?: string;
    date?: string;
  }>;
};

async function createEvent(formData: FormData) {
  "use server";

  const groupId = String(formData.get("group_id"));
  const createdBy = String(formData.get("created_by"));
  const date = String(formData.get("date"));
  const title = String(formData.get("title"));
  const description = String(formData.get("description") ?? "");
  const location = String(formData.get("location") ?? "");
const timeText = String(formData.get("time_text") ?? "");

if (!groupId || !createdBy || !date || !title) {
  throw new Error("必須項目が不足しています");
}

// カレンダー上の日付管理用。時間は便宜上 00:00 に固定する。
const startAt = new Date(`${date}T00:00:00+09:00`).toISOString();
const endAt = null;

const { error } = await supabase.from("calendar_events").insert({
  group_id: groupId,
  created_by: createdBy,
  title,
  description,
  location,
  time_text: timeText,
  start_at: startAt,
  end_at: endAt,
});
  if (error) {
    throw new Error(error.message);
  }

  const target = new Date(`${date}T00:00:00+09:00`);
  const year = target.getFullYear();
  const month = target.getMonth() + 1;

  revalidatePath("/admin/calendar");
  redirect(`/admin/calendar?year=${year}&month=${month}&date=${date}`);
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function toDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const date = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${date}`;
}

function isValidDateString(value: string | undefined) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  const firstWeekday = firstDay.getDay();
  const lastDate = lastDay.getDate();

  const cells: Array<Date | null> = [];

  for (let i = 0; i < firstWeekday; i++) {
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

export default async function AdminCalendarPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;

  const today = new Date();
  const todayKey = toDateKey(today);

  const currentYear = resolvedSearchParams?.year
    ? Number(resolvedSearchParams.year)
    : today.getFullYear();

  const currentMonth = resolvedSearchParams?.month
    ? Number(resolvedSearchParams.month)
    : today.getMonth() + 1;

 const selectedDate = isValidDateString(resolvedSearchParams?.date)
   ? resolvedSearchParams?.date
   : todayKey;

  const prev = getPrevMonth(currentYear, currentMonth);
  const next = getNextMonth(currentYear, currentMonth);
  const monthDays = getMonthDays(currentYear, currentMonth);
  const monthRange = getMonthRange(currentYear, currentMonth);

  const { data: admin } = await supabase
    .from("profiles")
    .select("id, group_id, name")
    .eq("role", "admin")
    .limit(1)
    .single();

  if (!admin) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-2xl font-bold">カレンダー</h1>
          <p className="mt-6 rounded bg-red-100 p-4 text-red-700">
            管理者データが見つかりません。
          </p>
        </div>
      </main>
    );
  }

  const { data: events, error } = await supabase
    .from("calendar_events")
    .select("id, title, description, location, start_at, end_at, time_text")
    .eq("group_id", admin.group_id)
    .gte("start_at", monthRange.start)
    .lt("start_at", monthRange.end)
    .order("start_at", { ascending: true });

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
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

  const selectedDateEvents = selectedDate
    ? eventsByDate[selectedDate] ?? []
    : [];

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">カレンダー管理</h1>
            <p className="mt-2 text-sm text-gray-600">
              日付をクリックすると、下部の予定登録欄に日付が入ります。
            </p>
          </div>

          <a href="/admin" className="rounded border bg-white px-4 py-2">
            管理者画面に戻る
          </a>
        </div>

        <section className="mt-8 rounded-lg bg-white p-4 shadow">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold">
              {currentYear}年{currentMonth}月
            </h2>

            <div className="flex gap-2">
              <a
 		 href={`/admin/calendar?year=${prev.year}&month=${prev.month}&date=${prev.year}-${String(prev.month).padStart(2, "0")}-01`}
		 className="rounded border px-3 py-2 text-sm"
	      >
                 前月
              </a>
	      <a
		  href={`/admin/calendar?year=${today.getFullYear()}&month=${today.getMonth() + 1}&date=${todayKey}`}
  		　className="rounded border px-3 py-2 text-sm"
              >
                今月
              </a>

              <a
  		href={`/admin/calendar?year=${next.year}&month=${next.month}&date=${next.year}-${String(next.month).padStart(2, "0")}-01`}
  		className="rounded border px-3 py-2 text-sm"
              >
                翌月
              </a>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-7 border-l border-t text-center text-sm font-bold">
            {["日", "月", "火", "水", "木", "金", "土"].map((day) => (
              <div key={day} className="border-b border-r bg-gray-100 p-2">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 border-l text-sm">
            {monthDays.map((date, index) => {
              if (!date) {
                return (
                  <div
                    key={`empty-${index}`}
                    className="min-h-32 border-b border-r bg-gray-50 p-2"
                  />
                );
              }

              const dateKey = toDateKey(date);
              const dayEvents = eventsByDate[dateKey] ?? [];
              const isToday = todayKey === dateKey;
              const isSelected = selectedDate === dateKey;

              return (
                <div
                  key={dateKey}
                  className={
                    isSelected
                      ? "min-h-32 border-b border-r bg-yellow-50 p-2"
                      : "min-h-32 border-b border-r bg-white p-2"
                  }
                >
                  <div className="flex items-center justify-between">
                    <a
                      href={`/admin/calendar?year=${currentYear}&month=${currentMonth}&date=${dateKey}`}
                      className={
                        isToday
                          ? "flex h-7 w-7 items-center justify-center rounded-full bg-black text-white"
                          : isSelected
                            ? "flex h-7 w-7 items-center justify-center rounded-full bg-yellow-200 font-bold"
                            : "flex h-7 w-7 items-center justify-center rounded-full hover:bg-gray-100"
                      }
                    >
                      {date.getDate()}
                    </a>

                    <a
                      href={`/admin/calendar?year=${currentYear}&month=${currentMonth}&date=${dateKey}`}
                      className="text-xs text-gray-500 underline"
                    >
                      選択
                    </a>
                  </div>

                  <div className="mt-2 space-y-1">
                    {dayEvents.map((event) => (
                      <a
                        key={event.id}
                        href={`/admin/calendar/${event.id}`}
                        className="block rounded border bg-gray-50 px-2 py-1 text-left text-xs hover:bg-gray-100"
                      >
			<p className="font-bold">
			  {event.time_text ? `${event.time_text} ` : ""}
			  {event.title}
			</p>
                        {event.location && (
                          <p className="truncate text-gray-600">
                            {event.location}
                          </p>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-8 rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-bold">予定を登録</h2>
          <p className="mt-2 text-sm text-gray-600">
            選択中の日付：{selectedDate ? formatDate(selectedDate) : "未選択"}
          </p>

          <form action={createEvent} className="mt-4 space-y-4">
            <input type="hidden" name="group_id" value={admin.group_id} />
            <input type="hidden" name="created_by" value={admin.id} />

            <div>
              <label className="block text-sm font-medium">日付</label>
              <input
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
                placeholder="例：通常練習"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">内容</label>
              <textarea
                name="description"
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="例：基礎練習、試合形式"
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
  <p className="mt-1 text-xs text-gray-500">
    AM/PM/終日/9:00-12:00 など。
  </p>
</div>

            <button className="rounded bg-black px-4 py-2 text-white">
              予定を登録
            </button>
          </form>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold">
            選択日の予定
          </h2>

          <div className="mt-4 space-y-3">
            {selectedDateEvents.map((event) => (
              <div key={event.id} className="rounded-lg bg-white p-5 shadow">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-lg font-bold">{event.title}</p>
                    <p className="mt-1 text-sm text-gray-600">
		 	 時間：{event.time_text || "未設定"}
		    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      場所：{event.location || "未設定"}
                    </p>
                    {event.description && (
                      <p className="mt-3 text-sm text-gray-700">
                        {event.description}
                      </p>
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
            ))}

            {selectedDateEvents.length === 0 && (
              <p className="rounded bg-white p-4 text-sm text-gray-600 shadow">
                選択日の予定はまだありません。
              </p>
            )}
          </div>
        </section>
<section className="mt-8 rounded-lg bg-white p-6 shadow">
  <h2 className="text-lg font-bold">予定を登録</h2>
  <p className="mt-2 text-sm text-gray-600">
    選択中の日付：{selectedDate ? formatDate(selectedDate) : "未選択"}
  </p>

  <form action={createEvent} className="mt-4 space-y-4">
    ...
  </form>
</section>
      </div>
    </main>
  );
}