import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/pagination";
import { TEST_SUPABASE_REF } from "@/lib/environment";
import MemberManagement from "./MemberManagement";
import type { Member, MemberNotice } from "./memberView";

export default async function AdminMembersPage() {
  const admin = await requireAdmin();
  const { data, error } = await fetchAllRows((from, to) => supabase.from("profiles").select("id,name,email,role,account_status,email_verified_at").eq("group_id", admin.group_id).order("created_at", { ascending: false }).order("id").range(from, to));
  if (error) throw new Error("会員一覧を取得できませんでした。");
  const members = (data || []) as Member[];
  const { data: notices, error: noticeError } = members.length ? await fetchAllRows((from, to) => supabase.from("app_account_notifications").select("profile_id,kind,delivery_status,created_at").in("profile_id", members.map(m => m.id)).order("created_at", { ascending: false }).order("id").range(from, to)) : { data: [], error: null };
  if (noticeError) throw new Error("メールの送信履歴を取得できませんでした。");
  const lastMail = new Map<string, MemberNotice>();
  for (const notice of (notices || []) as MemberNotice[]) if (!lastMail.has(notice.profile_id)) lastMail.set(notice.profile_id, notice);
  const testEnvironment = new URL(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname === `${TEST_SUPABASE_REF}.supabase.co`;
  return <main className="min-h-screen bg-slate-50 p-4 text-gray-900 sm:p-8"><div className="mx-auto max-w-5xl space-y-6">
    <header className="space-y-4"><Link href="/admin" className="text-sm font-medium text-gray-600 underline underline-offset-4">← 管理者トップ</Link>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold">会員管理</h1></div><Link href="/account" className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-bold">自分のアカウント設定</Link></div>
    </header>
    <MemberManagement members={members} notices={[...lastMail.values()]} adminId={admin.id} testEnvironment={testEnvironment} testInbox={testEnvironment && process.env.EMAIL_DELIVERY_MODE === "test" ? process.env.EMAIL_TEST_TO || "" : ""} />
  </div></main>;
}
