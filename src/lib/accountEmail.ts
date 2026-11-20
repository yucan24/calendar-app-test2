import "server-only";
import nodemailer from "nodemailer";
import { TEST_SUPABASE_REF } from "@/lib/environment";

export type AccountMail = { to: string; subject: string; text: string };
export type DeliveryStatus = "sent" | "disabled";
export function applicationUrl() {
  const raw = process.env.APP_URL || (process.env.VERCEL_ENV === "production" ? "https://nsct-u15bbc.vercel.app" : "http://127.0.0.1:3010");
  const url = new URL(raw);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("アプリURLの設定を確認してください。");
  return url.origin;
}
export async function sendAccountEmail(mail: AccountMail): Promise<DeliveryStatus> {
  const database = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const test = new URL(database).hostname === `${TEST_SUPABASE_REF}.supabase.co`;
  // Test/Development never delivers to a member, including when credentials are present.
  if (test || process.env.VERCEL_ENV !== "production") {
    if (process.env.EMAIL_DELIVERY_MODE !== "test") return "disabled";
    const destination = process.env.EMAIL_TEST_TO?.trim();
    if (!destination || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) throw new Error("テスト用受信先を設定してください。");
    mail = { ...mail, to: destination, subject: `【テスト環境】${mail.subject}`, text: `本来の送信先: ${mail.to}\n\n${mail.text}` };
  } else if (process.env.EMAIL_DELIVERY_MODE !== "production") {
    throw new Error("本番のメール送信が有効になっていません。");
  }
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD?.replace(/\s/g, "");
  if (!user || !pass) throw new Error("メール送信の認証設定がありません。管理者へお問い合わせください。");
  const port = Number(process.env.SMTP_PORT || "465");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com", port, secure: port === 465,
    requireTLS: true, auth: { user, pass }, connectionTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  try {
    const result = await transport.sendMail({ from: process.env.EMAIL_FROM || `NSCT U15BBC <${user}>`, ...mail });
    if (result.rejected.length || !result.accepted.length) throw new Error("rejected");
    return "sent";
  } catch {
    throw new Error("メールを送信できませんでした。管理者画面で送信設定を確認し、再送してください。");
  } finally { transport.close(); }
}
