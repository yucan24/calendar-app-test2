import LogoutButton from "@/components/LogoutButton";
import PageHeader from "@/components/ui/PageHeader";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/pagination";
import { TEST_SUPABASE_REF } from "@/lib/environment";
import MemberManagement from "./MemberManagement";
import { performMemberAction } from "./actions";
import type { Member, MemberNotice } from "./memberView";

export default async function AdminMembersPage() {
  const admin = await requireAdmin();
  const { data, error } = await fetchAllRows((from, to) => supabase.from("profiles").select("id,name,email,role,account_status,email_verified_at").eq("group_id", admin.group_id).order("created_at", { ascending: false }).order("id").range(from, to));
  if (error) throw new Error("会員一覧を取得できませんでした。");
  const members = (data || []) as Member[];
  const { data: notices, error: noticeError } = members.length ? await fetchAllRows((from, to) => supabase.from("app_account_notifications").select("profile_id,kind,delivery_status,created_at").in("profile_id", members.map(m => m.id)).order("created_at", { ascending: false }).order("id").range(from, to)) : { data: [], error: null };
  if (noticeError) throw new Error("メールの送信履歴を取得できませんでした。");
  const lastMail = new Map<string, MemberNotice>();
  for (const notice of (notices || []) as MemberNotice[]) if (notice.kind !== "billing_reminder" && !lastMail.has(notice.profile_id)) lastMail.set(notice.profile_id, notice);
  const testEnvironment = new URL(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname === `${TEST_SUPABASE_REF}.supabase.co`;
  return <main className="ui-page"><div className="mx-auto max-w-5xl space-y-6">
    <PageHeader title="会員管理" backHref="/admin" actions={<><Link href="/account" className="ui-button ui-button-secondary">アカウント設定</Link><LogoutButton /></>} />
    <MemberManagement key={admin.id} memberAction={performMemberAction.bind(null, admin.id)} members={members} notices={[...lastMail.values()]} adminId={admin.id} testEnvironment={testEnvironment} testInbox={testEnvironment && process.env.EMAIL_DELIVERY_MODE === "test" ? process.env.EMAIL_TEST_TO || "" : ""} />
  </div></main>;
}
