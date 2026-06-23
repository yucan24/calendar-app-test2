import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";
import AdminAttendanceSelect from "./AdminAttendanceSelect";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

type Profile = {
  id: string;
  name: string;
  role: string;
};

type EventResponse = {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  note: string | null;
};

function toDateKey(value: string | null) {
  if (!value) return "";

  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toUtcISOStringFromDateKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+09:00`).toISOString();
}

function formatDate(value: string | null) {
  if (!value) return "未設定";

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function safeColor(value: FormDataEntryValue | null, fallback = "#000000") {
  const text = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
}

function statusLabel(status: string | null | undefined) {
  if (status === "attend") return "〇 出席";
  if (status === "absent") return "× 欠席";
  if (status === "pending") return "△ 未定";
  return "未回答";
}

function statusBadgeClass(status: string | null | undefined) {
  if (status === "attend") return "bg-green-100 text-green-800";
  if (status === "absent") return "bg-red-100 text-red-800";
  if (status === "pending") return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-600";
}

function createSummary(
  rows: Array<{ profile: Profile; response?: EventResponse }>
) {
  return {
    attend: rows.filter((row) => row.response?.status === "attend").length,
    absent: rows.filter((row) => row.response?.status === "absent").length,
    pending: rows.filter((row) => row.response?.status === "pending").length,
    noAnswer: rows.filter((row) => !row.response).length,
  };
}

async function updateEvent(formData: FormData) {
  "use server";

  const id = String(formData.get("id"));
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

  if (!id || !date || !title) {
    throw new Error("必須項目が不足しています");
  }

  const startAt = toUtcISOStringFromDateKey(date);

  const { error } = await supabase
    .from("calendar_events")
    .update({
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/calendar/${id}`);
  revalidatePath("/admin/calendar");
  redirect(`/admin/calendar/${id}`);
}

async function deleteEvent(formData: FormData) {
  "use server";

  const id = String(formData.get("id"));

  if (!id) {
    throw new Error("削除対象が不明です");
  }

  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/calendar");
  redirect("/admin/calendar");
}

export default async function AdminCalendarDetailPage({ params }: PageProps) {
  const { id } = await params;

  const currentAdmin = await requireAdmin();

  const { data: event, error: eventError } = await supabase
    .from("calendar_events")
    .select(
      "id, group_id, title, description, location, time_text, start_at, end_at, is_holiday, title_color, location_color, time_color, attendance_required, display_type"
    )
    .eq("id", id)
    .single();

  if (eventError || !event) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-bold">予定詳細</h1>

          <p className="mt-6 rounded bg-red-100 p-4 text-red-700">
            予定が見つかりません。
          </p>

          <a
            href="/admin/calendar"
            className="mt-6 inline-block rounded border bg-white px-4 py-2"
          >
            カレンダーに戻る
          </a>
        </div>
      </main>
    );
  }

  if (event.group_id !== currentAdmin.group_id) {
    redirect("/admin/calendar");
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, name, role")
    .eq("group_id", event.group_id)
    .order("role", { ascending: true })
    .order("name", { ascending: true });

  const { data: responses, error: responsesError } = await supabase
    .from("event_responses")
    .select("id, event_id, user_id, status, note")
    .eq("event_id", event.id);

  if (responsesError) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-bold">予定詳細</h1>

          <p className="mt-6 rounded bg-red-100 p-4 text-red-700">
            出欠取得エラー：{responsesError.message}
          </p>

          <a
            href="/admin/calendar"
            className="mt-6 inline-block rounded border bg-white px-4 py-2"
          >
            カレンダーに戻る
          </a>
        </div>
      </main>
    );
  }

  const profileList = (profiles ?? []) as Profile[];
  const responseList = (responses ?? []) as EventResponse[];

  const rows = profileList.map((profile) => {
    const response = responseList.find((item) => item.user_id === profile.id);

    return {
      profile,
      response,
    };
  });

  const coachRows = rows.filter((row) => row.profile.role === "admin");
  const playerRows = rows.filter((row) => row.profile.role === "user");

  const coachSummary = createSummary(coachRows);
  const playerSummary = createSummary(playerRows);

  const currentAdminResponse = responseList.find(
    (response) => response.user_id === currentAdmin.id
  );

  const eventDate = toDateKey(event.start_at);
  const eventYear = new Date(event.start_at).getFullYear();
  const eventMonth = new Date(event.start_at).getMonth() + 1;

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">予定詳細</h1>
            <p className="mt-2 text-sm text-gray-600">
              {currentAdmin.name} さんでログイン中
            </p>
          </div>

          <a
            href={`/admin/calendar?year=${eventYear}&month=${eventMonth}&date=${eventDate}`}
            className="rounded border bg-white px-4 py-2 text-center"
          >
            カレンダーに戻る
          </a>
        </div>

        <section className="mt-6 rounded-lg bg-white p-6 shadow">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-gray-600">
              {formatDate(event.start_at)}
            </p>

            {event.is_holiday && (
              <span className="rounded bg-red-100 px-2 py-1 text-xs text-red-700">
                祝日扱い
              </span>
            )}

            {event.display_type === "period" && (
              <span className="rounded bg-teal-100 px-2 py-1 text-xs text-teal-800">
                期間予定
              </span>
            )}

            {!event.attendance_required && (
              <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
                出欠不要
              </span>
            )}
          </div>

          <h2
            className="mt-3 text-2xl font-bold"
            style={{ color: event.title_color || "#000000" }}
          >
            {event.title}
          </h2>

          <p
            className="mt-3 text-sm"
            style={{ color: event.location_color || "#000000" }}
          >
            場所：{event.location || "未設定"}
          </p>

          <p
            className="mt-1 text-sm"
            style={{ color: event.time_color || "#000000" }}
          >
            時間：{event.time_text || "未設定"}
          </p>

          {event.description && (
            <p className="mt-4 whitespace-pre-wrap text-sm text-gray-700">
              {event.description}
            </p>
          )}
        </section>

        {event.attendance_required ? (
          <section className="mt-8 rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-bold">自分の出欠回答</h2>
            <p className="mt-2 text-sm text-gray-600">
              指導者としての自分の回答です。
            </p>

            <div className="mt-4">
              <span
                className={`rounded px-3 py-1 text-sm font-medium ${statusBadgeClass(
                  currentAdminResponse?.status
                )}`}
              >
                現在の回答：{statusLabel(currentAdminResponse?.status)}
              </span>
            </div>

            <div className="mt-4">
              <AdminAttendanceSelect
                eventId={event.id}
                userId={currentAdmin.id}
                defaultStatus={currentAdminResponse?.status ?? ""}
                defaultNote={currentAdminResponse?.note ?? ""}
              />
            </div>
          </section>
        ) : (
          <section className="mt-8 rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-bold">出欠回答</h2>
            <p className="mt-2 rounded bg-gray-50 p-4 text-sm text-gray-600">
              この予定は出欠回答不要です。
            </p>
          </section>
        )}

        {event.attendance_required && (
          <section className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-white p-5 shadow">
              <h2 className="text-lg font-bold">指導者 集計</h2>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-sm">
                <div className="rounded bg-green-100 p-2 text-green-800">
                  <p>出席</p>
                  <p className="text-xl font-bold">{coachSummary.attend}</p>
                </div>
                <div className="rounded bg-red-100 p-2 text-red-800">
                  <p>欠席</p>
                  <p className="text-xl font-bold">{coachSummary.absent}</p>
                </div>
                <div className="rounded bg-yellow-100 p-2 text-yellow-800">
                  <p>未定</p>
                  <p className="text-xl font-bold">{coachSummary.pending}</p>
                </div>
                <div className="rounded bg-gray-100 p-2 text-gray-600">
                  <p>未回答</p>
                  <p className="text-xl font-bold">{coachSummary.noAnswer}</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-white p-5 shadow">
              <h2 className="text-lg font-bold">選手 集計</h2>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-sm">
                <div className="rounded bg-green-100 p-2 text-green-800">
                  <p>出席</p>
                  <p className="text-xl font-bold">{playerSummary.attend}</p>
                </div>
                <div className="rounded bg-red-100 p-2 text-red-800">
                  <p>欠席</p>
                  <p className="text-xl font-bold">{playerSummary.absent}</p>
                </div>
                <div className="rounded bg-yellow-100 p-2 text-yellow-800">
                  <p>未定</p>
                  <p className="text-xl font-bold">{playerSummary.pending}</p>
                </div>
                <div className="rounded bg-gray-100 p-2 text-gray-600">
                  <p>未回答</p>
                  <p className="text-xl font-bold">{playerSummary.noAnswer}</p>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="mt-8 rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-bold">予定を編集</h2>

          <form action={updateEvent} className="mt-4 space-y-4">
            <input type="hidden" name="id" value={event.id} />

            <div>
              <label className="block text-sm font-medium">日付</label>
              <input
                name="date"
                type="date"
                required
                defaultValue={eventDate}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">予定名</label>
              <input
                name="title"
                required
                defaultValue={event.title}
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="例：通常練習 / 試合 / 〇〇中テスト / OFF"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">場所</label>
              <input
                name="location"
                defaultValue={event.location ?? ""}
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="例：第一体育館"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">時間</label>
              <input
                name="time_text"
                defaultValue={event.time_text ?? ""}
                className="mt-1 w-full rounded border px-3 py-2"
                placeholder="例：AM / PM / 終日 / 9:00-12:00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">内容</label>
              <textarea
                name="description"
                defaultValue={event.description ?? ""}
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
                  <input
                    name="is_holiday"
                    type="checkbox"
                    defaultChecked={event.is_holiday}
                  />
                  祝日扱いにする
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    name="attendance_required"
                    type="checkbox"
                    defaultChecked={event.attendance_required}
                  />
                  出欠回答を必要にする
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    name="display_type_period"
                    type="checkbox"
                    defaultChecked={event.display_type === "period"}
                  />
                  期間予定として下部に表示する
                </label>

                <div>
                  <p className="text-sm font-medium text-gray-700">文字色</p>
                  <p className="mt-1 text-xs text-gray-500">
                    必要な場合だけ変更します。通常は黒のままで問題ありません。
                  </p>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="flex items-center justify-between gap-3 rounded border bg-white px-3 py-2 text-sm">
                      <span>予定</span>
                      <input
                        name="title_color"
                        type="color"
                        defaultValue={event.title_color || "#000000"}
                        className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded border bg-white px-3 py-2 text-sm">
                      <span>場所</span>
                      <input
                        name="location_color"
                        type="color"
                        defaultValue={event.location_color || "#000000"}
                        className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded border bg-white px-3 py-2 text-sm">
                      <span>時間</span>
                      <input
                        name="time_color"
                        type="color"
                        defaultValue={event.time_color || "#000000"}
                        className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </details>

            <button className="rounded bg-black px-4 py-2 text-white">
              更新する
            </button>
          </form>

          <form action={deleteEvent} className="mt-4">
            <input type="hidden" name="id" value={event.id} />
            <button className="rounded border border-red-300 px-4 py-2 text-red-700">
              この予定を削除
            </button>
          </form>
        </section>

        {event.attendance_required && (
          <section className="mt-8 rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-bold">出欠一覧</h2>
            <p className="mt-2 text-sm text-gray-600">
              管理者のみ、誰がどう回答しているか確認できます。
            </p>

            <div className="mt-4 space-y-3">
              {rows.map((row) => (
                <div key={row.profile.id} className="rounded border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-bold">{row.profile.name}</p>
                      <p className="text-sm text-gray-600">
                        {row.profile.role === "admin" ? "指導者" : "選手"}
                      </p>

                      {row.response?.note && (
                        <p className="mt-2 text-sm text-gray-700">
                          備考：{row.response.note}
                        </p>
                      )}
                    </div>

                    <span
                      className={`rounded px-3 py-1 text-sm font-medium ${statusBadgeClass(
                        row.response?.status
                      )}`}
                    >
                      {statusLabel(row.response?.status)}
                    </span>
                  </div>
                </div>
              ))}

              {rows.length === 0 && (
                <p className="rounded bg-gray-50 p-4 text-sm text-gray-600">
                  メンバーが登録されていません。
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}