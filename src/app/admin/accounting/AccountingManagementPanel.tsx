import type { ReactNode } from "react";
import SubmitButton from "@/components/SubmitButton";
import {
  COACH_HOURLY_RATE,
  expenseCategoryLabel,
  incomeCategoryLabel,
  type AccountingCoach,
  type AccountingExpenseItem,
  type AccountingIncomeItem,
  type AccountingReportTotals,
  type AccountingRewardAdjustment,
} from "@/lib/accounting";
import { formatYen } from "@/lib/month";
import AccountingSectionTabs from "./AccountingSectionTabs";
import ExpenseItemDeleteForm from "./ExpenseItemDeleteForm";
import IncomeItemDeleteForm from "./IncomeItemDeleteForm";
import RewardAdjustmentDeleteForm from "./RewardAdjustmentDeleteForm";
import {
  createCoachRewardAdjustment,
  updateAccountingExpenseItem,
  updateAccountingIncomeItem,
  updateCoachHourlyRate,
  updateCoachRewardAdjustment,
} from "./actions";

type Props = {
  coachList: AccountingCoach[];
  rewardAdjustmentList: AccountingRewardAdjustment[];
  incomeList: AccountingIncomeItem[];
  expenseList: AccountingExpenseItem[];
  monthStart: string;
  totals: AccountingReportTotals;
  aliasesPanel: ReactNode;
  incomeBankTransactionByItemId: Record<string, string>;
  expenseBankTransactionByItemId: Record<string, string>;
};

const fieldClass =
  "mt-1 block w-full min-w-0 max-w-full box-border rounded border border-gray-400 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500";

const summaryClass =
  "flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-bold text-gray-900 [&::-webkit-details-marker]:hidden";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function formatDateRange(item: AccountingRewardAdjustment) {
  const end = item.ends_on ? formatDate(item.ends_on) : "終了日なし";

  return `${formatDate(item.starts_on)} 〜 ${end}`;
}

function AddPanel({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: ReactNode;
}) {
  return (
    <details className="group border-b border-gray-200 last:border-b-0 lg:border-r lg:last:border-r-0">
      <summary className={summaryClass}>
        <span>{title}</span>
        <span className="flex items-center gap-3 text-sm text-gray-600">
          <span>{meta}</span>
          <span className="text-xl leading-none group-open:hidden">+</span>
          <span className="hidden text-xl leading-none group-open:inline">
            -
          </span>
        </span>
      </summary>
      <div className="border-t border-gray-200 px-4 pb-4 pt-1">
        {children}
      </div>
    </details>
  );
}

export default function AccountingManagementPanel({
  coachList,
  rewardAdjustmentList,
  incomeList,
  expenseList,
  monthStart,
  totals,
  aliasesPanel,
  incomeBankTransactionByItemId,
  expenseBankTransactionByItemId,
}: Props) {
  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-gray-300 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-gray-300 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-bold text-gray-900">報酬調整</h2>
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded bg-gray-100 px-2 py-1 text-gray-800">
              報酬調整 {rewardAdjustmentList.length}件
            </span>
          </div>
        </div>

        <div>
          <AddPanel title="報酬調整を追加" meta="時給カット">
            <form
              action={createCoachRewardAdjustment}
              className="mt-3 grid min-w-0 gap-3"
            >
              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  指導者
                </label>
                <select name="coach_id" required className={fieldClass}>
                  <option value="">選択</option>
                  {coachList.map((coach) => (
                    <option key={coach.id} value={coach.id}>
                      {coach.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="min-w-0">
                  <label className="block text-sm font-bold text-gray-900">
                    開始日
                  </label>
                  <input
                    name="starts_on"
                    type="date"
                    defaultValue={monthStart}
                    className={fieldClass}
                  />
                </div>

                <div className="min-w-0">
                  <label className="block text-sm font-bold text-gray-900">
                    終了日
                  </label>
                  <input name="ends_on" type="date" className={fieldClass} />
                </div>
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  支給率[%]
                </label>
                <input
                  name="pay_rate_percent"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={50}
                  required
                  className={fieldClass}
                />
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-bold text-gray-900">
                  備考
                </label>
                <input name="note" className={fieldClass} />
              </div>

              <SubmitButton className="rounded bg-black px-4 py-3 font-bold text-white">
                追加
              </SubmitButton>
            </form>
          </AddPanel>
        </div>
      </section>

      <section className="rounded-lg border border-gray-300 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-gray-300 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-bold text-gray-900">設定・記録</h2>
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded bg-gray-100 px-2 py-1 text-gray-800">
              指導者 {coachList.length}名
            </span>
            <span className="rounded bg-red-50 px-2 py-1 text-red-800">
              報酬調整 {rewardAdjustmentList.length}件
            </span>
            <span className="rounded bg-green-50 px-2 py-1 text-green-800">
              入金 {incomeList.length}件
            </span>
            <span className="rounded bg-rose-50 px-2 py-1 text-rose-800">
              出費 {expenseList.length}件
            </span>
          </div>
        </div>

        <AccountingSectionTabs
          tabs={[
            {
              id: "rates",
              label: "時給",
              meta: `${coachList.length}名`,
            },
            {
              id: "adjustments",
              label: "報酬調整",
              meta: `${rewardAdjustmentList.length}件`,
            },
            {
              id: "transactions",
              label: "入出金",
              meta: `入金 ${incomeList.length}件 / 出費 ${expenseList.length}件`,
            },
            {
              id: "aliases",
              label: "口座名義",
              meta: "振込名義の設定",
            },
          ]}
          initialTabId={
            incomeList.length + expenseList.length > 0
              ? "transactions"
              : rewardAdjustmentList.length > 0
                ? "adjustments"
                : "rates"
          }
        >
          <section>
            <div className="mb-3 flex flex-col gap-1 border-b border-gray-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-bold text-gray-900">指導者の時給</h3>
              <p className="text-sm font-bold text-gray-700">
                未設定 {formatYen(COACH_HOURLY_RATE)} / 時間
              </p>
            </div>

            <div className="-mx-5 divide-y divide-gray-200">
            {coachList.map((coach) => {
              const coachAdjustments = rewardAdjustmentList.filter(
                (item) => item.coach_id === coach.id
              );

              return (
                <form
                  key={coach.id}
                  action={updateCoachHourlyRate}
                  className="grid min-w-0 gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_144px_72px] sm:items-center"
                >
                  <input type="hidden" name="coach_id" value={coach.id} />

                  <div className="min-w-0">
                    <p className="font-bold text-gray-900">{coach.name}</p>
                    {coachAdjustments.length > 0 && (
                      <p className="mt-1 truncate text-xs font-bold text-red-700">
                        調整 {coachAdjustments.length}件
                      </p>
                    )}
                  </div>

                  <div className="min-w-0">
                    <input
                      name="coach_hourly_rate"
                      type="number"
                      min={0}
                      required
                      aria-label={`${coach.name} の時給`}
                      defaultValue={coach.coach_hourly_rate ?? COACH_HOURLY_RATE}
                      className={`${fieldClass} text-right`}
                    />
                  </div>

                  <SubmitButton className="rounded bg-black px-3 py-2 font-bold text-white">
                    保存
                  </SubmitButton>
                </form>
              );
            })}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-gray-200 pb-3">
              <h3 className="font-bold text-gray-900">報酬調整</h3>
              <p className="text-sm font-bold text-red-700">
                {rewardAdjustmentList.length}件
              </p>
            </div>

          {rewardAdjustmentList.length === 0 ? (
            <p className="py-3 text-sm font-medium text-gray-700">
              この月に有効な報酬調整はありません。
            </p>
          ) : (
            <div className="-mx-5 divide-y divide-gray-200">
              {rewardAdjustmentList.map((item) => (
                <div key={item.id} className="px-5 py-4">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-gray-900">
                          {item.coach_name}
                        </p>
                        <span className="rounded bg-red-50 px-2 py-1 text-xs font-bold text-red-800">
                          支給率 {item.pay_rate_percent}%
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-gray-700">
                        {formatDateRange(item)}
                      </p>
                      {item.note && (
                        <p className="mt-1 text-sm font-medium text-gray-700">
                          備考：{item.note}
                        </p>
                      )}
                    </div>

                    <RewardAdjustmentDeleteForm adjustmentId={item.id} />
                  </div>

                  <details className="group mt-3 rounded border border-gray-200 bg-gray-50">
                    <summary className={summaryClass}>
                      <span>修正</span>
                      <span className="text-xl leading-none group-open:hidden">
                        +
                      </span>
                      <span className="hidden text-xl leading-none group-open:inline">
                        -
                      </span>
                    </summary>

                    <form
                      action={updateCoachRewardAdjustment}
                      className="grid min-w-0 gap-3 border-t border-gray-200 p-4 sm:grid-cols-2"
                    >
                      <input
                        type="hidden"
                        name="adjustment_id"
                        value={item.id}
                      />

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          指導者
                        </label>
                        <select
                          name="coach_id"
                          defaultValue={item.coach_id}
                          className={fieldClass}
                        >
                          {coachList.map((coach) => (
                            <option key={coach.id} value={coach.id}>
                              {coach.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          支給率[%]
                        </label>
                        <input
                          name="pay_rate_percent"
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={item.pay_rate_percent}
                          className={fieldClass}
                        />
                      </div>

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          開始日
                        </label>
                        <input
                          name="starts_on"
                          type="date"
                          defaultValue={item.starts_on}
                          className={fieldClass}
                        />
                      </div>

                      <div className="min-w-0">
                        <label className="block text-sm font-bold text-gray-900">
                          終了日
                        </label>
                        <input
                          name="ends_on"
                          type="date"
                          defaultValue={item.ends_on ?? ""}
                          className={fieldClass}
                        />
                      </div>

                      <div className="min-w-0 sm:col-span-2">
                        <label className="block text-sm font-bold text-gray-900">
                          備考
                        </label>
                        <input
                          name="note"
                          defaultValue={item.note ?? ""}
                          className={fieldClass}
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <SubmitButton className="w-full rounded bg-black px-4 py-3 font-bold text-white">
                          修正
                        </SubmitButton>
                      </div>
                    </form>
                  </details>
                </div>
              ))}
            </div>
          )}
          </section>

          <section>
          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <div className="flex items-center justify-between gap-3 border-b border-gray-200 pb-2">
                <h3 className="font-bold text-gray-900">協賛金・その他収入</h3>
                <p className="text-sm font-bold text-green-700">
                  {formatYen(totals.incomeItemsTotal)}
                </p>
              </div>

              {incomeList.length === 0 ? (
                <p className="py-4 text-sm font-medium text-gray-700">
                  この月の協賛金・その他収入はありません。
                </p>
              ) : (
                <div className="divide-y divide-gray-200">
                  {incomeList.map((item) => (
                    <div key={item.id} className="py-4">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-green-50 px-2 py-1 text-xs font-bold text-green-800">
                              {incomeCategoryLabel(item.category)}
                            </span>
                            <span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold text-gray-800">
                              {formatDate(item.received_on)}
                            </span>
                            <span className="rounded bg-blue-50 px-2 py-1 text-xs font-bold text-blue-800">
                              {incomeBankTransactionByItemId[item.id]
                                ? `銀行明細 ${incomeBankTransactionByItemId[item.id]}`
                                : "手入力"}
                            </span>
                          </div>
                          <p className="mt-2 font-bold text-gray-900">
                            {item.payer_name}
                          </p>
                          {item.note && (
                            <p className="mt-1 text-sm font-medium text-gray-700">
                              備考：{item.note}
                            </p>
                          )}
                        </div>

                        <div className="text-left sm:text-right">
                          <p className="font-bold text-green-700">
                            {formatYen(item.amount)}
                          </p>
                          {!incomeBankTransactionByItemId[item.id] && (
                            <div className="mt-2">
                              <IncomeItemDeleteForm itemId={item.id} />
                            </div>
                          )}
                        </div>
                      </div>

                      {incomeBankTransactionByItemId[item.id] ? (
                        <p className="mt-3 rounded bg-blue-50 p-3 text-sm font-medium text-blue-900">
                          銀行由来の項目です。修正する場合は「処理履歴」から紐付けを取り消してください。
                        </p>
                      ) : (
                      <details className="group mt-3 rounded border border-gray-200 bg-gray-50">
                        <summary className={summaryClass}>
                          <span>修正</span>
                          <span className="text-xl leading-none group-open:hidden">
                            +
                          </span>
                          <span className="hidden text-xl leading-none group-open:inline">
                            -
                          </span>
                        </summary>

                        <form
                          action={updateAccountingIncomeItem}
                          className="grid min-w-0 gap-3 border-t border-gray-200 p-4 sm:grid-cols-2"
                        >
                          <input type="hidden" name="item_id" value={item.id} />

                          <div className="min-w-0">
                            <label className="block text-sm font-bold text-gray-900">
                              受取日
                            </label>
                            <input
                              name="received_on"
                              type="date"
                              defaultValue={item.received_on}
                              className={fieldClass}
                            />
                          </div>

                          <div className="min-w-0">
                            <label className="block text-sm font-bold text-gray-900">
                              種別
                            </label>
                            <select
                              name="category"
                              defaultValue={item.category}
                              className={fieldClass}
                            >
                              <option value="sponsorship">協賛金</option>
                              <option value="other">その他収入</option>
                            </select>
                          </div>

                          <div className="min-w-0">
                            <label className="block text-sm font-bold text-gray-900">
                              支払者
                            </label>
                            <input
                              name="payer_name"
                              defaultValue={item.payer_name}
                              required
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
                              defaultValue={item.amount}
                              className={fieldClass}
                            />
                          </div>

                          <div className="min-w-0 sm:col-span-2">
                            <label className="block text-sm font-bold text-gray-900">
                              備考
                            </label>
                            <input
                              name="note"
                              defaultValue={item.note ?? ""}
                              className={fieldClass}
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <SubmitButton className="w-full rounded bg-black px-4 py-3 font-bold text-white">
                              修正
                            </SubmitButton>
                          </div>
                        </form>
                      </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between gap-3 border-b border-gray-200 pb-2">
                <h3 className="font-bold text-gray-900">その他出費</h3>
                <p className="text-sm font-bold text-rose-700">
                  {formatYen(totals.expenseItemsTotal)}
                </p>
              </div>

              {expenseList.length === 0 ? (
                <p className="py-4 text-sm font-medium text-gray-700">
                  この月のその他出費はありません。
                </p>
              ) : (
                <div className="divide-y divide-gray-200">
                  {expenseList.map((item) => (
                    <div key={item.id} className="py-4">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-rose-50 px-2 py-1 text-xs font-bold text-rose-800">
                              {expenseCategoryLabel(item.category)}
                            </span>
                            <span className="rounded bg-gray-100 px-2 py-1 text-xs font-bold text-gray-800">
                              {formatDate(item.spent_on)}
                            </span>
                            <span className="rounded bg-blue-50 px-2 py-1 text-xs font-bold text-blue-800">
                              {expenseBankTransactionByItemId[item.id]
                                ? `銀行明細 ${expenseBankTransactionByItemId[item.id]}`
                                : "手入力"}
                            </span>
                          </div>
                          <p className="mt-2 font-bold text-gray-900">
                            {item.payee_name}
                          </p>
                          {item.note && (
                            <p className="mt-1 text-sm font-medium text-gray-700">
                              備考：{item.note}
                            </p>
                          )}
                        </div>

                        <div className="text-left sm:text-right">
                          <p className="font-bold text-rose-700">
                            {formatYen(item.amount)}
                          </p>
                          {!expenseBankTransactionByItemId[item.id] && (
                            <div className="mt-2">
                              <ExpenseItemDeleteForm itemId={item.id} />
                            </div>
                          )}
                        </div>
                      </div>

                      {expenseBankTransactionByItemId[item.id] ? (
                        <p className="mt-3 rounded bg-blue-50 p-3 text-sm font-medium text-blue-900">
                          銀行由来の項目です。修正する場合は「処理履歴」から紐付けを取り消してください。
                        </p>
                      ) : (
                      <details className="group mt-3 rounded border border-gray-200 bg-gray-50">
                        <summary className={summaryClass}>
                          <span>修正</span>
                          <span className="text-xl leading-none group-open:hidden">
                            +
                          </span>
                          <span className="hidden text-xl leading-none group-open:inline">
                            -
                          </span>
                        </summary>

                        <form
                          action={updateAccountingExpenseItem}
                          className="grid min-w-0 gap-3 border-t border-gray-200 p-4 sm:grid-cols-2"
                        >
                          <input type="hidden" name="item_id" value={item.id} />

                          <div className="min-w-0">
                            <label className="block text-sm font-bold text-gray-900">
                              支払日
                            </label>
                            <input
                              name="spent_on"
                              type="date"
                              defaultValue={item.spent_on}
                              className={fieldClass}
                            />
                          </div>

                          <div className="min-w-0">
                            <label className="block text-sm font-bold text-gray-900">
                              種別
                            </label>
                            <select
                              name="category"
                              defaultValue={item.category}
                              className={fieldClass}
                            >
                              <option value="event">大会・イベント費</option>
                              <option value="fee">手数料</option>
                              <option value="other">その他出費</option>
                            </select>
                          </div>

                          <div className="min-w-0">
                            <label className="block text-sm font-bold text-gray-900">
                              支払先
                            </label>
                            <input
                              name="payee_name"
                              defaultValue={item.payee_name}
                              required
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
                              defaultValue={item.amount}
                              className={fieldClass}
                            />
                          </div>

                          <div className="min-w-0 sm:col-span-2">
                            <label className="block text-sm font-bold text-gray-900">
                              備考
                            </label>
                            <input
                              name="note"
                              defaultValue={item.note ?? ""}
                              className={fieldClass}
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <SubmitButton className="w-full rounded bg-black px-4 py-3 font-bold text-white">
                              修正
                            </SubmitButton>
                          </div>
                        </form>
                      </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          </section>

          <section>{aliasesPanel}</section>
        </AccountingSectionTabs>
      </section>
    </div>
  );
}
