import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/pagination";
import { normalizeAccountEmail, validAccountEmail } from "@/lib/accountPolicy";
import { applicationUrl, sendAccountEmail } from "@/lib/accountEmail";
import { recordAccountMail } from "@/lib/accountLinks";
import { formatTargetMonth, formatYen, isValidTargetMonth } from "@/lib/month";

export type ReminderFilter = { month: string; category: "tuition" | "all" };
type Member = { id: string; name: string; email: string; account_status: string; login_enabled: boolean; email_verified_at: string | null };
type Bill = { id: string; user_id: string; target_month: string; category: string; title: string; amount: number; status: string; updated_at: string };
export type ReminderRequest = ReminderFilter & { profileId: string; requestId: string; preparedAt: number; digest: string };
export type ReminderRecipient = { id: string; name: string; email: string; total: number; subject: string; text: string; unavailable: string | null; lastDelivery: { status: string; at: string } | null; request: ReminderRequest };
export type ReminderResult = { status: "sent" | "disabled" | "failed" | "changed" | "blocked" | "duplicate" | "unknown"; message: string };
type Admin = { id: string; group_id: string };
const memberColumns = "id,name,email,account_status,login_enabled,email_verified_at";
const billColumns = "id,user_id,target_month,category,title,amount,status,updated_at";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const uuid = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export function validReminderFilter(filter: ReminderFilter) {
  return isValidTargetMonth(filter.month) && ["tuition", "all"].includes(filter.category);
}
function unpaid(items: Bill[], filter: ReminderFilter) {
  return items.filter((item) => item.status === "unpaid" && item.amount > 0 && item.title !== "返金" && item.target_month <= filter.month && (filter.category === "all" || item.category === "tuition"));
}
function unavailable(member: Member) {
  if (member.account_status !== "active" || !member.login_enabled) return "利用中ではありません";
  if (!validAccountEmail(normalizeAccountEmail(member.email))) return "メール未登録";
  if (!member.email_verified_at) return "メール未確認";
  return null;
}
function fingerprint(admin: Admin, member: Member, items: Bill[], filter: ReminderFilter) {
  return hash(JSON.stringify({ actor: admin.id, group: admin.group_id, member, filter, items: [...items].sort((a, b) => a.id.localeCompare(b.id)) }));
}
function message(member: Member, items: Bill[], filter: ReminderFilter) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const subject = `【NSCT U15BBC】${filter.category === "tuition" ? "月謝" : "お支払い"}のご確認`;
  const lines = items.map((item) => `${formatTargetMonth(item.target_month)}　${item.title}　${formatYen(item.amount)}`);
  const text = `${member.name} さん\n\n${formatTargetMonth(filter.month)}までのお支払いについてご案内します。\n\n${lines.join("\n")}\n\n未払い合計：${formatYen(total)}\n\n${applicationUrl()}/user/payment-check\n\n行き違いでお支払い済みの場合はご容赦ください。\nご不明な点はチーム管理者へお問い合わせください。`;
  return { total, subject, text };
}
function billQuery(groupId: string, filter: ReminderFilter) {
  return supabase.from("billing_items").select(billColumns).eq("group_id", groupId).eq("status", "unpaid").gt("amount", 0).lte("target_month", filter.month);
}

export async function prepareReminders(admin: Admin, filter: ReminderFilter): Promise<ReminderRecipient[]> {
  if (!validReminderFilter(filter)) throw new Error("対象月と費目を確認してください。");
  const members = await fetchAllRows<Member>((from, to) => supabase.from("profiles").select(memberColumns).eq("group_id", admin.group_id).order("id").range(from, to));
  const bills = await fetchAllRows<Bill>((from, to) => billQuery(admin.group_id, filter).order("id").range(from, to));
  if (members.error || bills.error) throw new Error("未払い情報を取得できませんでした。");
  const items = unpaid(bills.data ?? [], filter);
  const people = (members.data ?? []).filter((person) => items.some((item) => item.user_id === person.id));
  const lastDelivery = new Map<string, { status: string; at: string }>();
  for (let start = 0; start < people.length; start += 200) {
    const ids = people.slice(start, start + 200).map((person) => person.id);
    const notices = await fetchAllRows<{ profile_id: string; delivery_status: string; created_at: string }>((from, to) => supabase.from("app_account_notifications").select("profile_id,delivery_status,created_at").eq("kind", "billing_reminder").in("profile_id", ids).order("created_at", { ascending: false }).order("id").range(from, to));
    if (notices.error) throw new Error("送信履歴を取得できませんでした。");
    for (const notice of notices.data ?? []) if (!lastDelivery.has(notice.profile_id)) lastDelivery.set(notice.profile_id, { status: notice.delivery_status, at: new Date(notice.created_at).toISOString() });
  }
  return people.flatMap((member) => {
    const own = items.filter((item) => item.user_id === member.id);
    if (!own.length) return [];
    const previous = lastDelivery.get(member.id) ?? null;
    const recent = previous && Date.now() - Date.parse(previous.at) < 300_000;
    return [{ id: member.id, name: member.name, email: member.email, ...message(member, own, filter), unavailable: unavailable(member) || (recent ? "送信直後（5分以内）" : null), lastDelivery: previous, request: { ...filter, profileId: member.id, requestId: randomUUID(), preparedAt: Date.now(), digest: fingerprint(admin, member, own, filter) } }];
  }).sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

async function claim(bucket: string, window: number) {
  const { data, error } = await supabase.rpc("consume_auth_rate_limit", { p_bucket_hash: hash(bucket), p_limit: 1, p_window_seconds: window });
  if (error || typeof data !== "boolean") throw new Error("送信状況を確認できませんでした。");
  return data;
}

export async function deliverReminder(admin: Admin, request: ReminderRequest): Promise<ReminderResult> {
  if (!request || !validReminderFilter(request) || !uuid(request.profileId) || !uuid(request.requestId) || !/^[a-f0-9]{64}$/.test(request.digest) || !Number.isFinite(request.preparedAt) || request.preparedAt > Date.now() + 1000 || Date.now() - request.preparedAt > 10 * 60_000) return { status: "changed", message: "宛先をもう一度確認してください。" };
  const memberResult = await supabase.from("profiles").select(memberColumns).eq("id", request.profileId).eq("group_id", admin.group_id).single();
  const member = memberResult.data as Member | null;
  if (memberResult.error || !member || unavailable(member)) return { status: "changed", message: "会員の登録情報を確認してください。" };
  const bills = await fetchAllRows<Bill>((from, to) => billQuery(admin.group_id, request).eq("user_id", member.id).order("id").range(from, to));
  if (bills.error) return { status: "blocked", message: "未払い情報を取得できませんでした。" };
  const items = unpaid(bills.data ?? [], request);
  const filter: ReminderFilter = { month: request.month, category: request.category };
  if (!items.length || fingerprint(admin, member, items, filter) !== request.digest) return { status: "changed", message: "請求または登録情報が更新されています。宛先を再確認してください。" };
  if (!await claim(`billing-reminder:request:${admin.group_id}:${request.requestId}`, 3600)) return { status: "duplicate", message: "この送信は受付済みです。" };
  // Shared by all administrators: parallel/replayed requests cannot double-send.
  if (!await claim(`billing-reminder:member:${admin.group_id}:${member.id}`, 300)) return { status: "blocked", message: "送信直後です。5分後に宛先を再確認してください。" };
  let delivery: "sent" | "disabled" | undefined;
  try {
    const result = await recordAccountMail(member.id, "billing_reminder", normalizeAccountEmail(member.email), async () => {
      const { subject, text } = message(member, items, filter);
      delivery = await sendAccountEmail({ to: normalizeAccountEmail(member.email), subject, text });
      return delivery;
    });
    return { status: result.ok ? delivery === "disabled" ? "disabled" : "sent" : "failed", message: result.ok ? delivery === "disabled" ? "テスト受付（実送信なし）" : "送信済み" : "送信に失敗しました。" };
  } catch {
    return { status: "unknown", message: delivery === "sent" ? "送信済み・履歴保存失敗" : "送信結果を確認できませんでした。" };
  }
}
