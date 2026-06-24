import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  createCoachWorkLogs,
  updateCoachWorkLog,
  updateCoachWorkLogStatus,
} from "./actions";
import {
  formatTargetMonth,
  formatYen,
  getCurrentTargetMonth,
  getNextTargetMonth,
  getPrevTargetMonth,
  isValidTargetMonth,
} from "@/lib/month";

type PageProps = {
  searchParams?: Promise<{
    month?: string;
  }>;
};

type Coach = {
  id: string;
  name: string;
  email: string;
};

type CoachWorkLog = {
  id: string;
  batch_id: string;
  coach_id: string;
  entered_by: string | null;
  work_date: string;
  coaching_minutes: number;
  admin_minutes: number;
  travel_expense: number;
  other_expense: number;
  note: string | null;
  status: "submitted" | "approved";
  created_at: string;
  updated_at: string;
};

type Summary = {
  coachingMinutes: number;
  adminMinutes: number;
  travelExpense: number;
  otherExpense: number;
  totalExpense: number;
  count: number;
};

const fieldClass =
  "mt-1 block w-full min-w-0 max-w-full box-border rounded border border-gray-400 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500";

function getMonthStartDate(targetMonth: string) {
  return `${targetMonth}-01`;
}

function getTodayDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

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

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  if (hours === 0 && minutes === 0) return "0時間";
  if (minutes === 0) return `${hours}時間`;
  if (hours === 0) return `${minutes}分`;

  return `${hours}時間${minutes}分`;
}

function getHourPart(value: number) {
  return Math.floor(value / 60);
}

function getMinutePart(value: number) {
  return value % 60;
}

function statusLabel(status: string) {
  if (status === "approved") return "承認済み";
  return "未承認";
}

function statusClass(status: string) {
  if (status === "approved") return "bg-green-100 text-green-800";
  return "bg-yellow-100 text-yellow-800";
}

export default async function AdminCoachWorkPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const currentMonth = getCurrentTargetMonth();

  const targetMonth =
    resolvedSearchParams?.month && isValidTargetMonth(resolvedSearchParams.month)
      ? resolvedSearchParams.month
      : currentMonth;

  const prevMonth = getPrevTargetMonth(targetMonth);
  const nextMonth = getNextTargetMonth(targetMonth);

  const monthStart = getMonthStartDate(targetMonth);
  const monthEnd = getMonthStartDate(nextMonth);

  const { data: coaches, error: coachesError } = await supabase
    .from("profiles")
    .select("id, name, email")
    .eq("group_id", admin.group_id)
    .eq("role", "admin")
    .order("name", { ascending: true });

  if (coachesError) {
    throw new Error(coachesError.message);
  }

  const coachList = (coaches ?? []) as Coach[];
  const coachNameById = new Map<string, string>();

  for (const coach of coachList) {
    coachNameById.set(coach.id, coach.name);
  }

  const { data: logs, error: logsError } = await supabase
    .from("coach_work_logs")
    .select(
      "id, batch_id, coach_id, entered_by, work_date, coaching_minutes, admin_minutes, travel_expense, other_expense, note, status, created_at, updated_at"
    )
    .eq("group_id", admin.group_id)
    .gte("work_date", monthStart)
    .lt("work_date", monthEnd)
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (logsError) {
    throw new Error(logsError.message);
  }

  const logList = (logs ?? []) as CoachWorkLog[];

  const summaryByCoach = new Map<string, Summary>();

  for (const coach of coachList) {
    summaryByCoach.set(coach.id, {
      coachingMinutes: 0,
      adminMinutes: 0,
      travelExpense: 0,
      otherExpense: 0,
      totalExpense: 0,
      count: 0,
    });
  }

  for (const log of logList) {
    const summary = summaryByCoach.get(log.coach_id);

    if (!summary) continue;

    summary.coachingMinutes += log.coaching_minutes;
    summary.adminMinutes += log.admin_minutes;
    summary.travelExpense += log.travel_expense;
    summary.otherExpense += log.other_expense;
    summary.totalExpense += log.travel_expense + log.other_expense;
    summary.count += 1;
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              指導者勤怠・立替管理
            </h1>
            <p className="mt-3 text-base font-medium text-gray-700">
              指導時間、事務作業時間、交通費、その他立替費用を記録します。
            </p>
          </div>

          <div className="flex gap-2">
            <a
              href="/admin"
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
            >
              管理者画面に戻る
            </a>
            <a
              href="/logout"
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
            >
              ログアウト
            </a>
          </div>
        </div>

        <section className="mt-6 rounded-lg bg-white p-5 shadow">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                対象月：{formatTargetMonth(targetMonth)}
              </h2>
              <p className="mt-1 text-sm font-medium text-gray-700">
                指導者別に、時間と立替費用を集計します。
              </p>
            </div>

            <div className="flex gap-2">
              <a
                href={`/admin/coach-work?month=${prevMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                前月
              </a>
              <a
                href={`/admin/coach-work?month=${currentMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                今月
              </a>
              <a
                href={`/admin/coach-work?month=${nextMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                翌月
              </a>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-lg bg-white p-5 shadow">
          <h2 className="text-xl font-bold text-gray-900">月間集計</h2>

          {coachList.length === 0 ? (
            <p className="mt-4 rounded bg-gray-50 p-4 font-medium text-gray-700">
              管理者が登録されていません。
            </p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {coachList.map((coach) => {
                const summary = summaryByCoach.get(coach.id)!;
                const totalMinutes =
                  summary.coachingMinutes + summary.adminMinutes;

                return (
                  <article
                    key={coach.id}
                    className="rounded border border-gray-300 bg-white p-4"
                  >
                    <h3 className="text-lg font-bold text-gray-900">
                      {coach.name}
                    </h3>

                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded bg-blue-50 p-3">
                        <p className="font-bold text-blue-800">指導時間</p>
                        <p className="mt-1 text-lg font-bold text-blue-900">
                          {formatMinutes(summary.coachingMinutes)}
                        </p>
                      </div>

                      <div className="rounded bg-purple-50 p-3">
                        <p className="font-bold text-purple-800">
                          事務作業時間
                        </p>
                        <p className="mt-1 text-lg font-bold text-purple-900">
                          {formatMinutes(summary.adminMinutes)}
                        </p>
                      </div>

                      <div className="rounded bg-gray-50 p-3">
                        <p className="font-bold text-gray-800">合計時間</p>
                        <p className="mt-1 text-lg font-bold text-gray-900">
                          {formatMinutes(totalMinutes)}
                        </p>
                      </div>

                      <div className="rounded bg-red-50 p-3">
                        <p className="font-bold text-red-800">立替合計</p>
                        <p className="mt-1 text-lg font-bold text-red-900">
                          {formatYen(summary.totalExpense)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 rounded bg-gray-50 p-3 text-sm font-medium text-gray-800">
                      <p>交通費：{formatYen(summary.travelExpense)}</p>
                      <p>その他立替：{formatYen(summary.otherExpense)}</p>
                      <p>入力件数：{summary.count}件</p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-6 rounded-lg bg-white p-5 shadow">
          <h2 className="text-xl font-bold text-gray-900">勤怠・立替を入力</h2>
          <p className="mt-2 text-sm font-medium text-gray-700">
            対象指導者を複数選択すると、同じ内容を指導者ごとに登録します。
          </p>

          <form action={createCoachWorkLogs} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  指導日
                </label>
                <input
                  name="work_date"
                  type="date"
                  required
                  defaultValue={getTodayDateKey()}
                  className={fieldClass}
                />
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  対象指導者
                </label>

                <details className="mt-1 rounded border border-gray-400 bg-white p-3">
                  <summary className="cursor-pointer font-bold text-gray-900">
                    指導者を選択
                  </summary>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {coachList.map((coach) => (
                      <label
                        key={coach.id}
                        className="flex items-center gap-2 rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-900"
                      >
                        <input
                          name="coach_ids"
                          type="checkbox"
                          value={coach.id}
                          defaultChecked={coach.id === admin.id}
                        />
                        {coach.name}
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded border border-gray-300 bg-gray-50 p-4">
                <p className="font-bold text-gray-900">指導時間</p>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-bold text-gray-900">
                      時間
                    </label>
                    <input
                      name="coaching_hours"
                      type="number"
                      min={0}
                      defaultValue={0}
                      className={fieldClass}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-900">
                      分
                    </label>
                    <input
                      name="coaching_minutes"
                      type="number"
                      min={0}
                      max={59}
                      defaultValue={0}
                      className={fieldClass}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded border border-gray-300 bg-gray-50 p-4">
                <p className="font-bold text-gray-900">事務作業時間</p>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-bold text-gray-900">
                      時間
                    </label>
                    <input
                      name="admin_hours"
                      type="number"
                      min={0}
                      defaultValue={0}
                      className={fieldClass}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-900">
                      分
                    </label>
                    <input
                      name="admin_minutes"
                      type="number"
                      min={0}
                      max={59}
                      defaultValue={0}
                      className={fieldClass}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  交通費
                </label>
                <input
                  name="travel_expense"
                  type="number"
                  min={0}
                  defaultValue={0}
                  className={fieldClass}
                />
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  その他立替費用
                </label>
                <input
                  name="other_expense"
                  type="number"
                  min={0}
                  defaultValue={0}
                  className={fieldClass}
                />
              </div>
            </div>

            <div className="min-w-0">
              <label className="block text-sm font-bold text-gray-900">
                備考
              </label>
              <textarea
                name="note"
                className={fieldClass}
                placeholder="例：大会資料印刷代、代理入力、交通費内訳など"
              />
            </div>

            <button className="w-full rounded bg-black px-4 py-3 font-bold text-white sm:w-auto">
              登録
            </button>
          </form>
        </section>

        <section className="mt-6 rounded-lg bg-white p-5 shadow">
          <h2 className="text-xl font-bold text-gray-900">入力済み一覧</h2>

          {logList.length === 0 ? (
            <p className="mt-4 rounded bg-gray-50 p-4 font-medium text-gray-700">
              この月の勤怠記録はありません。
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {logList.map((log) => {
                const coachName =
                  coachNameById.get(log.coach_id) ?? "不明な指導者";

                const enteredByName = log.entered_by
                  ? coachNameById.get(log.entered_by) ?? "不明"
                  : "不明";

                return (
                  <article
                    key={log.id}
                    className="rounded border border-gray-300 bg-white p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded px-2 py-1 text-xs font-bold ${statusClass(
                              log.status
                            )}`}
                          >
                            {statusLabel(log.status)}
                          </span>

                          <span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold text-gray-800">
                            {formatDate(log.work_date)}
                          </span>
                        </div>

                        <h3 className="mt-2 text-xl font-bold text-gray-900">
                          {coachName}
                        </h3>

                        <p className="mt-1 text-sm font-medium text-gray-700">
                          入力者：{enteredByName}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm sm:w-80">
                        <div className="rounded bg-blue-50 p-2">
                          <p className="font-bold text-blue-800">指導</p>
                          <p className="font-bold text-blue-900">
                            {formatMinutes(log.coaching_minutes)}
                          </p>
                        </div>

                        <div className="rounded bg-purple-50 p-2">
                          <p className="font-bold text-purple-800">事務</p>
                          <p className="font-bold text-purple-900">
                            {formatMinutes(log.admin_minutes)}
                          </p>
                        </div>

                        <div className="rounded bg-gray-50 p-2">
                          <p className="font-bold text-gray-800">交通費</p>
                          <p className="font-bold text-gray-900">
                            {formatYen(log.travel_expense)}
                          </p>
                        </div>

                        <div className="rounded bg-red-50 p-2">
                          <p className="font-bold text-red-800">その他</p>
                          <p className="font-bold text-red-900">
                            {formatYen(log.other_expense)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {log.note && (
                      <p className="mt-3 rounded bg-gray-50 p-3 text-sm font-medium text-gray-800">
                        備考：{log.note}
                      </p>
                    )}

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <form action={updateCoachWorkLogStatus}>
                        <input type="hidden" name="log_id" value={log.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={
                            log.status === "approved" ? "submitted" : "approved"
                          }
                        />
                        <button
                          className={
                            log.status === "approved"
                              ? "w-full rounded bg-gray-700 px-4 py-3 font-bold text-white"
                              : "w-full rounded bg-green-600 px-4 py-3 font-bold text-white"
                          }
                        >
                          {log.status === "approved"
                            ? "未承認に戻す"
                            : "承認済みにする"}
                        </button>
                      </form>
                    </div>

                    <details className="mt-4 rounded bg-gray-50 p-4">
                      <summary className="cursor-pointer font-bold text-gray-900">
                        この記録を修正
                      </summary>

                      <form
                        action={updateCoachWorkLog}
                        className="mt-4 space-y-4"
                      >
                        <input type="hidden" name="log_id" value={log.id} />

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="min-w-0">
                            <label className="block text-sm font-bold text-gray-900">
                              指導日
                            </label>
                            <input
                              name="work_date"
                              type="date"
                              required
                              defaultValue={log.work_date}
                              className={fieldClass}
                            />
                          </div>

                          <div className="min-w-0">
                            <label className="block text-sm font-bold text-gray-900">
                              対象指導者
                            </label>
                            <select
                              name="coach_id"
                              defaultValue={log.coach_id}
                              className={fieldClass}
                            >
                              {coachList.map((coach) => (
                                <option key={coach.id} value={coach.id}>
                                  {coach.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="rounded border border-gray-300 bg-white p-4">
                            <p className="font-bold text-gray-900">指導時間</p>

                            <div className="mt-3 grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-sm font-bold text-gray-900">
                                  時間
                                </label>
                                <input
                                  name="coaching_hours"
                                  type="number"
                                  min={0}
                                  defaultValue={getHourPart(
                                    log.coaching_minutes
                                  )}
                                  className={fieldClass}
                                />
                              </div>

                              <div>
                                <label className="block text-sm font-bold text-gray-900">
                                  分
                                </label>
                                <input
                                  name="coaching_minutes"
                                  type="number"
                                  min={0}
                                  max={59}
                                  defaultValue={getMinutePart(
                                    log.coaching_minutes
                                  )}
                                  className={fieldClass}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="rounded border border-gray-300 bg-white p-4">
                            <p className="font-bold text-gray-900">
                              事務作業時間
                            </p>

                            <div className="mt-3 grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-sm font-bold text-gray-900">
                                  時間
                                </label>
                                <input
                                  name="admin_hours"
                                  type="number"
                                  min={0}
                                  defaultValue={getHourPart(log.admin_minutes)}
                                  className={fieldClass}
                                />
                              </div>

                              <div>
                                <label className="block text-sm font-bold text-gray-900">
                                  分
                                </label>
                                <input
                                  name="admin_minutes"
                                  type="number"
                                  min={0}
                                  max={59}
                                  defaultValue={getMinutePart(
                                    log.admin_minutes
                                  )}
                                  className={fieldClass}
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="min-w-0">
                            <label className="block text-sm font-bold text-gray-900">
                              交通費
                            </label>
                            <input
                              name="travel_expense"
                              type="number"
                              min={0}
                              defaultValue={log.travel_expense}
                              className={fieldClass}
                            />
                          </div>

                          <div className="min-w-0">
                            <label className="block text-sm font-bold text-gray-900">
                              その他立替費用
                            </label>
                            <input
                              name="other_expense"
                              type="number"
                              min={0}
                              defaultValue={log.other_expense}
                              className={fieldClass}
                            />
                          </div>
                        </div>

                        <div className="min-w-0">
                          <label className="block text-sm font-bold text-gray-900">
                            備考
                          </label>
                          <textarea
                            name="note"
                            defaultValue={log.note ?? ""}
                            className={fieldClass}
                          />
                        </div>

                        <button className="w-full rounded bg-black px-4 py-3 font-bold text-white sm:w-auto">
                          修正
                        </button>
                      </form>
                    </details>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}