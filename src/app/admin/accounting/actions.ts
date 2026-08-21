"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const VALID_INCOME_CATEGORIES = ["sponsorship", "other"];
const VALID_EXPENSE_CATEGORIES = ["event", "fee", "other"];

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseAmount(value: FormDataEntryValue | null) {
  const amount = Number(value);

  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("金額は0以上の整数で入力してください");
  }

  return amount;
}

function parseHourlyRate(value: FormDataEntryValue | null) {
  const rateText = cleanText(value);

  if (!rateText) {
    throw new Error("時給を入力してください");
  }

  const hourlyRate = Number(rateText);

  if (!Number.isInteger(hourlyRate) || hourlyRate < 0) {
    throw new Error("時給は0以上の整数で入力してください");
  }

  return hourlyRate;
}

function parsePayRatePercent(value: FormDataEntryValue | null) {
  const payRatePercent = Number(value);

  if (
    !Number.isInteger(payRatePercent) ||
    payRatePercent < 0 ||
    payRatePercent > 100
  ) {
    throw new Error("支給率は0〜100の整数で入力してください");
  }

  return payRatePercent;
}

function parseOptionalDate(value: FormDataEntryValue | null) {
  const date = cleanText(value);

  if (!date) return null;

  if (!isValidDate(date)) {
    throw new Error("日付が不正です");
  }

  return date;
}

function parseIncomeForm(formData: FormData) {
  const receivedOn = cleanText(formData.get("received_on"));
  const payerName = cleanText(formData.get("payer_name"));
  const category = cleanText(formData.get("category"));
  const amount = parseAmount(formData.get("amount"));
  const note = cleanText(formData.get("note"));

  if (!isValidDate(receivedOn)) {
    throw new Error("受取日が不正です");
  }

  if (!payerName) {
    throw new Error("支払者名を入力してください");
  }

  if (!VALID_INCOME_CATEGORIES.includes(category)) {
    throw new Error("収入種別が不正です");
  }

  return {
    receivedOn,
    payerName,
    category,
    amount,
    note,
  };
}

function parseExpenseForm(formData: FormData) {
  const spentOn = cleanText(formData.get("spent_on"));
  const payeeName = cleanText(formData.get("payee_name"));
  const category = cleanText(formData.get("category"));
  const amount = parseAmount(formData.get("amount"));
  const note = cleanText(formData.get("note"));

  if (!isValidDate(spentOn)) {
    throw new Error("支払日が不正です");
  }

  if (!payeeName) {
    throw new Error("支払先を入力してください");
  }

  if (!VALID_EXPENSE_CATEGORIES.includes(category)) {
    throw new Error("出費種別が不正です");
  }

  return {
    spentOn,
    payeeName,
    category,
    amount,
    note,
  };
}

function parseRewardAdjustmentForm(formData: FormData) {
  const coachId = cleanText(formData.get("coach_id"));
  const startsOn = cleanText(formData.get("starts_on"));
  const endsOn = parseOptionalDate(formData.get("ends_on"));
  const payRatePercent = parsePayRatePercent(formData.get("pay_rate_percent"));
  const note = cleanText(formData.get("note"));

  if (!coachId) {
    throw new Error("指導者を選択してください");
  }

  if (!isValidDate(startsOn)) {
    throw new Error("開始日が不正です");
  }

  if (endsOn && endsOn < startsOn) {
    throw new Error("終了日は開始日以降にしてください");
  }

  return {
    coachId,
    startsOn,
    endsOn,
    payRatePercent,
    note,
  };
}

export async function updateCoachHourlyRate(formData: FormData) {
  const admin = await requireAdmin();
  const coachId = cleanText(formData.get("coach_id"));
  const hourlyRate = parseHourlyRate(formData.get("coach_hourly_rate"));

  if (!coachId) {
    throw new Error("指導者を選択してください");
  }

  const { data: updatedCoach, error } = await supabase
    .from("profiles")
    .update({
      coach_hourly_rate: hourlyRate,
    })
    .eq("id", coachId)
    .eq("group_id", admin.group_id)
    .eq("role", "admin")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!updatedCoach) {
    throw new Error("指導者が見つかりません");
  }

  revalidatePath("/admin/accounting");
}

export async function createAccountingIncomeItem(formData: FormData) {
  const admin = await requireAdmin();
  const input = parseIncomeForm(formData);

  const { error } = await supabase.rpc("create_accounting_income_item", {
    p_admin_profile_id: admin.id,
    p_received_on: input.receivedOn,
    p_payer_name: input.payerName,
    p_category: input.category,
    p_amount: input.amount,
    p_note: input.note,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/accounting");
}

export async function updateAccountingIncomeItem(formData: FormData) {
  const admin = await requireAdmin();
  const itemId = cleanText(formData.get("item_id"));

  if (!itemId) {
    throw new Error("収入項目IDが不明です");
  }

  const input = parseIncomeForm(formData);

  const { error } = await supabase.rpc("update_accounting_income_item", {
    p_admin_profile_id: admin.id,
    p_item_id: itemId,
    p_received_on: input.receivedOn,
    p_payer_name: input.payerName,
    p_category: input.category,
    p_amount: input.amount,
    p_note: input.note,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/accounting");
}

export async function deleteAccountingIncomeItem(formData: FormData) {
  const admin = await requireAdmin();
  const itemId = cleanText(formData.get("item_id"));

  if (!itemId) {
    throw new Error("収入項目IDが不明です");
  }

  const { error } = await supabase.rpc("delete_accounting_income_item", {
    p_admin_profile_id: admin.id,
    p_item_id: itemId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/accounting");
}

export async function createAccountingExpenseItem(formData: FormData) {
  const admin = await requireAdmin();
  const input = parseExpenseForm(formData);

  const { error } = await supabase.rpc("create_accounting_expense_item", {
    p_admin_profile_id: admin.id,
    p_spent_on: input.spentOn,
    p_payee_name: input.payeeName,
    p_category: input.category,
    p_amount: input.amount,
    p_note: input.note,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/accounting");
}

export async function updateAccountingExpenseItem(formData: FormData) {
  const admin = await requireAdmin();
  const itemId = cleanText(formData.get("item_id"));

  if (!itemId) {
    throw new Error("出費項目IDが不明です");
  }

  const input = parseExpenseForm(formData);

  const { error } = await supabase.rpc("update_accounting_expense_item", {
    p_admin_profile_id: admin.id,
    p_item_id: itemId,
    p_spent_on: input.spentOn,
    p_payee_name: input.payeeName,
    p_category: input.category,
    p_amount: input.amount,
    p_note: input.note,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/accounting");
}

export async function deleteAccountingExpenseItem(formData: FormData) {
  const admin = await requireAdmin();
  const itemId = cleanText(formData.get("item_id"));

  if (!itemId) {
    throw new Error("出費項目IDが不明です");
  }

  const { error } = await supabase.rpc("delete_accounting_expense_item", {
    p_admin_profile_id: admin.id,
    p_item_id: itemId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/accounting");
}

export async function createCoachRewardAdjustment(formData: FormData) {
  const admin = await requireAdmin();
  const input = parseRewardAdjustmentForm(formData);

  const { error } = await supabase.rpc("create_coach_reward_adjustment", {
    p_admin_profile_id: admin.id,
    p_coach_id: input.coachId,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_pay_rate_percent: input.payRatePercent,
    p_note: input.note,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/accounting");
}

export async function updateCoachRewardAdjustment(formData: FormData) {
  const admin = await requireAdmin();
  const adjustmentId = cleanText(formData.get("adjustment_id"));

  if (!adjustmentId) {
    throw new Error("報酬調整IDが不明です");
  }

  const input = parseRewardAdjustmentForm(formData);

  const { error } = await supabase.rpc("update_coach_reward_adjustment", {
    p_admin_profile_id: admin.id,
    p_adjustment_id: adjustmentId,
    p_coach_id: input.coachId,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_pay_rate_percent: input.payRatePercent,
    p_note: input.note,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/accounting");
}

export async function deleteCoachRewardAdjustment(formData: FormData) {
  const admin = await requireAdmin();
  const adjustmentId = cleanText(formData.get("adjustment_id"));

  if (!adjustmentId) {
    throw new Error("報酬調整IDが不明です");
  }

  const { error } = await supabase.rpc("delete_coach_reward_adjustment", {
    p_admin_profile_id: admin.id,
    p_adjustment_id: adjustmentId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/accounting");
}
