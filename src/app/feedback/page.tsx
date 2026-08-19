import Link from "next/link";
import { requireLogin } from "@/lib/auth";
import FeedbackForm from "./FeedbackForm";

export default async function FeedbackPage() {
  const profile = await requireLogin();
  const backHref = profile.role === "admin" ? "/admin" : "/user";

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              開発者へのご意見
            </h1>
            <p className="mt-3 text-base font-medium text-gray-700">
              {profile.name} さんでログイン中
            </p>
          </div>

          <Link
            href={backHref}
            className="rounded border border-gray-400 bg-white px-4 py-2 text-center font-bold text-gray-900"
          >
            戻る
          </Link>
        </div>

        <section className="mt-6 rounded-lg bg-white p-6 shadow">
          <FeedbackForm />
        </section>
      </div>
    </main>
  );
}
