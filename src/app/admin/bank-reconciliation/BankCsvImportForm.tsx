"use client";

import { useActionState } from "react";
import SubmitButton from "@/components/SubmitButton";
import { importBankCsv, type BankCsvImportState } from "./actions";

const initialState: BankCsvImportState = {
  ok: false,
  message: "",
  importedCount: 0,
  skippedCount: 0,
};

export default function BankCsvImportForm() {
  const [state, action] = useActionState(importBankCsv, initialState);

  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
      {state.message && (
        <div
          role="status"
          className={`rounded p-3 text-sm font-bold sm:col-span-2 ${
            state.ok
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-700"
          }`}
        >
          {state.message}
        </div>
      )}

      <div>
        <label className="block text-sm font-bold text-gray-900">
          銀行CSV（CP932 / Shift_JIS）
        </label>
        <input
          name="csv_file"
          type="file"
          accept=".csv,text/csv"
          required
          className="mt-1 block w-full rounded border border-gray-400 bg-white px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded file:border-0 file:bg-gray-200 file:px-3 file:py-2 file:font-bold"
        />
      </div>

      <div className="flex items-end">
        <SubmitButton className="w-full rounded bg-black px-5 py-3 font-bold text-white sm:w-auto">
          取り込む
        </SubmitButton>
      </div>

      <p className="text-xs font-medium text-gray-600 sm:col-span-2">
        取込だけでは請求や会計項目を更新しません。同じ取引番号は重複登録されません。
      </p>
    </form>
  );
}
