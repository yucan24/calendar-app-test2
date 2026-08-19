"use server";

import { requireLogin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const VALID_CATEGORIES = ["bug", "usability", "request", "other"];
const VALID_URGENCIES = ["normal", "urgent"];
const MAX_MESSAGE_LENGTH = 2000;
const MAX_PAGE_PATH_LENGTH = 300;

type FeedbackInsertError = {
  code?: string;
  message?: string;
};

export type FeedbackState = {
  ok: boolean;
  message: string;
  submittedAt: number | null;
};

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function cleanOptionalText(
  value: FormDataEntryValue | null,
  maxLength: number
) {
  const text = cleanText(value);

  if (!text) return null;

  return text.slice(0, maxLength);
}

function feedbackErrorMessage(error: FeedbackInsertError) {
  const code = error.code ?? "";
  const message = error.message ?? "";

  if (
    code === "42P01" ||
    (message.includes("developer_feedback") &&
      message.includes("does not exist"))
  ) {
    return "ご意見送信機能のDB準備が未完了です。管理者に連絡してください。";
  }

  if (code === "42501" || message.includes("permission denied")) {
    return "ご意見送信機能の権限設定が未完了です。管理者に連絡してください。";
  }

  if (code === "23514") {
    return "入力内容を確認してください。";
  }

  return "送信に失敗しました。時間をおいてもう一度お試しください。";
}

export async function submitDeveloperFeedback(
  _prevState: FeedbackState,
  formData: FormData
): Promise<FeedbackState> {
  const profile = await requireLogin();

  const category = cleanText(formData.get("category"));
  const urgency = cleanText(formData.get("urgency"));
  const pagePath = cleanOptionalText(
    formData.get("page_path"),
    MAX_PAGE_PATH_LENGTH
  );
  const message = cleanText(formData.get("message"));

  if (!VALID_CATEGORIES.includes(category)) {
    return {
      ok: false,
      message: "種類を選択してください。",
      submittedAt: null,
    };
  }

  if (!VALID_URGENCIES.includes(urgency)) {
    return {
      ok: false,
      message: "優先度を選択してください。",
      submittedAt: null,
    };
  }

  if (!message) {
    return {
      ok: false,
      message: "内容を入力してください。",
      submittedAt: null,
    };
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      message: `${MAX_MESSAGE_LENGTH}文字以内で入力してください。`,
      submittedAt: null,
    };
  }

  const { error } = await supabase.from("developer_feedback").insert({
    group_id: profile.group_id,
    profile_id: profile.id,
    profile_name: profile.name,
    profile_role: profile.role,
    category,
    urgency,
    page_path: pagePath,
    message,
  });

  if (error) {
    console.error("developer_feedback insert failed", {
      code: error.code,
      message: error.message,
    });

    return {
      ok: false,
      message: feedbackErrorMessage(error),
      submittedAt: null,
    };
  }

  return {
    ok: true,
    message: "送信しました。",
    submittedAt: Date.now(),
  };
}
