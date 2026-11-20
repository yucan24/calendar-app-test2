import PageHeader from "@/components/ui/PageHeader";
import { getJstDateKey } from "@/lib/month";

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";
import SubmitButton from "@/components/SubmitButton";
import AdminAttendanceSelect from "./AdminAttendanceSelect";
import { updateEvent, deleteEvent } from "./actions";

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

function formatDate(value: string | null) {
  if (!value) return "未設定";

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
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
      <main className="ui-page">
        <div className="mx-auto max-w-4xl">
          <PageHeader title={<>予定詳細</>} backHref="/admin/calendar" backLabel="カレンダーに戻る" />

          <p className="mt-6 rounded bg-red-100 p-4 text-red-700">
            予定が見つかりません。
          </p>


        </div>
      </main>
    );
  }

  if (event.group_id !== currentAdmin.group_id) {
    redirect("/admin/calendar");
  }

  const eventDate = getJstDateKey(event.start_at);

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
      <main className="ui-page">
        <div className="mx-auto max-w-4xl">
          <PageHeader title={<>予定詳細</>} backHref={`/admin/calendar?month=${eventDate.slice(0, 7)}&date=${eventDate}`} backLabel="カレンダーに戻る" />

          <p className="mt-6 rounded bg-red-100 p-4 text-red-700">
            出欠取得エラー：{responsesError.message}
          </p>


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


  return (
    <main className="ui-page">
      <div className="mx-auto max-w-4xl">
        <PageHeader title={<>予定詳細</>} backHref={`/admin/calendar?month=${eventDate.slice(0, 7)}&date=${eventDate}`} backLabel="カレンダーに戻る" />

        <section className="ui-card mt-6">
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
            className="ui-section-title mt-3"
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
          <section className="ui-card mt-8">
            <h2 className="ui-section-title">自分の出欠回答</h2>
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
          <section className="ui-card mt-8">
            <h2 className="ui-section-title">出欠回答</h2>
            <p className="mt-2 rounded bg-gray-50 p-4 text-sm text-gray-600">
              この予定は出欠回答不要です。
            </p>
          </section>
        )}

        {event.attendance_required && (
          <section className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="ui-card">
              <h2 className="ui-section-title">指導者 集計</h2>
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

            <div className="ui-card">
              <h2 className="ui-section-title">選手 集計</h2>
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

        <section className="ui-card mt-8">
          <h2 className="ui-section-title">予定を編集</h2>

          <form action={updateEvent} className="mt-4 space-y-4">
            <input type="hidden" name="id" value={event.id} />

            <div>
              <label className="block text-sm font-medium">日付</label>
              <input
                name="date"
                type="date"
                required
                defaultValue={eventDate}
                className="ui-field mt-1 w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">予定名</label>
              <input
                name="title"
                required
                defaultValue={event.title}
                className="ui-field mt-1 w-full"
                placeholder="例：通常練習 / 試合 / 〇〇中テスト / OFF"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">場所</label>
              <input
                name="location"
                defaultValue={event.location ?? ""}
                className="ui-field mt-1 w-full"
                placeholder="例：第一体育館"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">時間</label>
              <input
                name="time_text"
                defaultValue={event.time_text ?? ""}
                className="ui-field mt-1 w-full"
                placeholder="例：AM / PM / 終日 / 9:00-12:00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">内容</label>
              <textarea
                name="description"
                defaultValue={event.description ?? ""}
                className="ui-field mt-1 w-full"
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
                        className="ui-field h-7 w-10 cursor-pointer bg-transparent"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded border bg-white px-3 py-2 text-sm">
                      <span>場所</span>
                      <input
                        name="location_color"
                        type="color"
                        defaultValue={event.location_color || "#000000"}
                        className="ui-field h-7 w-10 cursor-pointer bg-transparent"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded border bg-white px-3 py-2 text-sm">
                      <span>時間</span>
                      <input
                        name="time_color"
                        type="color"
                        defaultValue={event.time_color || "#000000"}
                        className="ui-field h-7 w-10 cursor-pointer bg-transparent"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </details>

            <SubmitButton className="ui-button ui-button-primary">
              更新する
            </SubmitButton>
          </form>

          <form action={deleteEvent} className="mt-4">
            <input type="hidden" name="id" value={event.id} />
            <SubmitButton className="ui-button ui-button-danger">
              この予定を削除
            </SubmitButton>
          </form>
        </section>

        {event.attendance_required && (
          <section className="ui-card mt-8">
            <h2 className="ui-section-title">出欠一覧</h2>
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
