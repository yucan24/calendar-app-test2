import { requireAdmin } from "@/lib/auth";

export default async function AdminPage() {
  const profile = await requireAdmin();

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">管理者画面</h1>
            <p className="mt-2 text-sm text-gray-600">
              {profile.name} さんでログイン中
            </p>
          </div>

          <a href="/logout" className="rounded border bg-white px-4 py-2 text-sm">
            ログアウト
          </a>
        </div>

        <div className="mt-6 grid gap-4">
          <a
            href="/admin/users"
            className="rounded-lg bg-white p-6 shadow hover:bg-gray-50"
          >
            <h2 className="text-lg font-bold">ユーザー一覧</h2>
            <p className="mt-1 text-sm text-gray-600">
              月謝の確認。
            </p>
          </a>

          <a
            href="/admin/calendar"
            className="rounded-lg bg-white p-6 shadow hover:bg-gray-50"
          >
            <h2 className="text-lg font-bold">カレンダー</h2>
            <p className="mt-1 text-sm text-gray-600">
              予定作成、出欠確認、集計を行います。
            </p>
          </a>
        </div>
      </div>
    </main>
  );
}