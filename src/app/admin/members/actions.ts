"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

function cleanName(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .trim();
}

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

async function getMemberOrThrow(memberId: string, groupId: string) {
  const { data: member, error } = await supabase
    .from("profiles")
    .select("id, group_id, role, login_enabled")
    .eq("id", memberId)
    .single();

  if (error || !member) {
    throw new Error("会員が見つかりません");
  }

  if (member.group_id !== groupId) {
    throw new Error("この会員を操作する権限がありません");
  }

  return member;
}

export async function updateMemberProfile(formData: FormData) {
  const admin = await requireAdmin();

  const memberId = cleanText(formData.get("member_id"));
  const name = cleanName(formData.get("name"));
  const email = cleanText(formData.get("email"));
  const loginCode = cleanText(formData.get("login_code"));
  
　const { data: duplicateProfile, error: duplicateProfileError } = await supabase
  .from("profiles")
  .select("id")
  .eq("group_id", admin.group_id)
  .eq("name", name)
  .neq("id", memberId)
  .maybeSingle();

if (duplicateProfileError) {
  throw new Error(duplicateProfileError.message);
}

if (duplicateProfile) {
  throw new Error("同じ名前の会員が既に登録されています。");
}
  if (!memberId) {
    throw new Error("会員IDが不明です");
  }

  if (!name || !email || !loginCode) {
    throw new Error("名前、メールアドレス、4桁コードを入力してください");
  }

  if (!/^\d{4}$/.test(loginCode)) {
    throw new Error("4桁コードは数字4桁で入力してください");
  }

  await getMemberOrThrow(memberId, admin.group_id);

  const { error } = await supabase
    .from("profiles")
    .update({
      name,
      email,
      login_code: loginCode,
    })
    .eq("id", memberId)
    .eq("group_id", admin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/members");
}

export async function updateMemberLoginEnabled(formData: FormData) {
  const admin = await requireAdmin();

  const memberId = cleanText(formData.get("member_id"));
  const loginEnabled = cleanText(formData.get("login_enabled")) === "true";

  if (!memberId) {
    throw new Error("会員IDが不明です");
  }

  await getMemberOrThrow(memberId, admin.group_id);

  if (memberId === admin.id && !loginEnabled) {
    throw new Error("自分自身のログイン許可は削除できません");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      login_enabled: loginEnabled,
    })
    .eq("id", memberId)
    .eq("group_id", admin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/members");
}

export async function updateMemberRole(formData: FormData) {
  const admin = await requireAdmin();

  const memberId = cleanText(formData.get("member_id"));
  const role = cleanText(formData.get("role"));

  if (!memberId) {
    throw new Error("会員IDが不明です");
  }

  if (role !== "admin" && role !== "user") {
    throw new Error("権限が不正です");
  }

  await getMemberOrThrow(memberId, admin.group_id);

  if (memberId === admin.id && role !== "admin") {
    throw new Error("自分自身の管理者権限は削除できません");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      role,
    })
    .eq("id", memberId)
    .eq("group_id", admin.group_id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/members");
  revalidatePath("/admin/users");
}
