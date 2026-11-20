import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { getMenuPath } from "@/lib/navigation";

export default async function RegisterThanksPage() {
  const profile = await getCurrentProfile();
  return <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8"><div className="mx-auto max-w-md rounded-xl bg-white p-6 shadow-sm sm:p-8">
    <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">承認待ち</span>
    <h1 className="mt-4 text-2xl font-bold">登録を申請しました</h1>
    <Link href={profile ? getMenuPath(profile.role) : "/login"} className="mt-6 block rounded-lg bg-blue-700 px-4 py-3 text-center font-bold text-white">{profile ? "一覧に戻る" : "ログインへ"}</Link>
  </div></main>;
}
