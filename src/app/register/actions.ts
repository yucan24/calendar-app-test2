"use server";

import { supabase } from "@/lib/supabase";
import { allowAuthAttempt } from "@/lib/authRateLimit";

export type RegisterState = {
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

export async function registerMember(
  _prevState: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const name = normalizeName(formData.get("name"));
  const email = cleanText(formData.get("email"));
  const loginCode = cleanText(formData.get("login_code"));

  if (!name || name.length > 100) {
    return {
      ok: false,
      message: "名前を入力してください。",
    };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return {
      ok: false,
      message: "正しいメールアドレスを入力してください。",
    };
  }

  if (!/^\d{4}$/.test(loginCode)) {
    return {
      ok: false,
      message: "ログインコードは4桁の数字で入力してください。",
    };
  }

  try {
    if (!await allowAuthAttempt("register")) return { ok: false, message: "登録の試行回数が上限に達しました。時間をおいてお試しください。" };
  } catch {
    return { ok: false, message: "ただいま登録できません。時間をおいてお試しください。" };
  }
  const groupId = process.env.APP_GROUP_ID;
  if (!groupId) return { ok: false, message: "登録先の設定を確認できません。管理者へお問い合わせください。" };

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    return {
      ok: false,
      message: groupError.message,
    };
  }

  if (!group) {
    return {
      ok: false,
      message: "登録先グループが見つかりません。",
    };
  }

  const { data: existingProfile, error: existingProfileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("group_id", group.id)
    .eq("name", name)
    .limit(1)
    .maybeSingle();

  if (existingProfileError) {
    return {
      ok: false,
      message: existingProfileError.message,
    };
  }

  if (existingProfile) {
    return {
      ok: false,
      message: "この名前は既に登録済みです。",
    };
  }

  const { error: insertError } = await supabase.from("profiles").insert({
    group_id: group.id,
    role: "user",
    name,
    email,
    login_code: loginCode,
    login_enabled: false,
  });

  if (insertError) {
    if (isDuplicateNameError(insertError)) {
      return {
        ok: false,
        message: "この名前は既に登録済みです。",
      };
    }

    return {
      ok: false,
      message: insertError.message,
    };
  }

  return {
    ok: true,
    message: "登録を受け付けました。管理者の承認後にログインできます。",
  };
}
