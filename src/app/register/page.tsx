import PageHeader from "@/components/ui/PageHeader";
import { getCurrentProfile } from "@/lib/auth";
import { getMenuPath } from "@/lib/navigation";
import RegisterForm from "./RegisterForm";

export default async function RegisterPage() {
  const profile = await getCurrentProfile();
  return <main className="ui-page"><div className="ui-card mx-auto max-w-lg">
    <PageHeader title="新規登録" backHref={profile ? getMenuPath(profile.role) : "/login"} backLabel={profile ? "一覧に戻る" : "ログインに戻る"} />
    <RegisterForm />
  </div></main>;
}
