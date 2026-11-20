"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { allowAuthAttempt } from "@/lib/authRateLimit";
import { hashSessionToken } from "@/lib/session";
import { validAccountCode, type AccountState } from "@/lib/accountPolicy";
export async function confirmAccountLink(_previous: AccountState, form: FormData): Promise<AccountState> {
  const hash = hashSessionToken(String(form.get("token") ?? ""));
  if (!hash) return { ok: false, message: "リンクが無効です。再発行してください。" };
  if (!await allowAuthAttempt("account", hash)) return { ok: false, message: "試行回数が上限に達しました。時間をおいてお試しください。" };
  const code = String(form.get("new_code") ?? "");
  if (code && (!validAccountCode(code) || code !== form.get("confirmation"))) return { ok: false, message: "新しい4桁コードと確認用入力を一致させてください。" };
  const { data: purpose, error } = await supabase.rpc("consume_app_account_token", { p_token_hash: hash, p_new_code: code || null });
  if (error) return { ok: false, message: "リンクが無効か期限切れ、または入力が不正です。再発行するか管理者へお問い合わせください。" };
  revalidatePath("/account");
  revalidatePath("/admin/members");
  const kind = purpose === "verify_email" ? "email" : purpose === "email_change" ? "email-changed" : ["setup", "manual_setup"].includes(purpose) ? "setup" : "reset";
  redirect(`/account/complete?kind=${kind}`);
}
