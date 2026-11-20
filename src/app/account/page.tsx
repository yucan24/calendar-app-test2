import Link from "next/link";
import { requireLogin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import CodeInput from "@/components/CodeInput";
import AccountActionForm from "@/components/AccountActionForm";
import { changeAccount, requestAccountEmail } from "./actions";
const input = "mt-1 block w-full rounded border border-gray-400 p-3 text-base";
export default async function AccountPage() {
  const member = await requireLogin();
  const { data, error } = await supabase.from("profiles").select("email_verified_at").eq("id", member.id).single();
  if (error) throw new Error("アカウント情報を取得できませんでした。");
  return <main className="mx-auto min-h-screen max-w-2xl space-y-6 bg-gray-50 p-4 text-gray-900 sm:p-8">
    <h1 className="text-2xl font-bold">アカウント設定</h1><Link className="underline" href={member.role === "admin" ? "/admin" : "/user"}>トップへ戻る</Link>
    <section className="space-y-4 rounded bg-white p-5 shadow"><h2 className="text-xl font-bold">名前・4桁コード</h2>
      <AccountActionForm action={changeAccount} buttonText="変更して再ログイン"><label className="block font-bold">名前<input className={input} name="name" defaultValue={member.name} maxLength={100} required autoComplete="name" /></label><CodeInput name="current_code" label="現在の4桁コード" /><CodeInput name="new_code" label="新しい4桁コード（任意）" required={false} newCode /><CodeInput name="confirmation" label="新しい4桁コード（確認）" required={false} newCode /></AccountActionForm>
    </section>
    <section className="space-y-4 rounded bg-white p-5 shadow"><h2 className="text-xl font-bold">メールアドレス</h2><p className="break-all">{member.email}</p><p className="text-sm">{data?.email_verified_at ? "確認済み" : "未確認"}</p>
      {!data?.email_verified_at && <AccountActionForm action={requestAccountEmail} buttonText="確認メールを送信"><input type="hidden" name="intent" value="verify" /></AccountActionForm>}
      <details><summary className="cursor-pointer font-bold">メールアドレスを変更</summary><div className="mt-3"><AccountActionForm action={requestAccountEmail} buttonText="新しいアドレスへ確認メールを送信"><input type="hidden" name="intent" value="change" /><label className="block font-bold">新しいメールアドレス<input name="email" type="email" maxLength={254} required className={input} autoComplete="email" /></label><CodeInput name="current_code" label="現在の4桁コード" /></AccountActionForm></div></details>
    </section>
  </main>;
}
