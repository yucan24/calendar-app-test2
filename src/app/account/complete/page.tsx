import Link from "next/link";
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
  return <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8"><div className="mx-auto max-w-lg rounded-xl bg-white p-6 shadow-sm sm:p-8">
    <h1 className="text-2xl font-bold">{title}</h1>
    <Link href={returnToAccount ? "/account" : "/login"} className="mt-6 block rounded-lg bg-blue-700 px-4 py-3 text-center font-bold text-white">{returnToAccount ? "アカウント設定へ" : "ログインへ"}</Link>
  </div></main>;
}
