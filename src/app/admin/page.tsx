import Link from "next/link";
import PendingNavigationButton from "@/components/PendingNavigationButton";
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

          <PendingNavigationButton
            href="/logout"
            className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
          >
            ログアウト
          </PendingNavigationButton>
        </div>

        <div className="mt-8 grid gap-5">
          <Link
            href="/admin/calendar"
            className="rounded-lg bg-white p-6 shadow hover:bg-gray-50"
          >
            <h2 className="text-2xl font-bold text-gray-900">カレンダー</h2>
            <p className="mt-3 text-base font-medium text-gray-700">
              予定作成、出欠確認、集計を行います。
            </p>
          </Link>

          <Link
            href="/admin/coach-work"
            className="rounded-lg bg-white p-6 shadow hover:bg-gray-50"
          >
            <h2 className="text-2xl font-bold text-gray-900">
              指導者勤怠・立替管理
            </h2>
            <p className="mt-3 text-base font-medium text-gray-700">
              指導時間、事務作業時間、交通費、立替費用を記録・集計します。
            </p>
          </Link>

          <Link
            href="/admin/accounting"
            className="rounded-lg bg-white p-6 shadow hover:bg-gray-50"
          >
            <h2 className="text-2xl font-bold text-gray-900">会計管理</h2>
            <p className="mt-3 text-base font-medium text-gray-700">
              集計、銀行CSVの取込、入出金照合、指導者報酬をまとめて管理します。
            </p>
          </Link>

          <Link
            href="/admin/users"
            className="rounded-lg bg-white p-6 shadow hover:bg-gray-50"
          >
            <h2 className="text-2xl font-bold text-gray-900">
              ユーザー・請求管理
            </h2>
            <p className="mt-3 text-base font-medium text-gray-700">
              月謝、遠征費、その他費用の確認と支払い管理を行います。
            </p>
          </Link>

          <Link
            href="/admin/members"
            className="rounded-lg bg-white p-6 shadow hover:bg-gray-50"
          >
            <h2 className="text-2xl font-bold text-gray-900">会員管理</h2>
            <p className="mt-3 text-base font-medium text-gray-700">
              会員登録の承認、登録情報編集、管理者権限、ログイン許可を管理します。
            </p>
          </Link>

        </div>
      </div>
    </main>
  );
}
