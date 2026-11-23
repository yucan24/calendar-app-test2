"use server";
import { supabase } from "@/lib/supabase";
import { allowAuthAttempt } from "@/lib/authRateLimit";
import { sendAccountLink } from "@/lib/accountLinks";
import { normalizeAccountName, normalizeAccountEmail, validAccountEmail, type AccountState } from "@/lib/accountPolicy";
export async function requestAccountRecovery(_previous: AccountState, form: FormData): Promise<AccountState> {
  const name = normalizeAccountName(form.get("name")), email = normalizeAccountEmail(form.get("email"));
  if (!name || name.length > 100 || !validAccountEmail(email)) return { ok: false, message: "名前と登録メールアドレスを正しく入力してください。" };
  const message = "登録情報が一致し、確認済みのメールアドレスである場合、再設定メールを送信します。届かない場合は管理者へお問い合わせください。";
  try {
    if (!await allowAuthAttempt("recovery", name)) return { ok: false, message: "送信の試行回数が上限に達しました。時間をおいてお試しください。" };
    const { data: member, error } = await supabase.from("profiles").select("id,email,email_verified_at,account_status").eq("name", name).eq("group_id", process.env.APP_GROUP_ID!).maybeSingle();
    if (error) throw error;
    if (member?.account_status === "active" && member.email_verified_at && normalizeAccountEmail(member.email) === email) await sendAccountLink(member.id, "reset", email, null);
    return { ok: true, message };
  } catch { return { ok: true, message }; }
}
