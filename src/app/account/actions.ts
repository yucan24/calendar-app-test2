"use server";
import { redirect } from "next/navigation";
import { requireLogin, endSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { allowAuthAttempt } from "@/lib/authRateLimit";
import { sendAccountLink } from "@/lib/accountLinks";
import { normalizeAccountName, normalizeAccountEmail, validAccountEmail, validAccountCode, type AccountState } from "@/lib/accountPolicy";

export async function changeAccount(_previous: AccountState, form: FormData): Promise<AccountState> {
  const member = await requireLogin();
  const currentCode = String(form.get("current_code") ?? "");
  const name = normalizeAccountName(form.get("name"));
  const newCode = String(form.get("new_code") ?? "");
  if (!validAccountCode(currentCode)) return { ok: false, message: "現在の4桁コードを入力してください。" };
  if (!name || name.length > 100) return { ok: false, message: "名前は1〜100文字で入力してください。" };
  if (newCode && (!validAccountCode(newCode) || newCode !== form.get("confirmation"))) return { ok: false, message: "新しい4桁コードと確認用入力を一致させてください。" };
  if (!await allowAuthAttempt("account", member.id)) return { ok: false, message: "変更の試行回数が上限に達しました。時間をおいてお試しください。" };
  const { error } = await supabase.rpc("change_app_account", { p_profile_id: member.id, p_current_code: currentCode, p_name: name, p_new_code: newCode || null });
  if (error) return { ok: false, message: error.code === "23505" ? "この名前は既に使用されています。" : "現在の4桁コードと入力内容を確認してください。" };
  if (newCode || name !== member.name) { await endSession(); redirect("/login?message=account-changed"); }
  return { ok: true, message: "変更内容はありません。" };
}
export async function requestAccountEmail(_previous: AccountState, form: FormData): Promise<AccountState> {
  const member = await requireLogin();
  if (!await allowAuthAttempt("mail", member.id)) return { ok: false, message: "メールの送信回数が上限に達しました。時間をおいてお試しください。" };
  const change = form.get("intent") === "change";
  const email = change ? normalizeAccountEmail(form.get("email")) : normalizeAccountEmail(member.email);
  if (!validAccountEmail(email)) return { ok: false, message: "正しいメールアドレスを入力してください。" };
  if (change) {
    const currentCode = String(form.get("current_code") ?? "");
    if (!validAccountCode(currentCode) || !await allowAuthAttempt("account", member.id)) return { ok: false, message: "現在の4桁コードを確認し、時間をおいてお試しください。" };
    const { error } = await supabase.rpc("change_app_account", { p_profile_id: member.id, p_current_code: currentCode });
    if (error) return { ok: false, message: "現在の4桁コードを確認してください。" };
    if (email === normalizeAccountEmail(member.email)) return { ok: false, message: "現在とは異なるメールアドレスを入力してください。" };
  }
  try { return await sendAccountLink(member.id, change ? "email_change" : "verify_email", email, member.id); }
  catch { return { ok: false, message: "確認メールを発行できませんでした。時間をおいてお試しください。" }; }
}
