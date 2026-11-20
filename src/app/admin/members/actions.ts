"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { allowAuthAttempt } from "@/lib/authRateLimit";
import { sendAccountLink, notifyRegistration, recordAccountMail } from "@/lib/accountLinks";
import { sendAccountEmail, applicationUrl } from "@/lib/accountEmail";
import { normalizeAccountName, normalizeAccountEmail, validAccountEmail, type AccountState } from "@/lib/accountPolicy";
import type { MemberListState } from "./memberView";
export type MemberActionState = AccountState;
async function approvalNotice(member: { id: string; name: string; email: string }) {
  return recordAccountMail(member.id, "approved", member.email, () => sendAccountEmail({ to: member.email, subject: "【NSCT U15BBC】登録が承認されました", text: `${member.name} さん\n\n登録が承認されました。現在の名前と4桁コードでログインできます。\n${applicationUrl()}/login\nログイン後、アカウント設定でメールアドレスを確認してください。` }));
}

async function memberContext(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("member_id") ?? "");
  const { data: member, error } = await supabase.from("profiles").select("id,group_id,name,email,account_status").eq("id", id).eq("group_id", admin.group_id).maybeSingle();
  if (error || !member || member.account_status === "deleted") throw new Error("この会員を操作する権限がありません。");
  return { admin, member };
}
export async function updateMemberProfile(_previous: AccountState, form: FormData): Promise<AccountState> {
  const name = normalizeAccountName(form.get("name")), email = normalizeAccountEmail(form.get("email"));
  if (!name || name.length > 100 || !validAccountEmail(email)) return { ok: false, message: "名前とメールアドレスを正しく入力してください。" };
  try {
    const { admin, member } = await memberContext(form);
    if (admin.id === member.id) return { ok: false, message: "自分のアカウント設定をご利用ください。" };
    const active = member.account_status === "active";
    const { error } = await supabase.from("profiles").update(active ? { name } : { name, email }).eq("id", member.id).eq("group_id", admin.group_id);
    if (error) return { ok: false, message: error.code === "23505" ? "この名前は既に登録済みです。" : "登録情報を保存できませんでした。名前の重複を確認してください。" };
    let result: AccountState = { ok: true, message: "登録情報を更新しました。" };
    if (active && email !== normalizeAccountEmail(member.email)) {
      if (!await allowAuthAttempt("mail", member.id)) return { ok: false, message: "名前は保存しました。メール変更は送信上限のため時間をおいてお試しください。" };
      result = await sendAccountLink(member.id, "email_change", email, admin.id);
      result.message = `名前を保存しました。メール確認待ちです。${result.message}`;
    }
    revalidatePath("/admin/members"); return result;
  } catch { return { ok: false, message: "会員情報を変更できませんでした。操作権限と利用状態を確認してください。" }; }
}
export async function manageMember(_previous: AccountState, form: FormData): Promise<AccountState> {
  try {
    const { admin, member } = await memberContext(form);
    const action = String(form.get("intent") ?? "");
    if (action === "delete" && form.get("confirm_name") !== member.name) return { ok: false, message: "削除する会員の名前を確認欄へ入力してください。" };
    const { data, error } = await supabase.rpc("manage_app_member", { p_actor_id: admin.id, p_member_id: member.id, p_action: action });
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin/members");
    if (action === "approve") {
      const mail = data?.[0]?.outcome_status === "invited" ? await sendAccountLink(member.id, "setup", member.email, admin.id) : await approvalNotice(member);
      return { ...mail, message: `${member.name} さんの登録を承認しました。${mail.message}` };
    }
    const messages: Record<string, string> = { suspend: "利用を停止しました。", resume: "利用を再開しました。", role_admin: "管理者権限を付与しました。", role_user: "一般会員へ変更しました。" };
    return { ok: true, message: action === "delete" ? data?.[0]?.outcome_mode === "permanent" ? "会員を完全削除しました。" : "会員を削除済みにしました。" : `${member.name} さんの${messages[action] || "利用状態を更新しました。"}` };
  } catch { return { ok: false, message: "処理できませんでした。権限・メール設定・会員の利用状態を確認してください。" }; }
}

// 一覧全体で結果を保持し、承認によるカード移動や完全削除でも案内を消さない。
export async function performMemberAction(_previous: MemberListState, form: FormData): Promise<MemberListState> {
  await requireAdmin();
  const operation = String(form.get("operation") || "");
  const memberId = String(form.get("member_id") || "");
  const initial = { ok: false, message: "" };
  const result = operation === "profile" ? await updateMemberProfile(initial, form)
    : operation === "manage" ? await manageMember(initial, form)
    : operation === "mail" ? await sendMemberMail(initial, form)
    : { ok: false, message: "操作を選び直してください。" };
  return { ...result, memberId };
}
export async function sendMemberMail(_previous: AccountState, form: FormData): Promise<AccountState> {
  try {
    const { admin, member } = await memberContext(form);
    if (!await allowAuthAttempt("mail", member.id)) return { ok: false, message: "送信・発行の上限に達しました。時間をおいてお試しください。" };
    const intent = String(form.get("intent") ?? "");
    if (!["registration", "retry_email", "manual_reset", "reset_email"].includes(intent)) return { ok: false, message: "メール操作が不正です。" };
    if (intent === "registration") return await notifyRegistration(member.id, member.name, member.email);
    if (intent === "retry_email") {
      const { data: previous } = await supabase.from("app_account_notifications").select("kind,recipient").eq("profile_id", member.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (previous?.kind === "registration") return await notifyRegistration(member.id, member.name, member.email);
      if (previous?.kind === "approved") return await approvalNotice(member);
      if (previous && ["email_change", "verify_email"].includes(previous.kind)) return await sendAccountLink(member.id, previous.kind, previous.recipient, admin.id);
    }
    const manual = intent === "manual_reset";
    if (manual && form.get("identity_confirmed") !== "on") return { ok: false, message: "本人確認済みのチェックを入れてください。" };
    const purpose = member.account_status === "invited" ? manual ? "manual_setup" : "setup" : manual ? "manual_reset" : "admin_reset";
    if (member.account_status !== "invited" && member.account_status !== "active") return { ok: false, message: "承認・再開後に発行してください。" };
    return await sendAccountLink(member.id, purpose, member.email, admin.id, manual);
  } catch { return { ok: false, message: "リンクを発行できませんでした。登録メールと利用状態を確認してください。" }; }
}
export async function updateMemberLoginEnabled(form: FormData) {
  const { member } = await memberContext(form);
  form.set("intent", form.get("login_enabled") === "false" ? "suspend" : member.account_status === "suspended" ? "resume" : "approve");
  const result = await manageMember({ ok: false, message: "" }, form);
  if (!result.ok) throw new Error(result.message);
}
export async function updateMemberRole(form: FormData) {
  if (!["admin", "user"].includes(String(form.get("role")))) throw new Error("権限の値が不正です。");
  form.set("intent", form.get("role") === "admin" ? "role_admin" : "role_user");
  const result = await manageMember({ ok: false, message: "" }, form);
  if (!result.ok) throw new Error(result.message);
}
