import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { hashSessionToken } from "@/lib/session";
import CodeInput from "@/components/CodeInput";
import AccountActionForm from "@/components/AccountActionForm";
import { confirmAccountLink } from "./actions";
export const metadata: Metadata = { title: "アカウントの確認", referrer: "no-referrer", robots: { index: false, follow: false } };
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const profile = await getCurrentProfile();
  const token = (await searchParams).token || "", hash = hashSessionToken(token);
  const result = hash ? await supabase.rpc("inspect_app_account_token", { p_token_hash: hash }) : { data: null };
  const data = result.data?.[0];
  const valid = Boolean(data);
  const needsCode = data && ["setup", "reset", "admin_reset", "manual_setup", "manual_reset"].includes(data.purpose);
  return <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8"><div className="mx-auto max-w-lg space-y-6 rounded-xl bg-white p-6 shadow-sm sm:p-8"><h1 className="text-2xl font-bold">{!valid ? "確認リンクを利用できません" : needsCode ? "4桁コードの設定" : "メールアドレスの確認"}</h1>
    {valid ? <AccountActionForm action={confirmAccountLink} buttonText={needsCode ? "設定を完了" : "メールアドレスを確認"}><input type="hidden" name="token" value={token} />{needsCode && <><CodeInput name="new_code" label="新しい4桁コード" newCode /><CodeInput name="confirmation" label="新しい4桁コード（確認）" newCode /></>}</AccountActionForm> : <p className="rounded bg-amber-100 p-4">使用済み、または期限切れのリンクです。</p>}
    <Link className="block underline" href={profile ? "/account" : "/login"}>{profile ? "アカウント設定へ戻る" : "ログインへ"}</Link>
    {!valid && !profile && <Link className="block underline" href="/login/forgot-password">再設定メールを依頼</Link>}
  </div></main>;
}
