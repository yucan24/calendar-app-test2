"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const VALID_INCOME_CATEGORIES = ["sponsorship", "other"];

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
