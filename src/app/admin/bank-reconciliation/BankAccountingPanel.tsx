import {
  buildAccountingReport,
  type AccountingBillingItem,
  type AccountingCoach,
  type AccountingCoachWorkLog,
  type AccountingRewardAdjustment,
} from "@/lib/accounting";
import type { CurrentProfile } from "@/lib/auth";
import {
  getCurrentTargetMonth,
  getNextTargetMonth,
  getPrevTargetMonth,
} from "@/lib/month";
import { supabase } from "@/lib/supabase";
import BankImportPanel from "./BankImportPanel";
import BankTransactionHistoryClient from "./BankTransactionHistoryClient";
import BankTransactionReviewClient from "./BankTransactionReviewClient";
import PaymentMonthSelector from "./PaymentMonthSelector";
import type {
  BankCsvImport,
  BankProfile,
  BankTransaction,
  BankTransactionMatch,
  ExistingAccountingItem,
  PaymentAlias,
  ReconciliationBillingItem,
} from "./types";

export type BankAccountingMode = "reconciliation" | "history" | "import";

type Props = {
  admin: CurrentProfile;
  mode: BankAccountingMode;
  targetMonth: string;
};

type RawAlias = {
  id: string;
  profile_id: string;
  profile_name: string;
  alias_name: string;
  normalized_alias_name: string;
  note: string | null;
};

type RawTransaction = {
  id: string;
  bank_transaction_id: string;
  transacted_on: string;
  withdrawal_amount: number;
  deposit_amount: number;
  description: string;
  normalized_description: string;
  balance: number | null;
  status: "unmatched" | "matched" | "ignored";
  memo: string | null;
  matches: BankTransactionMatch[] | null;
};

type RawImport = {
  id: string;
  source_filename: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number: string;
  period_start: string | null;
  period_end: string | null;
  imported_count: number;
  skipped_count: number;
  created_at: string;
};

type RawBillingItem = {
  id: string;
  user_id: string;
  target_month: string;
  category: string;
  title: string;
  amount: number;
  status: string;
  note: string | null;
};

type RawExistingAccountingItem = {
  item_type: "income" | "expense";
  item_id: string;
  item_date: string;
  party_name: string;
  category: string;
  title: string;
  amount: number;
  note: string | null;
};

type RawProfile = BankProfile & {
  role: "admin" | "user";
  login_enabled: boolean;
};

function mapTransaction(row: RawTransaction): BankTransaction {
  return {
    id: row.id,
    bankTransactionId: row.bank_transaction_id,
    transactedOn: row.transacted_on,
    withdrawalAmount: row.withdrawal_amount,
    depositAmount: row.deposit_amount,
    description: row.description,
    normalizedDescription: row.normalized_description,
    balance: row.balance,
    status: row.status,
    memo: row.memo,
    matches: Array.isArray(row.matches) ? row.matches : [],
  };
}

function throwFirstError(
  errors: Array<{ message: string } | null>,
  fallback: string
) {
  const error = errors.find(Boolean);

  if (error) {
    throw new Error(error.message || fallback);
  }
}

export default async function BankAccountingPanel({
  admin,
  mode,
  targetMonth,
}: Props) {
  if (mode === "history") {
    const [matchedResult, ignoredResult] = await Promise.all([
      supabase.rpc("list_bank_transactions", {
        p_admin_profile_id: admin.id,
        p_status: "matched",
        p_from_date: null,
        p_to_date: null,
      }),
      supabase.rpc("list_bank_transactions", {
        p_admin_profile_id: admin.id,
        p_status: "ignored",
        p_from_date: null,
        p_to_date: null,
      }),
    ]);

    throwFirstError(
      [matchedResult.error, ignoredResult.error],
      "処理履歴の取得に失敗しました"
    );

    return (
      <BankTransactionHistoryClient
        matchedTransactions={(
          (matchedResult.data ?? []) as RawTransaction[]
        ).map(mapTransaction)}
        ignoredTransactions={(
          (ignoredResult.data ?? []) as RawTransaction[]
        ).map(mapTransaction)}
      />
    );
  }

  if (mode === "import") {
    const importsResult = await supabase.rpc("list_bank_csv_imports", {
      p_admin_profile_id: admin.id,
      p_limit: 10,
    });

    throwFirstError(
      [importsResult.error],
      "CSV取込履歴の取得に失敗しました"
    );

    const importHistory = ((importsResult.data ?? []) as RawImport[]).map(
      (row): BankCsvImport => ({
        id: row.id,
        sourceFilename: row.source_filename,
        bankName: row.bank_name,
        branchName: row.branch_name,
        accountType: row.account_type,
        accountNumber: row.account_number,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        importedCount: row.imported_count,
        skippedCount: row.skipped_count,
        createdAt: row.created_at,
      })
    );

    return <BankImportPanel importHistory={importHistory} />;
  }

  const currentMonth = getCurrentTargetMonth();
  const previousMonth = getPrevTargetMonth(targetMonth);
  const nextMonth = getNextTargetMonth(targetMonth);
  const monthStart = `${targetMonth}-01`;
  const monthEnd = `${nextMonth}-01`;
  const [
    profilesResult,
    aliasesResult,
    unmatchedResult,
    billingResult,
    coachesResult,
    logsResult,
    adjustmentsResult,
    existingAccountingItemsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, name, role, login_enabled")
      .eq("group_id", admin.group_id)
      .order("name", { ascending: true }),
    supabase.rpc("list_profile_payment_aliases", {
      p_admin_profile_id: admin.id,
    }),
    supabase.rpc("list_bank_transactions", {
      p_admin_profile_id: admin.id,
      p_status: "unmatched",
      p_from_date: null,
      p_to_date: null,
    }),
    supabase
      .from("billing_items")
      .select("id, user_id, target_month, category, title, amount, status, note")
      .eq("group_id", admin.group_id)
      .eq("status", "unpaid")
      .gt("amount", 0)
      .order("target_month", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, name, coach_hourly_rate")
      .eq("group_id", admin.group_id)
      .eq("role", "admin")
      .eq("login_enabled", true)
      .order("name", { ascending: true }),
    supabase
      .from("coach_work_logs")
      .select(
        "coach_id, work_date, coaching_minutes, admin_minutes, travel_expense, other_expense"
      )
      .eq("group_id", admin.group_id)
      .gte("work_date", monthStart)
      .lt("work_date", monthEnd),
    supabase.rpc("list_coach_reward_adjustments", {
      p_admin_profile_id: admin.id,
      p_target_month: targetMonth,
    }),
    supabase.rpc("list_unlinked_accounting_items", {
      p_admin_profile_id: admin.id,
    }),
  ]);

  throwFirstError(
    [
      profilesResult.error,
      aliasesResult.error,
      unmatchedResult.error,
      billingResult.error,
      coachesResult.error,
      logsResult.error,
      adjustmentsResult.error,
      existingAccountingItemsResult.error,
    ],
    "銀行明細照合データの取得に失敗しました"
  );

  const profiles = (profilesResult.data ?? []) as RawProfile[];
  const profileNameById = new Map(
    profiles.map((profile) => [profile.id, profile.name])
  );
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
  const rawBillingItems = (billingResult.data ?? []) as RawBillingItem[];
  const missingProfileItem = rawBillingItems.find(
    (item) => !profileNameById.has(item.user_id)
  );

  if (missingProfileItem) {
    throw new Error("請求項目のユーザー情報が見つかりません");
  }

  const billingItems: ReconciliationBillingItem[] = rawBillingItems.map(
    (item) => ({
      id: item.id,
      userId: item.user_id,
      userName: profileNameById.get(item.user_id)!,
      targetMonth: item.target_month,
      category: item.category,
      title: item.title,
      amount: item.amount,
      status: item.status,
    })
  );
  const billingProfileIds = new Set(
    billingItems.map((item) => item.userId)
  );
  const billingProfiles: BankProfile[] = profiles
    .filter((profile) => billingProfileIds.has(profile.id))
    .map(({ id, name }) => ({ id, name }));
  const report = buildAccountingReport({
    coaches: (coachesResult.data ?? []) as AccountingCoach[],
    logs: (logsResult.data ?? []) as AccountingCoachWorkLog[],
    billingItems: rawBillingItems.filter(
      (item) => item.target_month === targetMonth
    ) as AccountingBillingItem[],
    rewardAdjustments:
      (adjustmentsResult.data ?? []) as AccountingRewardAdjustment[],
  });
  const existingAccountingItems = (
    (existingAccountingItemsResult.data ?? []) as RawExistingAccountingItem[]
  ).map(
    (item): ExistingAccountingItem => ({
      itemType: item.item_type,
      itemId: item.item_id,
      transactedOn: item.item_date,
      partyName: item.party_name,
      category: item.category,
      title: item.title,
      amount: item.amount,
      note: item.note,
    })
  );

  return (
    <div className="space-y-5">
      <PaymentMonthSelector
        targetMonth={targetMonth}
        previousMonth={previousMonth}
        currentMonth={currentMonth}
        nextMonth={nextMonth}
      />
      <BankTransactionReviewClient
        transactions={((unmatchedResult.data ?? []) as RawTransaction[]).map(
          mapTransaction
        )}
        users={billingProfiles}
        aliases={aliases}
        billingItems={billingItems}
        existingAccountingItems={existingAccountingItems}
        coachPayments={report.rows
          .filter((row) => row.netPay > 0)
          .map((row) => ({
            coachId: row.coachId,
            coachName: row.coachName,
            amount: row.netPay,
          }))}
        taxPaymentAmount={report.totals.withholdingTaxTotal}
        targetMonth={targetMonth}
      />
    </div>
  );
}
