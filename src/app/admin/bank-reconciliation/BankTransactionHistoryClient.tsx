"use client";

import { useState } from "react";
import SubmitButton from "@/components/SubmitButton";
import { formatTargetMonth, formatYen } from "@/lib/month";
import {
  cancelBankTransactionMatch,
  unignoreBankTransaction,
} from "./actions";
import type { BankTransaction, BankTransactionMatch } from "./types";

type Props = {
  matchedTransactions: BankTransaction[];
  ignoredTransactions: BankTransaction[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function matchTypeLabel(match: BankTransactionMatch) {
  if (match.matchType === "billing_item") return "請求・返金";
  if (match.matchType === "accounting_income_item") {
    return match.ownsTarget === false ? "登録済み会計収入" : "会計収入";
  }
  if (match.matchType === "accounting_expense_item") {
    return match.ownsTarget === false ? "登録済み会計出費" : "会計出費";
  }
  if (match.matchType === "coach_net_pay") return "指導者手取り";
  if (match.matchType === "tax_payment") return "源泉税納付";
  return "手動処理";
}

function transactionAmount(transaction: BankTransaction) {
  return Math.max(transaction.depositAmount, transaction.withdrawalAmount);
}

function cancellationDescription(transaction: BankTransaction) {
  const matchTypes = new Set(transaction.matches.map((match) => match.matchType));
  const keepsExistingAccountingItem = transaction.matches.some(
    (match) =>
      (match.matchType === "accounting_income_item" ||
        match.matchType === "accounting_expense_item") &&
      match.ownsTarget === false
  );

  if (matchTypes.has("billing_item")) {
    return "紐付けを取り消し、請求・返金を未払いへ戻します。";
  }

  if (keepsExistingAccountingItem) {
    return "紐付けを取り消し、既存の会計項目はそのまま残します。";
  }

  if (
    matchTypes.has("accounting_income_item") ||
    matchTypes.has("accounting_expense_item")
  ) {
    return "紐付けを取り消し、この照合で作成した会計項目を削除します。";
  }

  return "紐付けを取り消し、この銀行明細を未処理へ戻します。";
}

export default function BankTransactionHistoryClient({
  matchedTransactions,
  ignoredTransactions,
}: Props) {
  const [status, setStatus] = useState<"matched" | "ignored">(
    matchedTransactions.length > 0 ? "matched" : "ignored"
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const transactions =
    status === "matched" ? matchedTransactions : ignoredTransactions;
  const safeCurrentIndex =
    transactions.length === 0
      ? 0
      : Math.min(currentIndex, transactions.length - 1);
  const transaction = transactions[safeCurrentIndex];

  function selectStatus(nextStatus: "matched" | "ignored") {
    setStatus(nextStatus);
    setCurrentIndex(0);
  }

  return (
    <section id="processed" className="rounded-lg bg-white p-5 shadow">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">処理履歴</h2>
          <p className="mt-1 text-sm font-medium text-gray-700">
            履歴も一件ずつ確認します。
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={status === "matched"}
            onClick={() => selectStatus("matched")}
            className={`rounded px-4 py-2 font-bold ${
              status === "matched"
                ? "bg-gray-900 text-white"
                : "border border-gray-400 bg-white text-gray-900"
            }`}
          >
            処理済み {matchedTransactions.length}件
          </button>
          <button
            type="button"
            aria-pressed={status === "ignored"}
            onClick={() => selectStatus("ignored")}
            className={`rounded px-4 py-2 font-bold ${
              status === "ignored"
                ? "bg-gray-900 text-white"
                : "border border-gray-400 bg-white text-gray-900"
            }`}
          >
            対象外 {ignoredTransactions.length}件
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-gray-200 py-3">
        <p className="text-sm font-bold text-gray-700">
          {transactions.length === 0
            ? "該当なし"
            : `${safeCurrentIndex + 1} / ${transactions.length}件`}
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
            前へ
          </button>
          <button
            type="button"
            disabled={
              transactions.length === 0 ||
              safeCurrentIndex >= transactions.length - 1
            }
            onClick={() =>
              setCurrentIndex(
                Math.min(transactions.length - 1, safeCurrentIndex + 1)
              )
            }
            className="rounded bg-gray-900 px-4 py-2 font-bold text-white disabled:pointer-events-none disabled:opacity-40"
          >
            次へ
          </button>
        </div>
      </div>

      {!transaction ? (
        <p className="mt-4 rounded bg-gray-100 p-4 text-sm font-medium text-gray-700">
          {status === "matched"
            ? "処理済み明細はありません。"
            : "対象外明細はありません。"}
        </p>
      ) : (
        <article className="mt-4 rounded border border-gray-300 p-4">
          <div className="grid gap-3 sm:grid-cols-[8rem_7rem_9rem_minmax(12rem,1fr)] sm:items-center">
            <p className="font-bold text-gray-900">
              {formatDate(transaction.transactedOn)}
            </p>
            <span
              className={`w-fit rounded px-2 py-1 text-xs font-bold ${
                transaction.depositAmount > 0
                  ? "bg-green-100 text-green-800"
                  : "bg-rose-100 text-rose-800"
              }`}
            >
              {transaction.depositAmount > 0 ? "入金" : "出金"}
            </span>
            <p className="font-bold text-gray-900">
              {formatYen(transactionAmount(transaction))}
            </p>
            <p className="break-words font-bold text-gray-900">
              {transaction.description || "摘要なし"}
            </p>
          </div>

          {status === "matched" ? (
            <div className="mt-4 border-t border-gray-200 pt-4">
              <p className="text-xs font-bold text-gray-500">処理内容</p>
              {transaction.matches.length === 0 ? (
                <p className="mt-2 text-sm text-gray-600">
                  照合詳細がありません。
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {transaction.matches.map((match) => (
                    <span
                      key={match.id}
                      className="rounded bg-gray-100 px-3 py-2 text-sm text-gray-900"
                    >
                      <span className="font-bold">
                        {matchTypeLabel(match)}・{formatYen(match.amount)}
                      </span>
                      {match.targetMonth &&
                        `・${formatTargetMonth(match.targetMonth)}`}
                      {typeof match.expectedAmount === "number" &&
                        match.expectedAmount !== match.amount &&
                        `・計算額${formatYen(match.expectedAmount)}`}
                      {match.note && `・${match.note}`}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium text-gray-700">
                  {cancellationDescription(transaction)}
                </p>
                <form
                  action={cancelBankTransactionMatch}
                  onSubmit={(event) => {
                    if (
                      !window.confirm(
                        `${cancellationDescription(transaction)}よろしいですか？`
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input
                    type="hidden"
                    name="transaction_id"
                    value={transaction.id}
                  />
                  <SubmitButton className="rounded border border-red-300 bg-white px-4 py-2 font-bold text-red-700">
                    紐付けを取り消す
                  </SubmitButton>
                </form>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-700">
                {transaction.memo ? `理由：${transaction.memo}` : "理由なし"}
              </p>
              <form action={unignoreBankTransaction}>
                <input
                  type="hidden"
                  name="transaction_id"
                  value={transaction.id}
                />
                <SubmitButton className="rounded border border-gray-400 bg-white px-4 py-2 font-bold text-gray-900">
                  未処理に戻す
                </SubmitButton>
              </form>
            </div>
          )}
        </article>
      )}
    </section>
  );
}
