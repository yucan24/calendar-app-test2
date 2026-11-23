"use client";

import { useActionState, useState } from "react";
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
  const [fileError, setFileError] = useState("");

  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
      {state.message && (
        <div
          role="status"
          className={`rounded p-3 text-sm font-bold sm:col-span-2 ${
            state.ok
              ? state.conflictCount
                ? "bg-amber-100 text-amber-900"
                : "bg-green-100 text-green-800"
              : "bg-red-100 text-red-700"
          }`}
        >
          {state.message}
        </div>
      )}

      <div>
        <label className="block text-sm font-bold text-gray-900">
          銀行CSV（CP932 / Shift_JIS・UTF-8、5MB以下）
        </label>
        <input
          name="csv_file"
          type="file"
          accept=".csv,text/csv"
          required
          onChange={(event) => {
            const error = (event.currentTarget.files?.[0]?.size ?? 0) > 5 * 1024 * 1024
              ? "CSVは5MB以下のファイルを選択してください" : "";
            event.currentTarget.setCustomValidity(error);
            setFileError(error);
          }}
          className="ui-field mt-1 block w-full file:mr-3 file:rounded file:border-0 file:bg-gray-200 file:px-3 file:py-2 file:font-bold"
        />
        {fileError && <p role="alert" className="mt-2 text-sm font-bold text-red-700">{fileError}</p>}
      </div>

      <div className="flex items-end">
        <SubmitButton className="ui-button ui-button-primary w-full sm:w-auto">
          取り込む
        </SubmitButton>
      </div>

      <p className="text-xs font-medium text-gray-600 sm:col-span-2">
        取込だけでは請求や会計項目を更新しません。同じ口座・取引番号は重複登録せず、内容の変更があれば警告します。
      </p>
    </form>
  );
}
