import { fetchAllRows } from "@/lib/pagination";
import {
  buildAccountingReport,
  type AccountingBillingItem,
  type AccountingCoach,
  type AccountingCoachWorkLog,
  type AccountingRewardAdjustment,
} from "@/lib/accounting";
import type { CurrentProfile } from "@/lib/auth";
import { getNextTargetMonth, isValidTargetMonth } from "@/lib/month";
import { supabase } from "@/lib/supabase";

function throwRpcError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function buildMonthlyVirtualPaymentReport(
  admin: CurrentProfile,
  targetMonth: string
) {
  if (!isValidTargetMonth(targetMonth)) {
    throw new Error("対象月が不正です");
  }

  const monthStart = `${targetMonth}-01`;
  const monthEnd = `${getNextTargetMonth(targetMonth)}-01`;
  const [coachesResult, logsResult, billingResult, adjustmentsResult] =
    await Promise.all([
      fetchAllRows((from, to) => supabase
        .from("profiles")
        .select("id, name, coach_hourly_rate")
        .eq("group_id", admin.group_id)
        .eq("accounting_coach", true).order("id", { ascending: true }).range(from, to)),
      fetchAllRows((from, to) => supabase
        .from("coach_work_logs")
        .select(
          "coach_id, work_date, coaching_minutes, admin_minutes, travel_expense, other_expense"
        )
        .eq("group_id", admin.group_id)
        .gte("work_date", monthStart)
        .lt("work_date", monthEnd).order("id", { ascending: true }).range(from, to)),
      fetchAllRows((from, to) => supabase
        .from("billing_items")
        .select("id, user_id, target_month, category, title, amount, status, note, coach_payment_transaction_id, coach_payment_offset_month")
        .eq("group_id", admin.group_id)
        .eq("target_month", targetMonth)
        .gt("amount", 0).order("id", { ascending: true }).range(from, to)),
      fetchAllRows((from, to) => supabase.rpc("list_coach_reward_adjustments", {
        p_admin_profile_id: admin.id,
        p_target_month: targetMonth,
      }).order("starts_on", { ascending: false }).order("id", { ascending: true }).range(from, to)),
    ]);

  throwRpcError(coachesResult.error);
  throwRpcError(logsResult.error);
  throwRpcError(billingResult.error);
  throwRpcError(adjustmentsResult.error);

  return buildAccountingReport({
    coaches: (coachesResult.data ?? []) as AccountingCoach[],
    logs: (logsResult.data ?? []) as AccountingCoachWorkLog[],
    billingItems: (billingResult.data ?? []) as AccountingBillingItem[],
    rewardAdjustments:
      (adjustmentsResult.data ?? []) as AccountingRewardAdjustment[],
  });
}
