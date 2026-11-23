import PageHeader from "@/components/ui/PageHeader";
import LogoutButton from "@/components/LogoutButton";
import { requireLogin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import CodeInput from "@/components/CodeInput";
import AccountActionForm from "@/components/AccountActionForm";
import { changeAccount, requestAccountEmail } from "./actions";
const input = "ui-field mt-1";
export default async function AccountPage() {
  const member = await requireLogin();
  const { data, error } = await supabase.from("profiles").select("email_verified_at").eq("id", member.id).single();
  if (error) throw new Error("アカウント情報を取得できませんでした。");
  return <main className="ui-page mx-auto max-w-2xl space-y-6">
    <PageHeader title="アカウント設定" backHref={member.role === "admin" ? "/admin" : "/user"} actions={<LogoutButton />} />
    <section className="ui-card space-y-4"><h2 className="ui-section-title">名前・4桁コード</h2>
      <AccountActionForm action={changeAccount} buttonText="変更して再ログイン"><label className="block font-bold">名前<input className={input} name="name" defaultValue={member.name} maxLength={100} required autoComplete="name" /></label><CodeInput name="current_code" label="現在の4桁コード" /><CodeInput name="new_code" label="新しい4桁コード（任意）" required={false} newCode /><CodeInput name="confirmation" label="新しい4桁コード（確認）" required={false} newCode /></AccountActionForm>
    </section>
    <section className="ui-card space-y-4"><h2 className="ui-section-title">メールアドレス</h2><p className="break-all">{member.email}</p><p className="text-sm">{data?.email_verified_at ? "確認済み" : "未確認"}</p>
      {!data?.email_verified_at && <AccountActionForm action={requestAccountEmail} buttonText="確認メールを送信"><input type="hidden" name="intent" value="verify" /></AccountActionForm>}
      <details><summary className="cursor-pointer font-bold">メールアドレスを変更</summary><div className="mt-3"><AccountActionForm action={requestAccountEmail} buttonText="新しいアドレスへ確認メールを送信"><input type="hidden" name="intent" value="change" /><label className="block font-bold">新しいメールアドレス<input name="email" type="email" maxLength={254} required className={input} autoComplete="email" /></label><CodeInput name="current_code" label="現在の4桁コード" /></AccountActionForm></div></details>
    </section>
  </main>;
}
