import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  formatTargetMonth,
  formatYen,
  getCurrentTargetMonth,
} from "@/lib/month";

type BillingItem = {
  id: string;
  target_month: string;
  category: string;
  title: string;
  amount: number;
  due_date: string | null;
  note: string | null;
};

function categoryLabel(category: string) {
  if (category === "tuition") return "月謝";
  if (category === "trip") return "遠征費";
  if (category === "event") return "大会・イベント費";
  if (category === "uniform") return "ユニフォーム代";
  return "その他";
}

export default async function UserPaymentCheckPage() {
  const user = await requireUser();
  const currentMonth = getCurrentTargetMonth();

  const { data: unpaidItems, error } = await supabase
    .from("billing_items")
    .select("id, target_month, category, title, amount, due_date, note")
    .eq("group_id", user.group_id)
    .eq("user_id", user.id)
    .eq("status", "unpaid")
    .gt("amount", 0)
    .order("target_month", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const items = (unpaidItems ?? []) as BillingItem[];

  if (items.length === 0) {
    redirect("/user/calendar");
  }

  const unpaidTotal = items.reduce((sum, item) => sum + item.amount, 0);

  const currentTuitionUnpaid = items.some(
    (item) => item.target_month === currentMonth && item.category === "tuition"
  );

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-md">
        <section className="rounded-lg bg-white p-6 shadow">
          <h1 className="text-2xl font-bold">未払い項目があります</h1>

          {currentTuitionUnpaid && (
            <p className="mt-4 rounded bg-red-100 p-3 font-bold text-red-700">
              今月の月謝が未払いです。
            </p>
          )}

          <div className="mt-5 rounded bg-red-50 p-4">
            <p className="text-sm text-red-700">未払い合計</p>
            <p className="mt-1 text-4xl font-bold text-red-700">
              {formatYen(unpaidTotal)}
            </p>
          </div>

          <div className="mt-6">
            <h2 className="font-bold">未払い内訳</h2>

            <div className="mt-3 space-y-3">
              {items.map((item) => (
                <div key={item.id} className="rounded border bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{item.title}</p>
                      <p className="mt-1 text-sm text-gray-600">
                        {formatTargetMonth(item.target_month)} /{" "}
                        {categoryLabel(item.category)}
                      </p>

                      {item.due_date && (
                        <p className="mt-1 text-sm text-gray-600">
                          期限：{item.due_date}
                        </p>
                      )}
                    </div>

                    <p className="font-bold text-red-700">
                      {formatYen(item.amount)}
                    </p>
                  </div>

                  {item.note && (
                    <p className="mt-3 rounded bg-gray-50 p-2 text-sm text-gray-700">
                      備考：{item.note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <a
            href="/user/calendar"
            className="mt-6 block rounded bg-black px-4 py-3 text-center font-bold text-white"
          >
            確認してカレンダーへ進む
          </a>

          <p className="mt-4 text-sm text-gray-600">
            支払い済みの場合は、管理者側の確認後に表示が更新されます。
          </p>
        </section>
      </div>
    </main>
  );
}