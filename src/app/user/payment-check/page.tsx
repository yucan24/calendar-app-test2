import LogoutButton from "@/components/LogoutButton";
import PageHeader from "@/components/ui/PageHeader";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMenuPath } from "@/lib/navigation";
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
  status: string;
  note: string | null;
  paid_at?: string | null;
};

const REFUND_TITLE = "返金";

function isRefundItem(item: BillingItem) {
  return item.title === REFUND_TITLE;
}

function categoryLabel(category: string) {
  if (category === "tuition") return "月謝";
  if (category === "trip") return "遠征費";
  if (category === "event") return "大会・イベント費";
  if (category === "uniform") return "ユニフォーム代";
  return "その他";
}

function itemLabel(item: BillingItem) {
  if (isRefundItem(item)) return REFUND_TITLE;
  return categoryLabel(item.category);
}

function getRecentTargetMonths(currentMonth: string, count: number) {
  const [year, month] = currentMonth.split("-").map(Number);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(year, month - 1 - index, 1);
    const targetYear = date.getFullYear();
    const targetMonth = String(date.getMonth() + 1).padStart(2, "0");

    return `${targetYear}-${targetMonth}`;
  });
}

function historyStatusLabel(item: BillingItem) {
  if (isRefundItem(item)) {
    if (item.status === "paid") return "清算済み";
    if (item.status === "exempt") return "清算不要";
  }

  if (item.status === "paid") return "支払い済み";
  if (item.status === "exempt") return "免除";
  return "未確認";
}

function historyStatusClass(item: BillingItem) {
  if (isRefundItem(item)) {
    if (item.status === "paid") return "bg-blue-100 text-blue-800";
    return "bg-gray-200 text-gray-800";
  }

  if (item.status === "paid") return "bg-green-100 text-green-800";
  return "bg-gray-200 text-gray-800";
}

export default async function UserPaymentCheckPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const currentMonth = getCurrentTargetMonth();
  const recentTargetMonths = getRecentTargetMonths(currentMonth, 3);

  const { data: unpaidItems, error } = await supabase
    .from("billing_items")
    .select("id, target_month, category, title, amount, status, note")
    .eq("group_id", user.group_id)
    .eq("user_id", user.id)
    .eq("status", "unpaid")
    .gt("amount", 0)
    .order("target_month", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const { data: historyItems, error: historyError } = await supabase
    .from("billing_items")
    .select("id, target_month, category, title, amount, status, note, paid_at")
    .eq("group_id", user.group_id)
    .eq("user_id", user.id)
    .in("status", ["paid", "exempt"])
    .in("target_month", recentTargetMonths)
    .order("target_month", { ascending: false })
    .order("paid_at", { ascending: false });

  if (historyError) {
    throw new Error(historyError.message);
  }

  const items = (unpaidItems ?? []) as BillingItem[];
  const histories = (historyItems ?? []) as BillingItem[];
  const paymentItems = items.filter((item) => !isRefundItem(item));
  const refundItems = items.filter((item) => isRefundItem(item));

  const unpaidTotal = paymentItems.reduce((sum, item) => sum + item.amount, 0);
  const refundTotal = refundItems.reduce((sum, item) => sum + item.amount, 0);

  const currentTuitionUnpaid = paymentItems.some(
    (item) => item.target_month === currentMonth && item.category === "tuition"
  );

  return (
    <main className="ui-page">

      <div className="mx-auto max-w-md">
        <PageHeader title="支払い確認" backHref={getMenuPath(user.role)} actions={<><Link href="/account" className="ui-button ui-button-secondary">アカウント設定</Link><LogoutButton /></>} />
        <section className="ui-card">
          <h2 className="ui-section-title text-gray-900">
            {items.length > 0
              ? "確認が必要な項目があります"
              : "未払い・未清算項目はありません"}
          </h2>

          {items.length === 0 && (
            <p className="mt-4 rounded bg-green-50 p-4 font-bold text-green-800">
              現在確認が必要な支払い・返金項目はありません。
            </p>
          )}

          {currentTuitionUnpaid && (
            <p className="mt-4 rounded bg-red-100 p-3 font-bold text-red-700">
              今月の月謝が未払いです。
            </p>
          )}

          <div className="mt-5 grid gap-3">
            {paymentItems.length > 0 && (
              <div className="rounded bg-red-50 p-4">
                <p className="text-sm font-bold text-red-700">未払い合計</p>
                <p className="mt-1 text-4xl font-bold text-red-700">
                  {formatYen(unpaidTotal)}
                </p>
              </div>
            )}

            {refundItems.length > 0 && (
              <div className="rounded bg-blue-50 p-4">
                <p className="text-sm font-bold text-blue-700">
                  未清算返金合計
                </p>
                <p className="mt-1 text-4xl font-bold text-blue-700">
                  {formatYen(refundTotal)}
                </p>
                <p className="mt-2 text-sm font-bold text-blue-800">
                  皆様へ振込予定の金額です。
                </p>
              </div>
            )}
          </div>

          {paymentItems.length > 0 && (
            <div className="mt-6">
              <h2 className="ui-section-title text-gray-900">未払い内訳</h2>

              <div className="mt-3 space-y-3">
                {paymentItems.map((item) => (
                  <div key={item.id} className="rounded border bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-gray-900">
                          {itemLabel(item)}
                        </p>
                        <p className="mt-1 text-sm font-medium text-gray-700">
                          {formatTargetMonth(item.target_month)}
                        </p>
                      </div>

                      <p className="font-bold text-red-700">
                        {formatYen(item.amount)}
                      </p>
                    </div>

                    {item.note && (
                      <p className="mt-3 rounded bg-gray-50 p-2 text-sm font-medium text-gray-800">
                        備考：{item.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {refundItems.length > 0 && (
            <div className="mt-6">
              <h2 className="ui-section-title text-gray-900">未清算返金内訳</h2>

              <div className="mt-3 space-y-3">
                {refundItems.map((item) => (
                  <div key={item.id} className="rounded border bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-gray-900">
                          {itemLabel(item)}
                        </p>
                        <p className="mt-1 text-sm font-medium text-gray-700">
                          {formatTargetMonth(item.target_month)}
                        </p>
                      </div>

                      <p className="font-bold text-blue-700">
                        {formatYen(item.amount)}
                      </p>
                    </div>

                    {item.note && (
                      <p className="mt-3 rounded bg-gray-50 p-2 text-sm font-medium text-gray-800">
                        備考：{item.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <Link
            href={isAdmin ? "/admin" : "/user/calendar"}
            className="ui-button ui-button-primary mt-6 block text-center"
          >
            {isAdmin ? "確認して管理者画面へ進む" : "確認してカレンダーへ進む"}
          </Link>

          <p className="mt-4 text-sm font-medium text-gray-700">
            支払い済みの場合は、管理者側の確認後に表示が更新されます。
          </p>
        </section>

        <section id="payment-history" className="ui-card mt-5">
          <h2 className="ui-section-title text-gray-900">
            直近3ヶ月の支払い・返金履歴
          </h2>

          {histories.length === 0 ? (
            <p className="mt-3 rounded bg-gray-50 p-3 text-sm font-medium text-gray-700">
              直近3ヶ月の履歴はありません。
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {histories.map((item) => (
                <div key={item.id} className="rounded border bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded px-2 py-1 text-xs font-bold ${historyStatusClass(
                            item
                          )}`}
                        >
                          {historyStatusLabel(item)}
                        </span>

                        <span
                          className={
                            isRefundItem(item)
                              ? "rounded bg-blue-50 px-2 py-1 text-xs font-bold text-blue-800"
                              : "rounded bg-gray-100 px-2 py-1 text-xs font-bold text-gray-800"
                          }
                        >
                          {itemLabel(item)}
                        </span>
                      </div>

                      <p className="mt-2 text-sm font-medium text-gray-700">
                        {formatTargetMonth(item.target_month)}
                      </p>
                    </div>

                    <p
                      className={
                        isRefundItem(item)
                          ? "font-bold text-blue-700"
                          : "font-bold text-gray-900"
                      }
                    >
                      {formatYen(item.amount)}
                    </p>
                  </div>

                  {item.note && (
                    <p className="mt-3 rounded bg-gray-50 p-2 text-sm font-medium text-gray-800">
                      備考：{item.note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
