import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { getMenuPath } from "@/lib/navigation";
import FeedbackForm from "./FeedbackForm";

export default async function FeedbackPage() {
  const profile = await getCurrentProfile();
  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              開発者へのご意見
            </h1>
            <p className="mt-3 text-base font-medium text-gray-700">
              送信先：bbstatus@gmail.com
            </p>
          </div>

          <Link
            href={profile ? getMenuPath(profile.role) : "/login"}
            className="rounded border border-gray-400 bg-white px-4 py-2 text-center font-bold text-gray-900"
          >
            {profile ? "一覧に戻る" : "ログインへ戻る"}
          </Link>
        </div>

        <section className="mt-6 rounded-lg bg-white p-6 shadow">
          <FeedbackForm />
        </section>
      </div>
    </main>
  );
}
