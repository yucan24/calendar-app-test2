import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import SubmitButton from "@/components/SubmitButton";

import {
  createBillingItem,
  createTuitionForAllUsers,
  updateBillingItem,
  updateBillingItemStatus,
} from "./actions";
import {
  formatTargetMonth,
  formatYen,
  getCurrentTargetMonth,
  isValidTargetMonth,
} from "@/lib/month";

type PageProps = {
  searchParams?: Promise<{
    month?: string;
  }>;
};

type Profile = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
};

type BillingItem = {
  id: string;
  user_id: string;
  target_month: string;
  category: string;
  title: string;
  amount: number;
  status: string;
  note: string | null;
  paid_at: string | null;
};

const fieldClass =
  "mt-1 block w-full min-w-0 max-w-full box-border rounded border border-gray-400 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500";

function categoryLabel(category: string) {
  if (category === "tuition") return "月謝";
  if (category === "trip") return "遠征費";
  if (category === "event") return "大会・イベント費";
  if (category === "uniform") return "ユニフォーム代";
  return "その他";
}

function statusLabel(status: string) {
  if (status === "paid") return "支払い済み";
  if (status === "exempt") return "免除";
  return "未払い";
}

function statusClass(status: string) {
  if (status === "paid") return "bg-green-100 text-green-800";
  if (status === "exempt") return "bg-gray-200 text-gray-800";
  return "bg-red-100 text-red-800";
}

function buildReminderMailto(unpaidUsers: Profile[]) {
  const emails = unpaidUsers
    .map((user) => user.email)
    .filter(Boolean)
    .join(",");

  const subject = "未払い項目のご確認";
  const body = [
    "未払い項目があります。",
    "",
    "アプリにログインし、未払い金額と内訳をご確認ください。",
    "",
    "行き違いでお支払い済みの場合はご容赦ください。",
  ].join("\n");

  return `mailto:?bcc=${encodeURIComponent(emails)}&subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const admin = await requireAdmin();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const currentMonth = getCurrentTargetMonth();

  const targetMonth =
    resolvedSearchParams?.month && isValidTargetMonth(resolvedSearchParams.month)
      ? resolvedSearchParams.month
      : currentMonth;

  const { data: users, error: usersError } = await supabase
    .from("profiles")
    .select("id, name, email, role")
    .eq("group_id", admin.group_id)
    .eq("role", "user")
    .eq("login_enabled", true)
    .order("name", { ascending: true });

  if (usersError) {
    throw new Error(usersError.message);
  }

  const userList = (users ?? []) as Profile[];
  const userIds = userList.map((user) => user.id);

  const { data: billingItems, error: billingError } =
    userIds.length > 0
      ? await supabase
          .from("billing_items")
          .select(
            "id, user_id, target_month, category, title, amount, status, note, paid_at"
          )
          .eq("group_id", admin.group_id)
          .in("user_id", userIds)
          .order("target_month", { ascending: false })
          .order("created_at", { ascending: false })
      : { data: [], error: null };

  if (billingError) {
    throw new Error(billingError.message);
  }

  const itemList = (billingItems ?? []) as BillingItem[];

  const itemsByUser = new Map<string, BillingItem[]>();

  for (const user of userList) {
    itemsByUser.set(user.id, []);
  }

  for (const item of itemList) {
    const list = itemsByUser.get(item.user_id) ?? [];
    list.push(item);
    itemsByUser.set(item.user_id, list);
  }

  const unpaidUsers = userList.filter((user) => {
    const items = itemsByUser.get(user.id) ?? [];
    return items.some((item) => item.status === "unpaid" && item.amount > 0);
  });

  const reminderHref = buildReminderMailto(unpaidUsers);

  return (
    <main className="min-h-screen bg-gray-50 p-4 text-gray-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              ユーザー・請求管理
            </h1>
            <p className="mt-2 text-sm font-medium text-gray-700">
              月謝、遠征費、その他費用の未払い状況を管理します。
            </p>
          </div>

          <div className="flex gap-2">
            <a
              href="/admin"
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
            >
              管理者画面に戻る
            </a>
            <a
              href="/logout"
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900"
            >
              ログアウト
            </a>
          </div>
        </div>

        <section className="mt-6 rounded-lg bg-white p-5 shadow">
          <details>
            <summary className="cursor-pointer text-lg font-bold text-gray-900">
              月謝を一括請求
            </summary>

            <p className="mt-3 text-sm font-medium text-gray-700">
              対象月に月謝がまだ登録されていないユーザーへ、一括で月謝を入力します。
            </p>

            <form
              action={createTuitionForAllUsers}
              className="mt-4 grid min-w-0 gap-3 sm:grid-cols-3"
            >
              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  対象月
                </label>
                <input
                  name="target_month"
                  type="month"
                  defaultValue={targetMonth}
                  className={fieldClass}
                />
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  金額
                </label>
                <input
                  name="amount"
                  type="number"
                  min={0}
                  required
                  placeholder="5000"
                  className={fieldClass}
                />
              </div>

              <div className="flex min-w-0 items-end">
                <Submitbutton
                  pendingText="一括作成中..."
                  className="w-full rounded bg-black px-4 py-3 font-bold text-white">
                >
                  一括作成
                </Submitbutton>
              </div>

              <div className="min-w-0 sm:col-span-3">
                <label className="block text-sm font-bold text-gray-900">
                  備考
                </label>
                <input
                  name="note"
                  className={fieldClass}
                  placeholder="例：6月分月謝"
                />
              </div>
            </form>
          </details>
        </section>

        <section className="mt-6 rounded-lg bg-white p-5 shadow">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                未払い者への督促
              </h2>
              <p className="mt-1 text-sm font-medium text-gray-700">
                未払いがあるユーザー：{unpaidUsers.length}名
              </p>
            </div>

            {unpaidUsers.length > 0 ? (
              <a
                href={reminderHref}
                className="rounded bg-orange-500 px-4 py-3 text-center font-bold text-white"
              >
                未払い者にまとめて督促メール
              </a>
            ) : (
              <button
                disabled
                className="rounded bg-gray-200 px-4 py-3 font-bold text-gray-600"
              >
                未払い者なし
              </button>
            )}
          </div>
        </section>

        <section className="mt-6 space-y-4">
          {userList.map((user) => {
            const items = itemsByUser.get(user.id) ?? [];
            const unpaidItems = items.filter((item) => item.status === "unpaid");
            const unpaidTotal = unpaidItems.reduce(
              (sum, item) => sum + item.amount,
              0
            );

            const currentTuition = items.find(
              (item) =>
                item.target_month === currentMonth &&
                item.category === "tuition"
            );

            const targetMonthItems = items.filter(
              (item) => item.target_month === targetMonth
            );

            return (
              <article key={user.id} className="rounded-lg bg-white p-5 shadow">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">
                      {user.name}
                    </h2>
                    <p className="mt-1 text-sm font-medium text-gray-700">
                      {user.email}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {currentTuition?.status === "unpaid" && (
                        <span className="rounded bg-red-100 px-3 py-1 text-sm font-bold text-red-700">
                          今月月謝未払い
                        </span>
                      )}

                      {!currentTuition && (
                        <span className="rounded bg-gray-200 px-3 py-1 text-sm font-bold text-gray-800">
                          今月月謝未登録
                        </span>
                      )}

                      {currentTuition?.status === "paid" && (
                        <span className="rounded bg-green-100 px-3 py-1 text-sm font-bold text-green-700">
                          今月月謝支払い済み
                        </span>
                      )}

                      {currentTuition?.status === "exempt" && (
                        <span className="rounded bg-gray-200 px-3 py-1 text-sm font-bold text-gray-800">
                          今月月謝免除
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rounded bg-red-50 px-4 py-3 text-right">
                    <p className="text-sm font-bold text-red-700">
                      未払い合計
                    </p>
                    <p className="text-2xl font-bold text-red-700">
                      {formatYen(unpaidTotal)}
                    </p>
                  </div>
                </div>

                <details className="mt-5 rounded border border-gray-300 bg-gray-50 p-4">
                  <summary className="cursor-pointer font-bold text-gray-900">
                    請求項目を管理
                  </summary>

                  <div className="mt-4 rounded bg-white p-4">
                    <h3 className="font-bold text-gray-900">請求項目を追加</h3>

                    <form
                      action={createBillingItem}
                      className="mt-3 grid min-w-0 gap-3 sm:grid-cols-4"
                    >
                      <input type="hidden" name="user_id" value={user.id} />

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          対象月
                        </label>
                        <input
                          name="target_month"
                          type="month"
                          defaultValue={targetMonth}
                          className={fieldClass}
                        />
                      </div>

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          費目
                        </label>
                        <select
                          name="category"
                          defaultValue="other"
                          className={fieldClass}
                        >
                          <option value="tuition">月謝</option>
                          <option value="trip">遠征費</option>
                          <option value="event">大会・イベント費</option>
                          <option value="uniform">ユニフォーム代</option>
                          <option value="other">その他</option>
                        </select>
                      </div>

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          金額
                        </label>
                        <input
                          name="amount"
                          type="number"
                          min={0}
                          required
                          className={fieldClass}
                        />
                      </div>

                      <div className="flex min-w-0 items-end">
                        <SubmitButton 
                          pendingText="追加中・・・"
                          className="w-full rounded bg-black px-4 py-3 font-bold text-white">
                        >
                          追加
                        </SubmitButton>
                      </div>

                      <div className="min-w-0 sm:col-span-4">
                        <label className="block text-sm font-bold text-gray-900">
                          備考
                        </label>
                        <input
                          name="note"
                          className={fieldClass}
                          placeholder="例：○○大会交通費、宿泊費込み"
                        />
                      </div>
                    </form>
                  </div>

                  <div className="mt-4">
                    <h3 className="font-bold text-gray-900">
                      {formatTargetMonth(targetMonth)} の請求項目
                    </h3>

                    {targetMonthItems.length === 0 ? (
                      <p className="mt-2 rounded bg-white p-3 text-sm font-medium text-gray-700">
                        この月の請求項目はありません。
                      </p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {targetMonthItems.map((item) => (
                          <div
                            key={item.id}
                            className="rounded border border-gray-300 bg-white p-4"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`rounded px-2 py-1 text-xs font-bold ${statusClass(
                                      item.status
                                    )}`}
                                  >
                                    {statusLabel(item.status)}
                                  </span>

                                  <span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold text-gray-800">
                                    {categoryLabel(item.category)}
                                  </span>
                                </div>

                                <p className="mt-2 text-lg font-bold text-gray-900">
                                  {categoryLabel(item.category)}
                                </p>

                                <p className="mt-1 text-sm font-medium text-gray-700">
                                  金額：{formatYen(item.amount)}
                                </p>

                                {item.note && (
                                  <p className="mt-2 rounded bg-gray-50 p-2 text-sm font-medium text-gray-800">
                                    備考：{item.note}
                                  </p>
                                )}
                              </div>

                              <div className="grid grid-cols-3 gap-2 sm:w-72">
                                <form action={updateBillingItemStatus}>
                                  <input
                                    type="hidden"
                                    name="item_id"
                                    value={item.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="status"
                                    value="paid"
                                  />
                                  <button className="w-full rounded bg-green-600 px-3 py-2 text-sm font-bold text-white">
                                    済
                                  </button>
                                </form>

                                <form action={updateBillingItemStatus}>
                                  <input
                                    type="hidden"
                                    name="item_id"
                                    value={item.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="status"
                                    value="unpaid"
                                  />
                                  <button className="w-full rounded bg-red-600 px-3 py-2 text-sm font-bold text-white">
                                    未
                                  </button>
                                </form>

                                <form action={updateBillingItemStatus}>
                                  <input
                                    type="hidden"
                                    name="item_id"
                                    value={item.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="status"
                                    value="exempt"
                                  />
                                  <button className="w-full rounded bg-gray-700 px-3 py-2 text-sm font-bold text-white">
                                    免除
                                  </button>
                                </form>
                              </div>
                            </div>

                            <details className="mt-4 rounded bg-gray-50 p-3">
                              <summary className="cursor-pointer font-bold text-gray-900">
                                請求内容を修正
                              </summary>

                              <form
                                action={updateBillingItem}
                                className="mt-3 grid min-w-0 gap-3 sm:grid-cols-4"
                              >
                                <input
                                  type="hidden"
                                  name="item_id"
                                  value={item.id}
                                />

                                <div className="min-w-0">
                                  <label className="block text-sm font-bold text-gray-900">
                                    対象月
                                  </label>
                                  <input
                                    name="target_month"
                                    type="month"
                                    defaultValue={item.target_month}
                                    className={fieldClass}
                                  />
                                </div>

                                <div className="min-w-0">
                                  <label className="block text-sm font-bold text-gray-900">
                                    費目
                                  </label>
                                  <select
                                    name="category"
                                    defaultValue={item.category}
                                    className={fieldClass}
                                  >
                                    <option value="tuition">月謝</option>
                                    <option value="trip">遠征費</option>
                                    <option value="event">
                                      大会・イベント費
                                    </option>
                                    <option value="uniform">
                                      ユニフォーム代
                                    </option>
                                    <option value="other">その他</option>
                                  </select>
                                </div>

                                <div className="min-w-0">
                                  <label className="block text-sm font-bold text-gray-900">
                                    金額
                                  </label>
                                  <input
                                    name="amount"
                                    type="number"
                                    min={0}
                                    defaultValue={item.amount}
                                    className={fieldClass}
                                  />
                                </div>

                                <div className="flex min-w-0 items-end">
                                  <button className="w-full rounded bg-black px-4 py-3 font-bold text-white">
                                    修正
                                  </button>
                                </div>

                                <div className="min-w-0 sm:col-span-4">
                                  <label className="block text-sm font-bold text-gray-900">
                                    備考
                                  </label>
                                  <input
                                    name="note"
                                    defaultValue={item.note ?? ""}
                                    className={fieldClass}
                                  />
                                </div>
                              </form>
                            </details>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {unpaidItems.length > 0 && (
                    <div className="mt-5">
                      <h3 className="font-bold text-red-700">未払い内訳</h3>

                      <div className="mt-2 space-y-2">
                        {unpaidItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex justify-between gap-3 rounded bg-red-50 px-3 py-2 text-sm"
                          >
                            <span className="font-medium text-gray-900">
                              {formatTargetMonth(item.target_month)}{" "}
                              {categoryLabel(item.category)}
                            </span>
                            <span className="font-bold text-red-700">
                              {formatYen(item.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </details>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
