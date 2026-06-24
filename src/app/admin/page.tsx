import { requireAdmin } from "@/lib/auth";

export default async function AdminPage() {
  const profile = await requireAdmin();

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">管理者画面</h1>
            <p className="mt-3 text-base font-medium text-gray-700">
              {profile.name} さんでログイン中
            </p>
          </div>

          <a
            href="/logout"
            className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
          >
            ログアウト
          </a>
        </div>

        <div className="mt-8 grid gap-5">
          <a
            href="/admin/users"
            className="rounded-lg bg-white p-6 shadow hover:bg-gray-50"
          >
            <h2 className="text-2xl font-bold text-gray-900">
              ユーザー・請求管理
            </h2>
            <p className="mt-3 text-base font-medium text-gray-700">
              月謝、遠征費、その他費用の確認と支払い管理を行います。
            </p>
          </a>

          <a
            href="/admin/calendar"
            className="rounded-lg bg-white p-6 shadow hover:bg-gray-50"
          >
            <h2 className="text-2xl font-bold text-gray-900">カレンダー</h2>
            <p className="mt-3 text-base font-medium text-gray-700">
              予定作成、出欠確認、集計を行います。
            </p>
          </a>
        </div>
      </div>
    </main>
  );
}