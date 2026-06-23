import { requireUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default async function UserPage() {
  const profile = await requireUser();

  const { data: ticket } = await supabase
    .from("ticket_balances")
    .select("remaining_count, expires_at")
    .eq("user_id", profile.id)
    .maybeSingle();

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">回数券</h1>
            <p className="mt-2 text-sm text-gray-600">
              {profile.name} さん
            </p>
          </div>

          <a href="/logout" className="rounded border bg-white px-4 py-2 text-sm">
            ログアウト
          </a>
        </div>

        <div className="mt-6 rounded-lg bg-white p-6 shadow">
          <p className="text-sm text-gray-500">現在の残り回数</p>
          <p className="mt-2 text-5xl font-bold">
            {ticket?.remaining_count ?? 0}回
          </p>
          <p className="mt-4 text-sm text-gray-600">
            有効期限：{ticket?.expires_at ?? "未設定"}
          </p>
        </div>

        <div className="mt-6 grid gap-3">
          <a
            href="/user/calendar"
            className="rounded border bg-white px-4 py-3 shadow"
          >
            予定・出欠を確認する
          </a>

          <a
            href="/user/history"
            className="rounded border bg-white px-4 py-3 shadow"
          >
            利用履歴を見る
          </a>
        </div>
      </div>
    </main>
  );
}