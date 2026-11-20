"use client";

import { useMemo, useState } from "react";
import SubmitButton from "@/components/SubmitButton";
import {
  buildMatchCandidates,
  getBankDirection,
  getBankTransactionAmount,
  inferProfileCandidates,
  inferTransactionPurpose,
  type ProfilePaymentAliasLike,
} from "@/lib/bankReconciliation";
import { formatTargetMonth, formatYen } from "@/lib/month";
import {
  ignoreBankTransaction,
  matchTransactionManually,
  matchTransactionToBillingItems,
  matchTransactionToCoachNetPay,
  matchTransactionToExistingAccountingItem,
  matchTransactionToExpenseItem,
  matchTransactionToIncomeItem,
  matchTransactionToTaxPayment,
} from "./actions";
import type {
  BankProfile,
  BankTransaction,
  CoachPaymentCandidate,
  ExistingAccountingItem,
  PaymentAlias,
  ReconciliationBillingItem,
} from "./types";

type Props = {
  transactions: BankTransaction[];
  users: BankProfile[];
  aliases: PaymentAlias[];
  billingItems: ReconciliationBillingItem[];
  existingAccountingItems: ExistingAccountingItem[];
  coachPayments: CoachPaymentCandidate[];
  taxPaymentAmount: number;
  taxPaidAmount: number;
  targetMonth: string;
};

type TransactionActionMode =
  | "billing"
  | "existing"
  | "income"
  | "expense"
  | "coach"
  | "tax"
  | "manual"
  | "ignore";

const fieldClass =
  "mt-1 block w-full rounded border border-gray-400 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function billingLabel(item: ReconciliationBillingItem) {
  if (item.title === "返金") return "返金";
  return item.title || item.category;
}

function confidenceBadge(confidence: "high" | "review" | "unknown") {
  if (confidence === "high") {
    return {
      label: "高信頼",
      className: "bg-green-100 text-green-800",
    };
  }

  if (confidence === "review") {
    return {
      label: "要確認",
      className: "bg-amber-100 text-amber-800",
    };
  }

  return {
    label: "未判定",
    className: "bg-gray-200 text-gray-700",
  };
}

function TransactionCard({
  transaction,
  users,
  aliases,
  billingItems,
  existingAccountingItems,
  coachPayments,
  taxPaymentAmount,
  taxPaidAmount,
  targetMonth,
}: Omit<Props, "transactions"> & { transaction: BankTransaction }) {
  const direction = getBankDirection(transaction);
  const amount = getBankTransactionAmount(transaction);
  const aliasInput: ProfilePaymentAliasLike[] = aliases.map((alias) => ({
    profileId: alias.profileId,
    profileName: alias.profileName,
    aliasName: alias.aliasName,
    normalizedAliasName: alias.normalizedAliasName,
  }));
  const profileCandidates = inferProfileCandidates(transaction, aliasInput);
  const purposeCandidates = inferTransactionPurpose(transaction.description);
  const matchCandidates = buildMatchCandidates({
    transaction,
    aliases: aliasInput,
    billingItems,
  });
  const compatibleExistingItems = existingAccountingItems
    .filter(
      (item) =>
        item.itemType === (direction === "deposit" ? "income" : "expense")
    )
    .sort((left, right) => {
      const leftExact =
        left.amount === amount && left.transactedOn === transaction.transactedOn
          ? 1
          : 0;
      const rightExact =
        right.amount === amount &&
        right.transactedOn === transaction.transactedOn
          ? 1
          : 0;
      const leftAmountMatch = left.amount === amount ? 1 : 0;
      const rightAmountMatch = right.amount === amount ? 1 : 0;

      return (
        rightExact - leftExact ||
        rightAmountMatch - leftAmountMatch ||
        right.transactedOn.localeCompare(left.transactedOn)
      );
    });
  const exactExistingItems = compatibleExistingItems.filter(
    (item) =>
      item.amount === amount && item.transactedOn === transaction.transactedOn
  );
  const initialUserId =
    profileCandidates[0]?.profileId ?? matchCandidates[0]?.userId ?? "";
  const [selectedUserId, setSelectedUserId] = useState(initialUserId);
  const [selectedBillingIds, setSelectedBillingIds] = useState<string[]>([]);
  const [selectedExistingItemId, setSelectedExistingItemId] = useState(
    exactExistingItems[0]?.itemId ?? compatibleExistingItems[0]?.itemId ?? ""
  );
  const selectedExistingItem = compatibleExistingItems.find(
    (item) => item.itemId === selectedExistingItemId
  );
  const compatibleBillingItems = billingItems.filter((item) => {
    const isRefund = item.title === "返金";
    return (
      item.userId === selectedUserId &&
      item.status === "unpaid" &&
      item.amount > 0 &&
      (direction === "deposit" ? !isRefund : isRefund)
    );
  });
  const selectedTotal = compatibleBillingItems
    .filter((item) => selectedBillingIds.includes(item.id))
    .reduce((sum, item) => sum + item.amount, 0);
  const availableCoachPayments = [...coachPayments].sort((left, right) => {
    const leftExact = left.remainingAmount === amount ? 1 : 0;
    const rightExact = right.remainingAmount === amount ? 1 : 0;
    return rightExact - leftExact || left.coachName.localeCompare(right.coachName, "ja");
  });
  const [selectedCoachId, setSelectedCoachId] = useState(availableCoachPayments[0]?.coachId ?? "");
  const selectedCoach = availableCoachPayments.find((payment) => payment.coachId === selectedCoachId);
  const taxRemainingAmount = Math.max(0, taxPaymentAmount - taxPaidAmount);
  const inferredIncomeCategory = purposeCandidates.some(
    (purpose) => purpose.category === "sponsorship"
  )
    ? "sponsorship"
    : "other";
  const inferredExpenseCategory = purposeCandidates.some(
    (purpose) => purpose.category === "event"
  )
    ? "event"
    : "other";
  const initialActionMode: TransactionActionMode =
    exactExistingItems.length > 0
      ? "existing"
      : direction === "deposit"
      ? purposeCandidates.some((purpose) => purpose.category === "sponsorship")
        ? "income"
        : "billing"
      : purposeCandidates.some((purpose) => purpose.category === "tax")
        ? "tax"
        : purposeCandidates.some((purpose) => purpose.category === "event")
          ? "expense"
          : "billing";
  const [actionMode, setActionMode] =
    useState<TransactionActionMode>(initialActionMode);
  const actionOptions: Array<{
    value: TransactionActionMode;
    label: string;
  }> =
    direction === "deposit"
      ? [
          { value: "existing", label: "登録済み収入" },
          { value: "billing", label: "未払い請求" },
          { value: "income", label: "協賛金・収入" },
          { value: "manual", label: "手動処理" },
          { value: "ignore", label: "対象外" },
        ]
      : [
          { value: "existing", label: "登録済み出費" },
          { value: "billing", label: "返金" },
          { value: "expense", label: "出費" },
          { value: "coach", label: "給与" },
          { value: "tax", label: "納税" },
          { value: "manual", label: "手動処理" },
          { value: "ignore", label: "対象外" },
        ];

  return (
    <article className="rounded-lg border border-gray-300 bg-white shadow-sm">
      <div className="grid gap-3 border-b border-gray-200 p-4 lg:grid-cols-[8rem_7rem_9rem_minmax(12rem,1fr)] lg:items-center">
        <div>
          <p className="text-xs font-bold text-gray-500">取引日</p>
          <p className="font-bold text-gray-900">
            {formatDate(transaction.transactedOn)}
          </p>
          {transaction.accountLabel && <p className="mt-1 text-xs text-gray-600">{transaction.accountLabel}</p>}
        </div>
        <div>
          <span
            className={`inline-flex rounded px-2 py-1 text-xs font-bold ${
              direction === "deposit"
                ? "bg-green-100 text-green-800"
                : "bg-rose-100 text-rose-800"
            }`}
          >
            {direction === "deposit" ? "入金" : "出金"}
          </span>
        </div>
        <p
          className={`text-lg font-bold ${
            direction === "deposit" ? "text-green-800" : "text-rose-800"
          }`}
        >
          {formatYen(amount)}
        </p>
        <div className="min-w-0">
          <p className="break-words font-bold text-gray-900">
            {transaction.description || "摘要なし"}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            取引番号 {transaction.bankTransactionId}
            {transaction.balance !== null &&
              ` ／ 残高 ${formatYen(transaction.balance)}`}
          </p>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold text-gray-900">推測候補</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {profileCandidates.length === 0 ? (
              <span className="rounded bg-gray-200 px-2 py-1 text-xs font-bold text-gray-700">
                名義候補なし
              </span>
            ) : (
              profileCandidates.slice(0, 3).map((candidate) => (
                <span
                  key={candidate.profileId}
                  className="rounded bg-blue-100 px-2 py-1 text-xs font-bold text-blue-800"
                >
                  {candidate.profileName}（{candidate.aliasName}）
                </span>
              ))
            )}
            {purposeCandidates.map((purpose) => (
              <span
                key={purpose.category}
                className="rounded bg-purple-100 px-2 py-1 text-xs font-bold text-purple-800"
              >
                {purpose.label}
              </span>
            ))}
            {exactExistingItems.slice(0, 2).map((item) => (
              <span
                key={item.itemId}
                className="rounded bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800"
              >
                登録済み候補：{item.partyName}
              </span>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-gray-900">請求候補</h3>
          <div className="mt-2 space-y-1">
            {matchCandidates.length === 0 ? (
              <p className="text-xs font-medium text-gray-600">
                方向が合う未処理項目はありません。
              </p>
            ) : (
              matchCandidates.slice(0, 3).map((candidate) => {
                const badge = confidenceBadge(candidate.confidence);
                return (
                  <div
                    key={candidate.billingItemId}
                    className="flex flex-wrap items-center gap-2 text-xs"
                  >
                    <span
                      className={`rounded px-2 py-1 font-bold ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <span className="font-bold text-gray-900">
                      {candidate.userName}・{candidate.title}・
                      {formatYen(candidate.amount)}
                    </span>
                    <span className="text-gray-500">
                      {candidate.reasons.join(" / ")}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 px-4 pb-4">
        <div
          role="tablist"
          aria-label="この明細の処理方法"
          className="-mx-4 flex gap-2 overflow-x-auto border-b border-gray-200 px-4 py-3"
        >
          {actionOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={actionMode === option.value}
              onClick={() => setActionMode(option.value)}
              className={`whitespace-nowrap rounded px-4 py-2 text-sm font-bold ${
                actionMode === option.value
                  ? "bg-gray-900 text-white"
                  : "border border-gray-300 bg-white text-gray-800"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <details
          open
          className={actionMode === "billing" ? "py-4" : "hidden"}
        >
          <summary className="hidden">
            {direction === "deposit" ? "未払い請求" : "未清算の返金"}
            に紐づける
          </summary>

          <form action={matchTransactionToBillingItems} className="mt-3 space-y-3">
            <input type="hidden" name="transaction_id" value={transaction.id} />
            <div>
              <label className="block text-sm font-bold text-gray-900">
                ユーザー
              </label>
              <select
                value={selectedUserId}
                onChange={(event) => {
                  setSelectedUserId(event.target.value);
                  setSelectedBillingIds([]);
                }}
                className={fieldClass}
              >
                <option value="">選択してください</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              {compatibleBillingItems.length === 0 ? (
                <p className="rounded bg-gray-100 p-3 text-sm font-medium text-gray-700">
                  このユーザーには方向が合う未処理項目がありません。
                </p>
              ) : (
                compatibleBillingItems.map((item) => (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-start gap-3 rounded border border-gray-300 p-3"
                  >
                    <input
                      name="billing_item_ids"
                      value={item.id}
                      type="checkbox"
                      checked={selectedBillingIds.includes(item.id)}
                      onChange={(event) => {
                        setSelectedBillingIds((current) =>
                          event.target.checked
                            ? [...current, item.id]
                            : current.filter((id) => id !== item.id)
                        );
                      }}
                      className="mt-1 size-4"
                    />
                    <span className="min-w-0 text-sm">
                      <span className="font-bold text-gray-900">
                        {formatTargetMonth(item.targetMonth)}・
                        {billingLabel(item)}・{formatYen(item.amount)}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>

            <div
              className={`rounded p-3 text-sm font-bold ${
                selectedTotal === amount
                  ? "bg-green-100 text-green-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              選択合計 {formatYen(selectedTotal)} ／ 明細額 {formatYen(amount)}
              {selectedTotal !== amount &&
                "（不一致です。内容を確認すれば確定できます）"}
            </div>

            <SubmitButton
              disabled={selectedBillingIds.length === 0}
              className="rounded bg-black px-4 py-2 font-bold text-white"
            >
              内容を確認して確定
            </SubmitButton>
          </form>
        </details>

        <details
          open
          className={actionMode === "existing" ? "py-4" : "hidden"}
        >
          <summary className="hidden">登録済みの会計項目へ紐づける</summary>
          <form
            action={matchTransactionToExistingAccountingItem}
            className="mt-3 space-y-3"
          >
            <input type="hidden" name="transaction_id" value={transaction.id} />
            <input
              type="hidden"
              name="item_type"
              value={direction === "deposit" ? "income" : "expense"}
            />

            {compatibleExistingItems.length === 0 ? (
              <p className="rounded bg-gray-100 p-3 text-sm font-medium text-gray-700">
                紐付け可能な登録済みの
                {direction === "deposit" ? "収入" : "出費"}
                はありません。
              </p>
            ) : (
              <>
                <label className="block text-sm font-bold text-gray-900">
                  登録済みの{direction === "deposit" ? "収入" : "出費"}
                  <select
                    name="item_id"
                    required
                    value={selectedExistingItemId}
                    onChange={(event) =>
                      setSelectedExistingItemId(event.target.value)
                    }
                    className={fieldClass}
                  >
                    {compatibleExistingItems.map((item) => {
                      const isExact =
                        item.amount === amount &&
                        item.transactedOn === transaction.transactedOn;

                      return (
                        <option key={item.itemId} value={item.itemId}>
                          {formatDate(item.transactedOn)}・{item.partyName}・
                          {item.title}・{formatYen(item.amount)}
                          {isExact ? "（日付・金額一致）" : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>

                {selectedExistingItem && (
                  <div
                    className={`rounded p-3 text-sm font-bold ${
                      selectedExistingItem.amount === amount &&
                      selectedExistingItem.transactedOn ===
                        transaction.transactedOn
                        ? "bg-green-100 text-green-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {selectedExistingItem.amount === amount &&
                    selectedExistingItem.transactedOn ===
                      transaction.transactedOn
                      ? "日付と金額が一致しています。"
                      : `登録済み項目は${formatDate(
                          selectedExistingItem.transactedOn
                        )}・${formatYen(
                          selectedExistingItem.amount
                        )}です。内容を確認してください。`}
                  </div>
                )}

                <label className="block text-sm font-bold text-gray-900">
                  備考（任意）
                  <input name="note" className={fieldClass} />
                </label>
                <p className="text-sm font-medium text-gray-700">
                  紐付けを取り消しても、登録済みの会計項目は削除されません。
                </p>
                <SubmitButton className="rounded bg-black px-4 py-2 font-bold text-white">
                  既存項目へ紐付けて確定
                </SubmitButton>
              </>
            )}
          </form>
        </details>

        {direction === "deposit" ? (
          <details
            open
            className={actionMode === "income" ? "py-4" : "hidden"}
          >
            <summary className="hidden">
              協賛金・その他収入として登録
            </summary>
            <form
              action={matchTransactionToIncomeItem}
              className="mt-3 grid gap-3 sm:grid-cols-2"
            >
              <input type="hidden" name="transaction_id" value={transaction.id} />
              <div>
                <label className="block text-sm font-bold text-gray-900">
                  収入種別
                </label>
                <select
                  name="category"
                  defaultValue={inferredIncomeCategory}
                  className={fieldClass}
                >
                  <option value="sponsorship">協賛金</option>
                  <option value="other">その他収入</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-900">
                  支払者
                </label>
                <input
                  name="payer_name"
                  required
                  defaultValue={transaction.description}
                  className={fieldClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-bold text-gray-900">
                  備考
                </label>
                <input name="note" className={fieldClass} />
              </div>
              <SubmitButton className="rounded bg-black px-4 py-2 font-bold text-white sm:col-span-2 sm:w-fit">
                {formatYen(amount)}の収入として確定
              </SubmitButton>
            </form>
          </details>
        ) : (
          <>
            <details
              open
              className={actionMode === "expense" ? "py-4" : "hidden"}
            >
              <summary className="hidden">
                大会費・手数料・その他出費として登録
              </summary>
              <form
                action={matchTransactionToExpenseItem}
                className="mt-3 grid gap-3 sm:grid-cols-2"
              >
                <input
                  type="hidden"
                  name="transaction_id"
                  value={transaction.id}
                />
                <div>
                  <label className="block text-sm font-bold text-gray-900">
                    出費種別
                  </label>
                  <select
                    name="category"
                    defaultValue={inferredExpenseCategory}
                    className={fieldClass}
                  >
                    <option value="event">大会・イベント費</option>
                    <option value="fee">手数料</option>
                    <option value="other">その他出費</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-900">
                    支払先
                  </label>
                  <input
                    name="payee_name"
                    required
                    defaultValue={transaction.description}
                    className={fieldClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-gray-900">
                    備考
                  </label>
                  <input name="note" className={fieldClass} />
                </div>
                <SubmitButton className="rounded bg-black px-4 py-2 font-bold text-white sm:col-span-2 sm:w-fit">
                  {formatYen(amount)}の出費として確定
                </SubmitButton>
              </form>
            </details>

            <details
              open
              className={actionMode === "coach" ? "py-4" : "hidden"}
            >
              <summary className="hidden">
                指導者手取りの送金として処理
              </summary>
              <form action={matchTransactionToCoachNetPay} className="mt-3 space-y-3">
                <input
                  type="hidden"
                  name="transaction_id"
                  value={transaction.id}
                />
                <input type="hidden" name="target_month" value={targetMonth} />
                {availableCoachPayments.length === 0 ? (
                  <p className="rounded bg-amber-100 p-3 text-sm font-bold text-amber-800">
                    {formatTargetMonth(targetMonth)}に指導者手取り候補はありません。
                  </p>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-bold text-gray-900">
                        指導者（{formatTargetMonth(targetMonth)}）
                      </label>
                      <select name="coach_id" required value={selectedCoachId} onChange={(event) => setSelectedCoachId(event.target.value)} className={fieldClass}>
                        {availableCoachPayments.map((payment) => (
                          <option key={payment.coachId} value={payment.coachId}>
                            {payment.coachName}・残り{formatYen(payment.remainingAmount)}（予定{formatYen(payment.amount)}）
                          </option>
                        ))}
                      </select>
                    </div>
                    {selectedCoach && (
                      <p className="text-sm font-medium text-gray-700">
                        照合済み {formatYen(selectedCoach.paidAmount)}・今回 {formatYen(amount)}・照合後の残り {formatYen(Math.max(0, selectedCoach.remainingAmount - amount))}
                        {selectedCoach.deductionTotal > 0 && `。精算完了時に請求${formatYen(selectedCoach.deductionTotal)}を相殺します。`}
                      </p>
                    )}
                    <p className="rounded bg-amber-100 p-3 text-sm font-bold text-amber-800">
                      明細額と計算上の手取りが違っても、内容を確認すれば確定できます。
                    </p>
                    <label className="flex items-start gap-2 text-sm font-medium text-gray-800">
                      <input type="checkbox" name="complete_payment" className="mt-1" />
                      差額を確認し、今回で精算完了にする（分割払いの途中では選択しない）
                    </label>
                    <input
                      name="note"
                      className={fieldClass}
                      placeholder="備考（任意）"
                    />
                    <SubmitButton className="rounded bg-black px-4 py-2 font-bold text-white">
                      指導者手取りとして確定
                    </SubmitButton>
                  </>
                )}
              </form>
            </details>

            <details
              open
              className={actionMode === "tax" ? "py-4" : "hidden"}
            >
              <summary className="hidden">
                税務署への納税として処理
              </summary>
              <form action={matchTransactionToTaxPayment} className="mt-3 space-y-3">
                <input
                  type="hidden"
                  name="transaction_id"
                  value={transaction.id}
                />
                <input type="hidden" name="target_month" value={targetMonth} />
                {taxPaymentAmount <= 0 ? (
                  <p className="rounded bg-amber-100 p-3 text-sm font-bold text-amber-800">
                    {formatTargetMonth(targetMonth)}の源泉税額はありません。
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-bold text-gray-900">
                      {formatTargetMonth(targetMonth)}の源泉税額：
                      {formatYen(taxPaymentAmount)}
                    </p>
                    <p className="text-sm text-gray-700">納付済み {formatYen(taxPaidAmount)}・残り {formatYen(taxRemainingAmount)}</p>
                    {taxRemainingAmount !== amount && (
                      <p className="rounded bg-amber-100 p-3 text-sm font-bold text-amber-800">
                        明細額 {formatYen(amount)}と一致しません。内容を確認すればこのまま確定できます。
                      </p>
                    )}
                    <input
                      name="note"
                      className={fieldClass}
                      placeholder="備考（任意）"
                    />
                    <SubmitButton className="rounded bg-black px-4 py-2 font-bold text-white">
                      納税として確定
                    </SubmitButton>
                  </>
                )}
              </form>
            </details>
          </>
        )}

        <details
          open
          className={actionMode === "manual" ? "py-4" : "hidden"}
        >
          <summary className="hidden">
            手動メモで処理済みにする
          </summary>
          <form action={matchTransactionManually} className="mt-3 space-y-3">
            <input type="hidden" name="transaction_id" value={transaction.id} />
            <label className="block text-sm font-bold text-gray-900">
              メモ（任意）
              <input
                name="note"
                className={fieldClass}
                placeholder="例：システム導入前に処理済み"
              />
            </label>
            <SubmitButton className="rounded bg-gray-900 px-4 py-2 font-bold text-white">
              処理済みにする
            </SubmitButton>
          </form>
        </details>

        <details
          open
          className={actionMode === "ignore" ? "py-4" : "hidden"}
        >
          <summary className="hidden">
            対象外にする
          </summary>
          <form action={ignoreBankTransaction} className="mt-3 space-y-3">
            <input type="hidden" name="transaction_id" value={transaction.id} />
            <label className="block text-sm font-bold text-gray-900">
              理由（任意）
              <input
                name="memo"
                className={fieldClass}
                placeholder="例：口座間移動"
              />
            </label>
            <SubmitButton className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900">
              対象外にする
            </SubmitButton>
          </form>
        </details>
      </div>
    </article>
  );
}

export default function BankTransactionReviewClient(props: Props) {
  const [query, setQuery] = useState("");
  const [directionFilter, setDirectionFilter] = useState<
    "all" | "deposit" | "withdrawal"
  >("all");
  const [currentIndex, setCurrentIndex] = useState(0);
  const filteredTransactions = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();

    return props.transactions.filter((transaction) => {
      const direction = getBankDirection(transaction);
      const matchesDirection =
        directionFilter === "all" || directionFilter === direction;
      const matchesQuery =
        !normalizedQuery ||
        transaction.description.toUpperCase().includes(normalizedQuery) ||
        transaction.bankTransactionId.toUpperCase().includes(normalizedQuery);

      return matchesDirection && matchesQuery;
    });
  }, [directionFilter, props.transactions, query]);
  const safeCurrentIndex =
    filteredTransactions.length === 0
      ? 0
      : Math.min(currentIndex, filteredTransactions.length - 1);
  const currentTransaction = filteredTransactions[safeCurrentIndex];

  return (
    <section id="unmatched" className="space-y-4">
      <div className="rounded-lg bg-white p-5 shadow">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">未処理明細</h2>
            <p className="mt-1 text-sm font-medium text-gray-700">
              候補は参考情報です。確定ボタンを押すまで請求・会計データは更新されません。
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentIndex(0);
              }}
              className={fieldClass}
              placeholder="摘要・取引番号で検索"
            />
            <select
              value={directionFilter}
              onChange={(event) => {
                setDirectionFilter(
                  event.target.value as "all" | "deposit" | "withdrawal"
                );
                setCurrentIndex(0);
              }}
              className={fieldClass}
            >
              <option value="all">入出金すべて</option>
              <option value="deposit">入金のみ</option>
              <option value="withdrawal">出金のみ</option>
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
          <p className="text-sm font-bold text-gray-700">
            {filteredTransactions.length === 0
              ? "該当なし"
              : `${safeCurrentIndex + 1} / ${filteredTransactions.length}件`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={safeCurrentIndex <= 0}
              onClick={() =>
                setCurrentIndex(Math.max(0, safeCurrentIndex - 1))
              }
              className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900 disabled:pointer-events-none disabled:opacity-40"
            >
              前の明細
            </button>
            <button
              type="button"
              disabled={
                filteredTransactions.length === 0 ||
                safeCurrentIndex >= filteredTransactions.length - 1
              }
              onClick={() =>
                setCurrentIndex(
                  Math.min(
                    filteredTransactions.length - 1,
                    safeCurrentIndex + 1
                  )
                )
              }
              className="rounded bg-gray-900 px-4 py-2 font-bold text-white disabled:pointer-events-none disabled:opacity-40"
            >
              次の明細
            </button>
          </div>
        </div>
      </div>

      {!currentTransaction ? (
        <div className="rounded-lg bg-white p-6 text-center font-medium text-gray-700 shadow">
          条件に合う未処理明細はありません。
        </div>
      ) : (
        <TransactionCard
          key={currentTransaction.id}
          transaction={currentTransaction}
          users={props.users}
          aliases={props.aliases}
          billingItems={props.billingItems}
          existingAccountingItems={props.existingAccountingItems}
          coachPayments={props.coachPayments}
          taxPaymentAmount={props.taxPaymentAmount}
          taxPaidAmount={props.taxPaidAmount}
          targetMonth={props.targetMonth}
        />
      )}
    </section>
  );
}
