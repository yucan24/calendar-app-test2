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

export type MemberActionState = {
  ok: boolean;
  message: string;
};

function normalizeName(value: FormDataEntryValue | null) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function isDuplicateNameError(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    return true;
  }

  return false;
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

  const { data: targetMember, error: targetMemberError } = await supabase
    .from("profiles")
    .select("id, group_id")
    .eq("id", memberId)
    .maybeSingle();

  if (targetMemberError) {
    return {
      ok: false,
      message: targetMemberError.message,
    };
  }

  if (!targetMember || targetMember.group_id !== admin.group_id) {
    return {
      ok: false,
      message: "この会員を編集する権限がありません。",
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
