import PendingNavigationButton from "@/components/PendingNavigationButton";
import {
  buildAccountingReport,
  type AccountingBillingItem,
  type AccountingCoach,
  type AccountingCoachWorkLog,
  type AccountingExpenseItem,
  type AccountingIncomeItem,
  type AccountingRewardAdjustment,
} from "@/lib/accounting";
import { requireAdmin } from "@/lib/auth";
import {
  formatTargetMonth,
  getCurrentTargetMonth,
  getNextTargetMonth,
  getPrevTargetMonth,
  isValidTargetMonth,
} from "@/lib/month";
import { supabase } from "@/lib/supabase";
import AccountingManagementPanel from "./AccountingManagementPanel";
import AccountingReportClient from "./AccountingReportClient";

type PageProps = {
  searchParams?: Promise<{
    month?: string;
  }>;
};

function getMonthStartDate(targetMonth: string) {
  return `${targetMonth}-01`;
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
    .select("id, name, coach_hourly_rate")
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
      "coach_id, work_date, coaching_minutes, admin_minutes, travel_expense, other_expense"
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

  const { data: expenseItems, error: expenseError } = await supabase.rpc(
    "list_accounting_expense_items",
    {
      p_admin_profile_id: admin.id,
      p_target_month: targetMonth,
    }
  );

  if (expenseError) {
    throw new Error(expenseError.message);
  }

  const { data: rewardAdjustments, error: rewardAdjustmentError } =
    await supabase.rpc("list_coach_reward_adjustments", {
      p_admin_profile_id: admin.id,
      p_target_month: targetMonth,
    });

  if (rewardAdjustmentError) {
    throw new Error(rewardAdjustmentError.message);
  }

  const { data: cumulativeLogs, error: cumulativeLogsError } = await supabase
    .from("coach_work_logs")
    .select(
      "coach_id, work_date, coaching_minutes, admin_minutes, travel_expense, other_expense"
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

  const { data: cumulativeExpenseItems, error: cumulativeExpenseError } =
    await supabase.rpc("list_accounting_expense_items_until", {
      p_admin_profile_id: admin.id,
      p_target_month: targetMonth,
    });

  if (cumulativeExpenseError) {
    throw new Error(cumulativeExpenseError.message);
  }

  const {
    data: cumulativeRewardAdjustments,
    error: cumulativeRewardAdjustmentError,
  } = await supabase.rpc("list_coach_reward_adjustments_until", {
    p_admin_profile_id: admin.id,
    p_target_month: targetMonth,
  });

  if (cumulativeRewardAdjustmentError) {
    throw new Error(cumulativeRewardAdjustmentError.message);
  }

  const coachList = (coaches ?? []) as AccountingCoach[];
  const incomeList = (incomeItems ?? []) as AccountingIncomeItem[];
  const expenseList = (expenseItems ?? []) as AccountingExpenseItem[];
  const rewardAdjustmentList =
    (rewardAdjustments ?? []) as AccountingRewardAdjustment[];
  const report = buildAccountingReport({
    coaches: coachList,
    logs: (logs ?? []) as AccountingCoachWorkLog[],
    billingItems: (billingItems ?? []) as AccountingBillingItem[],
    incomeItems: incomeList,
    expenseItems: expenseList,
    rewardAdjustments: rewardAdjustmentList,
  });
  const cumulativeReport = buildAccountingReport({
    coaches: coachList,
    logs: (cumulativeLogs ?? []) as AccountingCoachWorkLog[],
    billingItems: (cumulativeBillingItems ?? []) as AccountingBillingItem[],
    incomeItems: (cumulativeIncomeItems ?? []) as AccountingIncomeItem[],
    expenseItems: (cumulativeExpenseItems ?? []) as AccountingExpenseItem[],
    rewardAdjustments:
      (cumulativeRewardAdjustments ?? []) as AccountingRewardAdjustment[],
  });
  const visibleReportRows = report.rows.filter(
    (row) =>
      row.totalWorkMinutes > 0 ||
      row.baseReward > 0 ||
      row.rewardCutTotal > 0 ||
      row.netPay !== 0
  );

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

        <div className="mt-6 space-y-6">
          <AccountingReportClient
            targetMonth={targetMonth}
            rows={visibleReportRows}
            totals={report.totals}
            incomeItems={incomeList}
            expenseItems={expenseList}
            cumulativeBalance={cumulativeReport.totals.balance}
          />

          <AccountingManagementPanel
            coachList={coachList}
            rewardAdjustmentList={rewardAdjustmentList}
            incomeList={incomeList}
            expenseList={expenseList}
            monthStart={monthStart}
            totals={report.totals}
          />
        </div>
      </div>
    </main>
  );
}
