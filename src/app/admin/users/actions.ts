"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

const VALID_CATEGORIES = ["tuition", "trip", "event", "uniform", "other"];
const VALID_STATUSES = ["unpaid", "paid", "exempt"];

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function isValidTargetMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function isValidDate(value: string) {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseAmount(value: FormDataEntryValue | null) {
  const amount = Number(value);

  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("金額は0以上の整数で入力してください");
  }

  return amount;
}

async function assertUserInAdminGroup(userId: string, groupId: string) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, group_id")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    throw new Error("ユーザーが見つかりません");
  }

  if (profile.group_id !== groupId) {
    throw new Error("このユーザーを操作する権限がありません");
  }
}

async function assertBillingItemInAdminGroup(itemId: string, groupId: string) {
  const { data: item, error } = await supabase
    .from("billing_items")
    .select("id, group_id")
    .eq("id", itemId)
    .single();

  if (error || !item) {
    throw new Error("請求項目が見つかりません");
  }

  if (item.group_id !== groupId) {
    throw new Error("この請求項目を操作する権限がありません");
  }
}

export async function createBillingItem(formData: FormData) {
  const admin = await requireAdmin();

  const userId = cleanText(formData.get("user_id"));
  const targetMonth = cleanText(formData.get("target_month"));
  const category = cleanText(formData.get("category"));
  const title = cleanText(formData.get("title"));
  const amount = parseAmount(formData.get("amount"));
  const dueDate = cleanText(formData.get("due_date"));
  const note = cleanText(formData.get("note"));

  if (!userId) {
    throw new Error("ユーザーが不明です");
  }

  if (!isValidTargetMonth(targetMonth)) {
    throw new Error("対象月が不正です");
  }

  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error("費目が不正です");
  }

  if (!title) {
    throw new Error("項目名を入力してください");
  }

  if (!isValidDate(dueDate)) {
    throw new Error("期限日が不正です");
  }

  await assertUserInAdminGroup(userId, admin.group_id);

  const { error } = await supabase.from("billing_items").insert({
    group_id: admin.group_id,
    user_id: userId,
    target_month: targetMonth,
    category,
    title,
    amount,
    status: "unpaid",
    due_date: dueDate || null,
    note,
    created_by: admin.id,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/users");
  revalidatePath("/user/payment-check");
}

export async function createTuitionForAllUsers(formData: FormData) {
  const admin = await requireAdmin();

  const targetMonth = cleanText(formData.get("target_month"));
  const title = cleanText(formData.get("title")) || "月謝";
  const amount = parseAmount(formData.get("amount"));
  const dueDate = cleanText(formData.get("due_date"));
  const note = cleanText(formData.get("note"));

  if (!isValidTargetMonth(targetMonth)) {
    throw new Error("対象月が不正です");
  }

  if (!isValidDate(dueDate)) {
    throw new Error("期限日が不正です");
  }

  const { data: users, error: usersError } = await supabase
    .from("profiles")
    .select("id")
    .eq("group_id", admin.group_id)
    .eq("role", "user");

  if (usersError) {
    throw new Error(usersError.message);
  }

  const userIds = (users ?? []).map((user) => user.id);

  if (userIds.length === 0) {
    revalidatePath("/admin/users");
    return;
  }

  const { data: existingItems, error: existingError } = await supabase
    .from("billing_items")
    .select("user_id")
    .eq("group_id", admin.group_id)
    .eq("target_month", targetMonth)
    .eq("category", "tuition");

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingUserIds = new Set(
    (existingItems ?? []).map((item) => item.user_id)
  );

  const rows = userIds
    .filter((userId) => !existingUserIds.has(userId))
    .map((userId) => ({
      group_id: admin.group_id,
      user_id: userId,
      target_month: targetMonth,
      category: "tuition",
      title,
      amount,
      status: "unpaid",
      due_date: dueDate || null,
      note,
      created_by: admin.id,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length > 0) {
    const { error } = await supabase.from("billing_items").insert(rows);

    if (error) {
      throw new Error(error.message);
    }
  }

  revalidatePath("/admin/users");
  revalidatePath("/user/payment-check");
}

export async function updateBillingItemStatus(formData: FormData) {
  const admin = await requireAdmin();

  const itemId = cleanText(formData.get("item_id"));
  const status = cleanText(formData.get("status"));

  if (!itemId) {
    throw new Error("請求項目が不明です");
  }

  if (!VALID_STATUSES.includes(status)) {
    throw new Error("支払い状態が不正です");
  }

  await assertBillingItemInAdminGroup(itemId, admin.group_id);

  const { error } = await supabase
    .from("billing_items")
    .update({
      status,
      paid_at: status === "paid" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("group_id", admin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/users");
  revalidatePath("/user/payment-check");
}