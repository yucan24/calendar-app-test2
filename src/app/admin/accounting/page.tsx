import PendingNavigationButton from "@/components/PendingNavigationButton";
import SubmitButton from "@/components/SubmitButton";
import {
  buildAccountingReport,
  incomeCategoryLabel,
  type AccountingBillingItem,
  type AccountingCoach,
  type AccountingCoachWorkLog,
  type AccountingIncomeItem,
} from "@/lib/accounting";
import { requireAdmin } from "@/lib/auth";
import {
  formatTargetMonth,
  formatYen,
  getCurrentTargetMonth,
  getNextTargetMonth,
  getPrevTargetMonth,
  isValidTargetMonth,
} from "@/lib/month";
import { supabase } from "@/lib/supabase";
import AccountingReportClient from "./AccountingReportClient";
import IncomeItemDeleteForm from "./IncomeItemDeleteForm";
import {
  createAccountingIncomeItem,
  updateAccountingIncomeItem,
} from "./actions";

type PageProps = {
  searchParams?: Promise<{
    month?: string;
  }>;
};

const fieldClass =
  "mt-1 block w-full min-w-0 max-w-full box-border rounded border border-gray-400 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500";

function getMonthStartDate(targetMonth: string) {
  return `${targetMonth}-01`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

export default async function AdminAccountingPage({ searchParams }: PageProps) {
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
    .select("id, name")
    .eq("group_id", admin.group_id)
    .eq("role", "admin")
    .eq("login_enabled", true)
    .order("name", { ascending: true });

  if (coachesError) {
    throw new Error(coachesError.message);
  }

  const { data: logs, error: logsError } = await supabase
    .from("coach_work_logs")
    .select(
      "coach_id, coaching_minutes, admin_minutes, travel_expense, other_expense"
    )
    .eq("group_id", admin.group_id)
    .gte("work_date", monthStart)
    .lt("work_date", monthEnd);

  if (logsError) {
    throw new Error(logsError.message);
  }

  const { data: billingItems, error: billingError } = await supabase
    .from("billing_items")
    .select("id, user_id, target_month, category, title, amount, status, note")
    .eq("group_id", admin.group_id)
    .eq("target_month", targetMonth)
    .gt("amount", 0);

  if (billingError) {
    throw new Error(billingError.message);
  }

  const { data: incomeItems, error: incomeError } = await supabase.rpc(
    "list_accounting_income_items",
    {
      p_admin_profile_id: admin.id,
      p_target_month: targetMonth,
    }
  );

  if (incomeError) {
    throw new Error(incomeError.message);
  }

  const { data: cumulativeLogs, error: cumulativeLogsError } = await supabase
    .from("coach_work_logs")
    .select(
      "coach_id, coaching_minutes, admin_minutes, travel_expense, other_expense"
    )
    .eq("group_id", admin.group_id)
    .lt("work_date", monthEnd);

  if (cumulativeLogsError) {
    throw new Error(cumulativeLogsError.message);
  }

  const { data: cumulativeBillingItems, error: cumulativeBillingError } =
    await supabase
      .from("billing_items")
      .select("id, user_id, target_month, category, title, amount, status, note")
      .eq("group_id", admin.group_id)
      .lte("target_month", targetMonth)
      .gt("amount", 0);

  if (cumulativeBillingError) {
    throw new Error(cumulativeBillingError.message);
  }

  const { data: cumulativeIncomeItems, error: cumulativeIncomeError } =
    await supabase.rpc("list_accounting_income_items_until", {
      p_admin_profile_id: admin.id,
      p_target_month: targetMonth,
    });

  if (cumulativeIncomeError) {
    throw new Error(cumulativeIncomeError.message);
  }

  const incomeList = (incomeItems ?? []) as AccountingIncomeItem[];
  const report = buildAccountingReport({
    coaches: (coaches ?? []) as AccountingCoach[],
    logs: (logs ?? []) as AccountingCoachWorkLog[],
    billingItems: (billingItems ?? []) as AccountingBillingItem[],
    incomeItems: incomeList,
  });
  const cumulativeReport = buildAccountingReport({
    coaches: (coaches ?? []) as AccountingCoach[],
    logs: (cumulativeLogs ?? []) as AccountingCoachWorkLog[],
    billingItems: (cumulativeBillingItems ?? []) as AccountingBillingItem[],
    incomeItems: (cumulativeIncomeItems ?? []) as AccountingIncomeItem[],
  });

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              会計管理
            </h1>
            <p className="mt-2 text-sm font-medium text-gray-700">
              月謝収入、協賛金、指導者報酬、源泉税を月単位で確認します。
            </p>
          </div>

          <div className="flex gap-2">
            <PendingNavigationButton
              href="/admin"
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
            >
              管理者画面に戻る
            </PendingNavigationButton>
            <PendingNavigationButton
              href="/logout"
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
            >
              ログアウト
            </PendingNavigationButton>
          </div>
        </div>

        <section className="mt-5 rounded-lg bg-white p-4 shadow">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              {formatTargetMonth(targetMonth)}
            </h2>

            <div className="flex gap-2">
              <PendingNavigationButton
                href={`/admin/accounting?month=${prevMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                前月
              </PendingNavigationButton>
              <PendingNavigationButton
                href={`/admin/accounting?month=${currentMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                今月
              </PendingNavigationButton>
              <PendingNavigationButton
                href={`/admin/accounting?month=${nextMonth}`}
                className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
              >
                翌月
              </PendingNavigationButton>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-lg bg-white p-5 shadow">
          <details open>
            <summary className="cursor-pointer text-lg font-bold text-gray-900">
              協賛金・その他収入を追加
            </summary>

            <form
              action={createAccountingIncomeItem}
              className="mt-4 grid min-w-0 gap-3 sm:grid-cols-5"
            >
              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  受取日
                </label>
                <input
                  name="received_on"
                  type="date"
                  defaultValue={monthStart}
                  className={fieldClass}
                />
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  種別
                </label>
                <select
                  name="category"
                  defaultValue="sponsorship"
                  className={fieldClass}
                >
                  <option value="sponsorship">協賛金</option>
                  <option value="other">その他収入</option>
                </select>
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  支払者
                </label>
                <input
                  name="payer_name"
                  required
                  className={fieldClass}
                  placeholder="例：山田太郎 / ○○会社"
                />
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  金額
                </label>
                <input
                  name="amount"
                  type="number"
                  min={0}
                  required
                  className={fieldClass}
                  placeholder="10000"
                />
              </div>

              <div className="flex min-w-0 items-end">
                <SubmitButton
                  pendingText="追加中..."
                  className="w-full rounded bg-black px-4 py-3 font-bold text-white"
                >
                  追加
                </SubmitButton>
              </div>

              <div className="min-w-0 sm:col-span-5">
                <label className="block text-sm font-bold text-gray-900">
                  備考
                </label>
                <input
                  name="note"
                  className={fieldClass}
                  placeholder="例：大会協賛、振込確認済み"
                />
              </div>
            </form>
          </details>
        </section>

        <section className="mt-6 rounded-lg bg-white p-5 shadow">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-bold text-gray-900">
              協賛金・その他収入
            </h2>
            <p className="text-sm font-bold text-gray-700">
              合計 {formatYen(report.totals.incomeItemsTotal)}
            </p>
          </div>

          {incomeList.length === 0 ? (
            <p className="mt-3 rounded bg-gray-50 p-3 text-sm font-medium text-gray-700">
              この月の協賛金・その他収入はありません。
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {incomeList.map((item) => (
                <article
                  key={item.id}
                  className="rounded border border-gray-300 bg-white p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-cyan-50 px-2 py-1 text-xs font-bold text-cyan-800">
                          {incomeCategoryLabel(item.category)}
                        </span>
                        <span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold text-gray-800">
                          {formatDate(item.received_on)}
                        </span>
                      </div>

                      <h3 className="mt-2 text-lg font-bold text-gray-900">
                        {item.payer_name}
                      </h3>
                      <p className="mt-1 font-bold text-gray-900">
                        {formatYen(item.amount)}
                      </p>

                      {item.note && (
                        <p className="mt-2 rounded bg-gray-50 p-2 text-sm font-medium text-gray-800">
                          備考：{item.note}
                        </p>
                      )}
                    </div>

                    <IncomeItemDeleteForm itemId={item.id} />
                  </div>

                  <details className="mt-4 rounded bg-gray-50 p-3">
                    <summary className="cursor-pointer font-bold text-gray-900">
                      内容を修正
                    </summary>

                    <form
                      action={updateAccountingIncomeItem}
                      className="mt-3 grid min-w-0 gap-3 sm:grid-cols-5"
                    >
                      <input type="hidden" name="item_id" value={item.id} />

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          受取日
                        </label>
                        <input
                          name="received_on"
                          type="date"
                          defaultValue={item.received_on}
                          className={fieldClass}
                        />
                      </div>

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          種別
                        </label>
                        <select
                          name="category"
                          defaultValue={item.category}
                          className={fieldClass}
                        >
                          <option value="sponsorship">協賛金</option>
                          <option value="other">その他収入</option>
                        </select>
                      </div>

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          支払者
                        </label>
                        <input
                          name="payer_name"
                          defaultValue={item.payer_name}
                          required
                          className={fieldClass}
                        />
                      </div>

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          金額
                        </label>
                        <input
                          name="amount"
                          type="number"
                          min={0}
                          defaultValue={item.amount}
                          className={fieldClass}
                        />
                      </div>

                      <div className="flex min-w-0 items-end">
                        <SubmitButton
                          pendingText="修正中..."
                          className="w-full rounded bg-black px-4 py-3 font-bold text-white"
                        >
                          修正
                        </SubmitButton>
                      </div>

                      <div className="min-w-0 sm:col-span-5">
                        <label className="block text-sm font-bold text-gray-900">
                          備考
                        </label>
                        <input
                          name="note"
                          defaultValue={item.note ?? ""}
                          className={fieldClass}
                        />
                      </div>
                    </form>
                  </details>
                </article>
              ))}
            </div>
          )}
        </section>

        <AccountingReportClient
          targetMonth={targetMonth}
          rows={report.rows}
          totals={report.totals}
          incomeItems={incomeList}
          cumulativeBalance={cumulativeReport.totals.balance}
        />
      </div>
    </main>
  );
}
