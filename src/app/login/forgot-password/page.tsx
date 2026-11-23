import PageHeader from "@/components/ui/PageHeader";
import { getCurrentProfile } from "@/lib/auth";
import AccountActionForm from "@/components/AccountActionForm";
import { requestAccountRecovery } from "./actions";
export default async function ForgotPasswordPage() {
  const profile = await getCurrentProfile();
  return <main className="ui-page"><div className="ui-card mx-auto max-w-lg space-y-5"><PageHeader title="4桁コードを忘れた場合" backHref={profile ? "/account" : "/login"} backLabel={profile ? "アカウント設定に戻る" : "ログインに戻る"} /><AccountActionForm action={requestAccountRecovery} buttonText="再設定メールを依頼"><label className="block font-bold">名前<input name="name" required maxLength={100} className="ui-field mt-1" autoComplete="name" /></label><label className="block font-bold">登録メールアドレス<input name="email" type="email" required maxLength={254} className="ui-field mt-1" autoComplete="email" /></label></AccountActionForm></div></main>;
}
