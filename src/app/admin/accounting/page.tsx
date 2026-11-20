import MonthNavigation from "@/components/ui/MonthNavigation";
import PageHeader from "@/components/ui/PageHeader";
import LogoutButton from "@/components/LogoutButton";
import { fetchAllRows } from "@/lib/pagination";
import type { ReactNode } from "react";

import {
  buildAccountingReport,
  buildCumulativeAccountingBalance,
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
import BankAccountingPanel, {
  type BankAccountingMode,
} from "../bank-reconciliation/BankAccountingPanel";
import PaymentAliasPanel from "../bank-reconciliation/PaymentAliasPanel";
import type {
  BankProfile,
  PaymentAlias,
} from "../bank-reconciliation/types";
import AccountingManagementPanel from "./AccountingManagementPanel";
import AccountingReportClient from "./AccountingReportClient";
import AccountingWorkspaceNav, {
  type AccountingWorkspaceTab,
} from "./AccountingWorkspaceNav";

type PageProps = {
  searchParams?: Promise<{
    month?: string;
    tab?: string;
  }>;
};

type RawAlias = {
  id: string;
  profile_id: string;
  profile_name: string;
  alias_name: string;
  normalized_alias_name: string;
  note: string | null;
};

type RawBankLink = {
  item_type: "income" | "expense";
  item_id: string;
  bank_transaction_id: string;
};

const accountingTabs = new Set<AccountingWorkspaceTab>([
  "summary",
  "reconciliation",
  "history",
  "import",
  "settings",
]);

function AccountingPageFrame({
  activeTab,
  targetMonth,
  children,
}: {
  activeTab: AccountingWorkspaceTab;
  targetMonth: string;
  children: ReactNode;
}) {
  return (
    <main className="ui-page">
      <div className="mx-auto max-w-7xl">
        <PageHeader title="会計管理" backHref="/admin" actions={<LogoutButton />} />

        <AccountingWorkspaceNav activeTab={activeTab} targetMonth={targetMonth} />
        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}

function getMonthStartDate(targetMonth: string) {
  return `${targetMonth}-01`;
}

export default async function AdminAccountingPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const currentMonth = getCurrentTargetMonth();
  const requestedTab = resolvedSearchParams?.tab as
    | AccountingWorkspaceTab
    | undefined;
  const activeTab =
    requestedTab && accountingTabs.has(requestedTab)
      ? requestedTab
      : "summary";
  const defaultTargetMonth =
    activeTab === "reconciliation"
      ? getPrevTargetMonth(currentMonth)
      : currentMonth;

  const targetMonth =
    resolvedSearchParams?.month && isValidTargetMonth(resolvedSearchParams.month)
      ? resolvedSearchParams.month
      : defaultTargetMonth;

  if (
    activeTab === "reconciliation" ||
    activeTab === "history" ||
    activeTab === "import"
  ) {
    return (
      <AccountingPageFrame activeTab={activeTab} targetMonth={targetMonth}>
        <BankAccountingPanel
          admin={admin}
          mode={activeTab as BankAccountingMode}
          targetMonth={targetMonth}
        />
      </AccountingPageFrame>
    );
  }

  const prevMonth = getPrevTargetMonth(targetMonth);
  const nextMonth = getNextTargetMonth(targetMonth);
  const monthStart = getMonthStartDate(targetMonth);
  const monthEnd = getMonthStartDate(nextMonth);

  const { data: coaches, error: coachesError } = await fetchAllRows((from, to) => supabase
    .from("profiles")
    .select("id, name, coach_hourly_rate")
    .eq("group_id", admin.group_id)
    .eq("accounting_coach", true)
    .order("name", { ascending: true }).order("id", { ascending: true }).range(from, to));

  if (coachesError) {
    throw new Error(coachesError.message);
  }

  const { data: logs, error: logsError } = await fetchAllRows((from, to) => supabase
    .from("coach_work_logs")
    .select(
      "coach_id, work_date, coaching_minutes, admin_minutes, travel_expense, other_expense"
    )
    .eq("group_id", admin.group_id)
    .gte("work_date", monthStart)
    .lt("work_date", monthEnd).order("id", { ascending: true }).range(from, to));

  if (logsError) {
    throw new Error(logsError.message);
  }

  const { data: billingItems, error: billingError } = await fetchAllRows((from, to) => supabase
    .from("billing_items")
    .select("id, user_id, target_month, category, title, amount, status, note, coach_payment_transaction_id, coach_payment_offset_month")
    .eq("group_id", admin.group_id)
    .eq("target_month", targetMonth)
    .gt("amount", 0).order("id", { ascending: true }).range(from, to));

  if (billingError) {
    throw new Error(billingError.message);
  }

  const { data: incomeItems, error: incomeError } = await fetchAllRows((from, to) => supabase.rpc(
    "list_accounting_income_items",
    {
      p_admin_profile_id: admin.id,
      p_target_month: targetMonth,
    }
  ).order("received_on", { ascending: false }).order("id", { ascending: true }).range(from, to));

  if (incomeError) {
    throw new Error(incomeError.message);
  }

  const { data: expenseItems, error: expenseError } = await fetchAllRows((from, to) => supabase.rpc(
    "list_accounting_expense_items",
    {
      p_admin_profile_id: admin.id,
      p_target_month: targetMonth,
    }
  ).order("spent_on", { ascending: false }).order("id", { ascending: true }).range(from, to));

  if (expenseError) {
    throw new Error(expenseError.message);
  }

  const { data: rewardAdjustments, error: rewardAdjustmentError } =
    await fetchAllRows((from, to) => supabase.rpc("list_coach_reward_adjustments", {
      p_admin_profile_id: admin.id,
      p_target_month: targetMonth,
    }).order("starts_on", { ascending: false }).order("id", { ascending: true }).range(from, to));

  if (rewardAdjustmentError) {
    throw new Error(rewardAdjustmentError.message);
  }

  const { data: cumulativeLogs, error: cumulativeLogsError } = await fetchAllRows((from, to) => supabase
    .from("coach_work_logs")
    .select(
      "coach_id, work_date, coaching_minutes, admin_minutes, travel_expense, other_expense"
    )
    .eq("group_id", admin.group_id)
    .lt("work_date", monthEnd).order("id", { ascending: true }).range(from, to));

  if (cumulativeLogsError) {
    throw new Error(cumulativeLogsError.message);
  }

  const { data: cumulativeBillingItems, error: cumulativeBillingError } =
    await fetchAllRows((from, to) => supabase
      .from("billing_items")
      .select("id, user_id, target_month, category, title, amount, status, note, coach_payment_transaction_id, coach_payment_offset_month")
      .eq("group_id", admin.group_id)
      .lte("target_month", targetMonth)
      .gt("amount", 0).order("id", { ascending: true }).range(from, to));

  if (cumulativeBillingError) {
    throw new Error(cumulativeBillingError.message);
  }

  const { data: cumulativeIncomeItems, error: cumulativeIncomeError } =
    await fetchAllRows((from, to) => supabase.rpc("list_accounting_income_items_until", {
      p_admin_profile_id: admin.id,
      p_target_month: targetMonth,
    }).order("received_on", { ascending: false }).order("id", { ascending: true }).range(from, to));

  if (cumulativeIncomeError) {
    throw new Error(cumulativeIncomeError.message);
  }

  const { data: cumulativeExpenseItems, error: cumulativeExpenseError } =
    await fetchAllRows((from, to) => supabase.rpc("list_accounting_expense_items_until", {
      p_admin_profile_id: admin.id,
      p_target_month: targetMonth,
    }).order("spent_on", { ascending: false }).order("id", { ascending: true }).range(from, to));

  if (cumulativeExpenseError) {
    throw new Error(cumulativeExpenseError.message);
  }

  const {
    data: cumulativeRewardAdjustments,
    error: cumulativeRewardAdjustmentError,
  } = await fetchAllRows((from, to) => supabase.rpc("list_coach_reward_adjustments_until", {
    p_admin_profile_id: admin.id,
    p_target_month: targetMonth,
  }).order("starts_on", { ascending: false }).order("id", { ascending: true }).range(from, to));

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
  const cumulativeBalance = buildCumulativeAccountingBalance({
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

  let aliasesPanel: ReactNode = null;
  const incomeBankTransactionByItemId: Record<string, string> = {};
  const expenseBankTransactionByItemId: Record<string, string> = {};

  if (activeTab === "settings") {
    const [profilesResult, aliasesResult, bankLinksResult] = await Promise.all([
      fetchAllRows((from, to) => supabase
        .from("profiles")
        .select("id, name")
        .eq("group_id", admin.group_id)
        .eq("role", "user")
        .eq("login_enabled", true)
        .order("name", { ascending: true }).order("id", { ascending: true }).range(from, to)),
      fetchAllRows((from, to) => supabase.rpc("list_profile_payment_aliases", {
        p_admin_profile_id: admin.id,
      }).order("id", { ascending: true }).range(from, to)),
      fetchAllRows((from, to) => supabase.rpc("list_accounting_bank_links", {
        p_admin_profile_id: admin.id,
      }).order("item_type").order("item_id").range(from, to)),
    ]);

    const error =
      profilesResult.error ?? aliasesResult.error ?? bankLinksResult.error;

    if (error) {
      throw new Error(error.message);
    }

    const users = (profilesResult.data ?? []) as BankProfile[];
    const aliases = ((aliasesResult.data ?? []) as RawAlias[]).map(
      (row): PaymentAlias => ({
        id: row.id,
        profileId: row.profile_id,
        profileName: row.profile_name,
        aliasName: row.alias_name,
        normalizedAliasName: row.normalized_alias_name,
        note: row.note,
      })
    );

    for (const link of (bankLinksResult.data ?? []) as RawBankLink[]) {
      if (link.item_type === "income") {
        incomeBankTransactionByItemId[link.item_id] = link.bank_transaction_id;
      } else {
        expenseBankTransactionByItemId[link.item_id] = link.bank_transaction_id;
      }
    }

    aliasesPanel = <PaymentAliasPanel users={users} aliases={aliases} />;
  }

  return (
    <AccountingPageFrame activeTab={activeTab} targetMonth={targetMonth}>
      <div className="space-y-6">
        <section className="ui-card mt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="ui-section-title text-gray-900">
              {formatTargetMonth(targetMonth)}
            </h2>

            <MonthNavigation baseHref={`/admin/accounting?tab=${activeTab}`} previousMonth={prevMonth} currentMonth={currentMonth} nextMonth={nextMonth} />
          </div>
        </section>

        {activeTab === "summary" ? (
          <AccountingReportClient
            targetMonth={targetMonth}
            rows={visibleReportRows}
            totals={report.totals}
            incomeItems={incomeList}
            expenseItems={expenseList}
            cumulativeBalance={cumulativeBalance}
          />
        ) : (
          <AccountingManagementPanel
            coachList={coachList}
            rewardAdjustmentList={rewardAdjustmentList}
            incomeList={incomeList}
            expenseList={expenseList}
            monthStart={monthStart}
            totals={report.totals}
            aliasesPanel={aliasesPanel}
            incomeBankTransactionByItemId={incomeBankTransactionByItemId}
            expenseBankTransactionByItemId={expenseBankTransactionByItemId}
          />
        )}
      </div>
    </AccountingPageFrame>
  );
}
