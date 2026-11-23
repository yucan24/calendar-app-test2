import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { getCurrentProfile } from "@/lib/auth";

const titles: Record<string, string> = {
  setup: "初期設定が完了しました",
  reset: "4桁コードを再設定しました",
  email: "メールアドレスを確認しました",
  "email-changed": "メールアドレスを変更しました",
};

export default async function AccountCompletePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const kind = (await searchParams).kind || "";
  const title = Object.hasOwn(titles, kind) ? titles[kind] : "アカウント";
  const member = await getCurrentProfile();
  const returnToAccount = Boolean(member);
  return <main className="ui-page"><div className="ui-card mx-auto max-w-lg">
    <PageHeader title={title} />
    <Link href={returnToAccount ? "/account" : "/login"} className="ui-button ui-button-primary mt-6 block text-center">{returnToAccount ? "アカウント設定へ" : "ログインへ"}</Link>
  </div></main>;
}
