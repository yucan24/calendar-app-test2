import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

type EventResponse = {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  note: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "未設定";

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function toDateKey(value: string | null) {
  if (!value) return "";

  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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
  return "bg-gray-100 text-gray-600";
}

async function submitResponse(formData: FormData) {
  "use server";

  const eventId = String(formData.get("event_id"));
  const userId = String(formData.get("user_id"));
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "");

  if (!eventId || !userId) {
    throw new Error("必須項目が不足しています");
  }

  // 未回答に戻す場合は、回答レコードを削除する
  if (!status) {
    const { error } = await supabase
      .from("event_responses")
      .delete()
      .eq("event_id", eventId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath(`/user/calendar/${eventId}`);
    revalidatePath("/user/calendar");
    redirect(`/user/calendar/${eventId}`);
  }

  const { error } = await supabase.from("event_responses").upsert(
    {
      event_id: eventId,
      user_id: userId,
      status,
      note,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "event_id,user_id",
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/user/calendar/${eventId}`);
  revalidatePath("/user/calendar");
  redirect(`/user/calendar/${eventId}`);
}

export default async function UserCalendarDetailPage({ params }: PageProps) {
  const { id } = await params;

  const currentUser = await requireUser();

  const { data: event, error: eventError } = await supabase
    .from("calendar_events")
    .select(
      "id, group_id, title, description, location, time_text, start_at, is_holiday, title_color, location_color, time_color, attendance_required, display_type"
    )
    .eq("id", id)
    .single();

  if (eventError || !event) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold">予定詳細</h1>

          <p className="mt-6 rounded bg-red-100 p-4 text-red-700">
            予定が見つかりません。
          </p>

          <a
            href="/user/calendar"
            className="mt-6 inline-block rounded border bg-white px-4 py-2"
          >
            カレンダーに戻る
          </a>
        </div>
      </main>
    );
  }

  if (event.group_id !== currentUser.group_id) {
    redirect("/user/calendar");
  }

  const { data: response } = await supabase
    .from("event_responses")
    .select("id, event_id, user_id, status, note")
    .eq("event_id", event.id)
    .eq("user_id", currentUser.id)
    .maybeSingle();

  const { data: allResponses } = await supabase
    .from("event_responses")
    .select("status")
    .eq("event_id", event.id);

  const summary = {
    attend: (allResponses ?? []).filter((item) => item.status === "attend")
      .length,
    pending: (allResponses ?? []).filter((item) => item.status === "pending")
      .length,
    absent: (allResponses ?? []).filter((item) => item.status === "absent")
      .length,
  };

  const myResponse = response as EventResponse | null;
  const eventDate = toDateKey(event.start_at);
  const eventYear = new Date(event.start_at).getFullYear();
  const eventMonth = new Date(event.start_at).getMonth() + 1;

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">予定詳細</h1>
            <p className="mt-2 text-sm text-gray-600">
              {currentUser.name} さんでログイン中
            </p>
          </div>

          <a
            href={`/user/calendar?year=${eventYear}&month=${eventMonth}`}
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

          {event.attendance_required ? (
            <>
              <div className="mt-5">
                <span
                  className={`rounded px-3 py-1 text-sm font-medium ${statusClass(
                    myResponse?.status
                  )}`}
                >
                  現在の回答：{statusLabel(myResponse?.status)}
                </span>
              </div>

              <div className="mt-4">
                <p className="text-sm font-medium text-gray-700">全体集計</p>
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  <span className="rounded bg-green-100 px-3 py-1 text-green-800">
                    〇 出席 {summary.attend}
                  </span>
                  <span className="rounded bg-yellow-100 px-3 py-1 text-yellow-800">
                    △ 未定 {summary.pending}
                  </span>
                  <span className="rounded bg-red-100 px-3 py-1 text-red-800">
                    × 欠席 {summary.absent}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-5 rounded bg-gray-50 p-4 text-sm text-gray-600">
              この予定は出欠回答不要です。
            </div>
          )}
        </section>

        {event.attendance_required && (
          <section className="mt-6 rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-bold">回答する</h2>

            <form action={submitResponse} className="mt-4 space-y-4">
              <input type="hidden" name="event_id" value={event.id} />
              <input type="hidden" name="user_id" value={currentUser.id} />

              <div>
                <label className="block text-sm font-medium">出欠</label>
                <select
                  name="status"
                  defaultValue={myResponse?.status ?? ""}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  <option value="">未回答</option>
                  <option value="attend">〇 出席</option>
                  <option value="pending">△ 未定</option>
                  <option value="absent">× 欠席</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium">備考</label>
                <textarea
                  name="note"
                  defaultValue={myResponse?.note ?? ""}
                  className="mt-1 w-full rounded border px-3 py-2"
                  placeholder="遅刻、早退、欠席理由など"
                />
              </div>

              <button className="rounded bg-black px-4 py-2 text-white">
                回答を保存
              </button>
            </form>
          </section>
        )}

        <a
          href={`/user/calendar?year=${eventYear}&month=${eventMonth}`}
          className="mt-6 inline-block rounded border bg-white px-4 py-2"
        >
          戻る
        </a>
      </div>
    </main>
  );
}