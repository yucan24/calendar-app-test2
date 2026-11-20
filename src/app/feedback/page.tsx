import PageHeader from "@/components/ui/PageHeader";
import LogoutButton from "@/components/LogoutButton";
import { getCurrentProfile } from "@/lib/auth";
import { getMenuPath } from "@/lib/navigation";
import FeedbackForm from "./FeedbackForm";

export default async function FeedbackPage() {
  const profile = await getCurrentProfile();
  return (
    <main className="ui-page">
      <div className="mx-auto max-w-2xl">
        <PageHeader title="開発者へのご意見" backHref={profile ? getMenuPath(profile.role) : "/login"} backLabel={profile ? "一覧に戻る" : "ログインに戻る"} actions={profile ? <LogoutButton /> : undefined}>
          <p>送信先：bbstatus@gmail.com</p>
        </PageHeader>

        <section className="ui-card mt-6">
          <FeedbackForm />
        </section>
      </div>
    </main>
  );
}
