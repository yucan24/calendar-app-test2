import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { getMenuPath } from "@/lib/navigation";
import RegisterForm from "./RegisterForm";

export default async function RegisterPage() {
  const profile = await getCurrentProfile();
  return <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8"><div className="mx-auto max-w-md rounded-xl bg-white p-6 shadow-sm sm:p-8">
    <Link href={profile ? getMenuPath(profile.role) : "/login"} className="text-sm text-gray-600 underline underline-offset-4">{profile ? "← 一覧に戻る" : "← ログイン"}</Link>
    <h1 className="mt-6 text-2xl font-bold">新規登録</h1>
    <RegisterForm />
  </div></main>;
}
