"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export type MemberActionState = {
  ok: boolean;
  message: string;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function isDuplicateNameError(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  ) {
    return true;
  }

  return false;
}

async function getMemberOrThrow(memberId: string, groupId: string) {
  if (!memberId) {
    throw new Error("会員IDが不明です。");
  }

  const { data: member, error } = await supabase
    .from("profiles")
    .select("id, group_id, role, login_enabled")
    .eq("id", memberId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!member || member.group_id !== groupId) {
    throw new Error("この会員を操作する権限がありません。");
  }

  return member;
}

export async function updateMemberProfile(
  _prevState: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const admin = await requireAdmin();

  const memberId = cleanText(formData.get("member_id"));
  const name = normalizeName(formData.get("name"));
  const email = cleanText(formData.get("email"));
  const loginCode = cleanText(formData.get("login_code"));

  if (!memberId) {
    return {
      ok: false,
      message: "会員IDが不明です。",
    };
  }

  if (!name) {
    return {
      ok: false,
      message: "名前を入力してください。",
    };
  }

  if (!email) {
    return {
      ok: false,
      message: "メールアドレスを入力してください。",
    };
  }

  if (!/^\d{4}$/.test(loginCode)) {
    return {
      ok: false,
      message: "ログインコードは4桁の数字で入力してください。",
    };
  }

  try {
    await getMemberOrThrow(memberId, admin.group_id);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "会員情報の確認に失敗しました。",
    };
  }

  const { data: duplicateProfile, error: duplicateProfileError } =
    await supabase
      .from("profiles")
      .select("id")
      .eq("group_id", admin.group_id)
      .eq("name", name)
      .neq("id", memberId)
      .limit(1)
      .maybeSingle();

  if (duplicateProfileError) {
    return {
      ok: false,
      message: duplicateProfileError.message,
    };
  }

  if (duplicateProfile) {
    return {
      ok: false,
      message: "この名前は既に登録済みです。",
    };
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      name,
      email,
      login_code: loginCode,
    })
    .eq("id", memberId)
    .eq("group_id", admin.group_id);

  if (updateError) {
    if (isDuplicateNameError(updateError)) {
      return {
        ok: false,
        message: "この名前は既に登録済みです。",
      };
    }

    return {
      ok: false,
      message: updateError.message,
    };
  }

  revalidatePath("/admin/members");

  return {
    ok: true,
    message: "登録情報を更新しました。",
  };
}

export async function updateMemberLoginEnabled(formData: FormData) {
  const admin = await requireAdmin();

  const memberId = cleanText(formData.get("member_id"));
  const loginEnabledValue = cleanText(formData.get("login_enabled"));
  const loginEnabled = loginEnabledValue === "true";

  const member = await getMemberOrThrow(memberId, admin.group_id);

  if (member.id === admin.id && !loginEnabled) {
    throw new Error("自分自身をログイン不可にはできません。");
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

  if (role !== "admin" && role !== "user") {
    throw new Error("権限の値が不正です。");
  }

  const member = await getMemberOrThrow(memberId, admin.group_id);

  if (member.id === admin.id && role !== "admin") {
    throw new Error("自分自身の管理者権限は削除できません。");
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
}
