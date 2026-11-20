import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import AccountActionForm from "@/components/AccountActionForm";
import { requestAccountRecovery } from "./actions";
export default async function ForgotPasswordPage() {
  const profile = await getCurrentProfile();
  return <main className="mx-auto max-w-lg space-y-5 p-6 text-gray-900"><h1 className="text-2xl font-bold">4桁コードを忘れた場合</h1><AccountActionForm action={requestAccountRecovery} buttonText="再設定メールを依頼"><label className="block font-bold">名前<input name="name" required maxLength={100} className="mt-1 block w-full rounded border p-3" autoComplete="name" /></label><label className="block font-bold">登録メールアドレス<input name="email" type="email" required maxLength={254} className="mt-1 block w-full rounded border p-3" autoComplete="email" /></label></AccountActionForm><Link className="underline" href={profile ? "/account" : "/login"}>{profile ? "アカウント設定へ戻る" : "ログインへ戻る"}</Link></main>;
}
