import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { getCurrentProfile } from "@/lib/auth";
import { getMenuPath } from "@/lib/navigation";

export default async function RegisterThanksPage() {
  const profile = await getCurrentProfile();
  return <main className="ui-page"><div className="ui-card mx-auto max-w-md">
    <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">承認待ち</span>
    <PageHeader title="登録を申請しました" />
    <Link href={profile ? getMenuPath(profile.role) : "/login"} className="ui-button ui-button-primary mt-6 block text-center">{profile ? "一覧に戻る" : "ログインへ"}</Link>
  </div></main>;
}
