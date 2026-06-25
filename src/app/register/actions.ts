"use server";

import { supabase } from "@/lib/supabase";

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

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
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
