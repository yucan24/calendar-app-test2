import "server-only";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { createSessionToken, hashSessionToken } from "@/lib/session";
import { applicationUrl, sendAccountEmail } from "@/lib/accountEmail";

export async function recordAccountMail(profileId: string, kind: string, recipient: string, send: () => Promise<"sent" | "disabled">) {
  let status: "sent" | "failed" | "disabled" = "failed", errorMessage: string | null = null;
  try { status = await send(); } catch { errorMessage = "送信に失敗しました。SMTP設定を確認して再送してください。"; }
  const { error } = await supabase.from("app_account_notifications").insert({ profile_id: profileId, kind, recipient, delivery_status: status, error_message: errorMessage });
  if (error) throw new Error("メールの送信結果を記録できませんでした。管理者へお問い合わせください。");
  revalidatePath("/admin/members");
  return { ok: status !== "failed", message: status === "sent" ? "メールを送信しました。" : status === "disabled" ? "テスト受付済みです（実メール送信は停止中）。" : errorMessage! };
}
export async function sendAccountLink(profileId: string, purpose: string, email: string, actorId: string | null, manual = false) {
  const token = createSessionToken();
  const { data, error } = await supabase.rpc("issue_app_account_token", { p_profile_id: profileId, p_purpose: purpose, p_token_hash: hashSessionToken(token), p_email: email, p_actor_id: actorId });
  if (error || !data?.[0]) throw new Error("リンクを発行できません。会員の利用状態とメールアドレスを確認してください。");
  const url = `${applicationUrl()}/account/confirm?token=${token}`;
  if (manual) return { ok: true, message: "本人確認済みの相手にだけ、このリンクを渡してください。有効期限は30分、使用は1回限りです。", url };
  const labels: Record<string, string> = { setup: "利用開始・4桁コードの設定", reset: "4桁コードの再設定", admin_reset: "4桁コードの再設定", verify_email: "メールアドレスの確認", email_change: "メールアドレス変更の確認" };
  const label = labels[purpose];
  return recordAccountMail(profileId, purpose, data[0].recipient, () => sendAccountEmail({ to: data[0].recipient, subject: `【NSCT U15BBC】${label}`, text: `${data[0].member_name} さん\n\n${label}のリンクです。\n${url}\n\n有効期限は30分です。リンク先で確認操作を行うまで変更は確定しません。心当たりがない場合は操作せず、このメールを削除してください。\n4桁コードをメールでお知らせすることはありません。` }));
}
export async function notifyRegistration(profileId: string, name: string, email: string) {
  const to = process.env.ACCOUNT_ADMIN_EMAIL || process.env.SMTP_USER || "nsctu15bbc.webapp@gmail.com";
  return recordAccountMail(profileId, "registration", to, () => sendAccountEmail({ to, subject: "【NSCT U15BBC】会員登録の申請", text: `${name} さんから申請がありました。\n登録メール: ${email}\n\n${applicationUrl()}/admin/members\n管理者画面で承認・削除を行ってください。` }));
}
