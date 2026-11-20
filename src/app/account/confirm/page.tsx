import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
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
  return <main className="ui-page"><div className="ui-card mx-auto max-w-lg space-y-6">
    <PageHeader title={!valid ? "確認リンクを利用できません" : needsCode ? "4桁コードの設定" : "メールアドレスの確認"} backHref={profile ? "/account" : "/login"} backLabel={profile ? "アカウント設定に戻る" : "ログインに戻る"} />
    {valid ? <AccountActionForm action={confirmAccountLink} buttonText={needsCode ? "設定を完了" : "メールアドレスを確認"}><input type="hidden" name="token" value={token} />{needsCode && <><CodeInput name="new_code" label="新しい4桁コード" newCode /><CodeInput name="confirmation" label="新しい4桁コード（確認）" newCode /></>}</AccountActionForm> : <p className="rounded bg-amber-100 p-4">使用済み、または期限切れのリンクです。</p>}
    {!valid && !profile && <Link className="ui-button ui-button-secondary" href="/login/forgot-password">再設定メールを依頼</Link>}
  </div></main>;
}
