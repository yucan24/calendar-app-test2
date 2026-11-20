"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { normalizeBankText, parseBankCsv } from "@/lib/bankReconciliation";
import { buildMonthlyVirtualPaymentReport } from "./paymentReport";
import { supabase } from "@/lib/supabase";

export type BankCsvImportState = {
  ok: boolean;
  message: string;
  importedCount: number;
  skippedCount: number;
  conflictCount?: number;
};

function cleanText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function requireId(value: FormDataEntryValue | null, label: string) {
  const id = cleanText(value);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    throw new Error(`${label}が不正です`);
  }

  return id;
}

function rpcErrorMessage(message: string) {
  const translations: Array<[string, string]> = [
    ["duplicate key", "同じ内容がすでに登録されています"],
    ["alias is required", "口座名義を入力してください"],
    ["profile not found", "対象ユーザーが見つかりません"],
    ["alias not found", "口座名義が見つかりません"],
    ["transaction not found", "銀行明細が見つかりません"],
    ["transaction is already processed", "この銀行明細はすでに処理されています"],
    ["billing items are required", "紐づける請求項目を選択してください"],
    ["invalid billing item selection", "選択した請求項目を紐づけられません"],
    [
      "billing item total does not match transaction amount",
      "選択した項目の合計と銀行明細の金額が一致しません",
    ],
    ["transaction is not an unmatched deposit", "未処理の入金明細ではありません"],
    [
      "transaction is not an unmatched withdrawal",
      "未処理の出金明細ではありません",
    ],
    [
      "transaction amount does not match expected payment",
      "銀行明細と支払予定額が一致しません",
    ],
    ["unmatched transaction not found", "未処理の銀行明細が見つかりません"],
    ["ignored transaction not found", "対象外の銀行明細が見つかりません"],
    ["matched transaction not found", "処理済みの銀行明細が見つかりません"],
    ["transaction match not found", "取り消す紐付けが見つかりません"],
    ["accounting item not found", "既存の会計項目が見つかりません"],
    ["accounting item is already linked", "この会計項目はすでに別の銀行明細へ紐付けられています"],
    ["accounting item direction does not match transaction", "銀行明細と会計項目の入出金方向が一致しません"],
  ];

  const translated = translations.find(([source]) =>
    message.toLowerCase().includes(source.toLowerCase())
  );

  return translated?.[1] ?? message;
}

function throwRpcError(error: { message: string } | null) {
  if (error) {
    throw new Error(rpcErrorMessage(error.message));
  }
}

function revalidateBankPages() {
  revalidatePath("/admin/bank-reconciliation");
  revalidatePath("/admin/accounting");
}

function revalidateMoneyPages() {
  revalidateBankPages();
  revalidatePath("/admin/users");
  revalidatePath("/user/payment-check");
  revalidatePath("/admin/accounting");
}

export async function importBankCsv(
  _previousState: BankCsvImportState,
  formData: FormData
): Promise<BankCsvImportState> {
  const admin = await requireAdmin();
  const file = formData.get("csv_file");

  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      message: "銀行CSVを選択してください",
      importedCount: 0,
      skippedCount: 0,
    };
  }

  if (file.size > 5 * 1024 * 1024) {
    return {
      ok: false,
      message: "CSVは5MB以下のファイルを選択してください",
      importedCount: 0,
      skippedCount: 0,
    };
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    return {
      ok: false,
      message: "CSV形式のファイルを選択してください",
      importedCount: 0,
      skippedCount: 0,
    };
  }

  try {
    const parsed = parseBankCsv(await file.arrayBuffer());

    if (parsed.transactions.length > 5000) {
      throw new Error("1回に取り込める明細は5000件までです");
    }

    const { data, error } = await supabase.rpc("import_bank_transactions", {
      p_admin_profile_id: admin.id,
      p_import_meta: {
        sourceFilename: file.name.slice(0, 255),
        ...parsed.meta,
      },
      p_transactions: parsed.transactions,
    });

    throwRpcError(error);

    const result = Array.isArray(data) ? data[0] : data;
    const importedCount = Number(result?.imported_count ?? 0);
    const skippedCount = Number(result?.skipped_count ?? 0);
    const conflictCount = Number(result?.conflict_count ?? 0);
    const conflictIds: string[] = result?.conflict_transaction_ids ?? [];

    revalidateBankPages();

    return {
      ok: true,
      message: `CSVを取り込みました（新規${importedCount}件・重複${skippedCount}件）${conflictCount > 0 ? `。同じ口座・取引番号で内容が異なる明細が${conflictCount}件あります。既存データは変更していません。取引番号：${conflictIds.join("、")}${conflictCount > conflictIds.length ? " ほか" : ""}` : ""}`,
      importedCount,
      skippedCount,
      conflictCount,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? rpcErrorMessage(error.message)
          : "CSVの取込に失敗しました",
      importedCount: 0,
      skippedCount: 0,
    };
  }
}

export async function createPaymentAlias(formData: FormData) {
  const admin = await requireAdmin();
  const profileId = requireId(formData.get("profile_id"), "ユーザーID");
  const aliasName = cleanText(formData.get("alias_name"));
  const normalizedAliasName = normalizeBankText(aliasName);
  const note = cleanText(formData.get("note"));

  if (!aliasName || !normalizedAliasName) {
    throw new Error("口座名義を入力してください");
  }

  const { error } = await supabase.rpc("create_profile_payment_alias", {
    p_admin_profile_id: admin.id,
    p_profile_id: profileId,
    p_alias_name: aliasName,
    p_normalized_alias_name: normalizedAliasName,
    p_note: note,
  });

  throwRpcError(error);
  revalidateBankPages();
}

export async function updatePaymentAlias(formData: FormData) {
  const admin = await requireAdmin();
  const aliasId = requireId(formData.get("alias_id"), "口座名義ID");
  const aliasName = cleanText(formData.get("alias_name"));
  const normalizedAliasName = normalizeBankText(aliasName);
  const note = cleanText(formData.get("note"));

  if (!aliasName || !normalizedAliasName) {
    throw new Error("口座名義を入力してください");
  }

  const { error } = await supabase.rpc("update_profile_payment_alias", {
    p_admin_profile_id: admin.id,
    p_alias_id: aliasId,
    p_alias_name: aliasName,
    p_normalized_alias_name: normalizedAliasName,
    p_note: note,
  });

  throwRpcError(error);
  revalidateBankPages();
}

export async function deletePaymentAlias(formData: FormData) {
  const admin = await requireAdmin();
  const aliasId = requireId(formData.get("alias_id"), "口座名義ID");
  const { error } = await supabase.rpc("delete_profile_payment_alias", {
    p_admin_profile_id: admin.id,
    p_alias_id: aliasId,
  });

  throwRpcError(error);
  revalidateBankPages();
}

export async function matchTransactionToBillingItems(formData: FormData) {
  const admin = await requireAdmin();
  const transactionId = requireId(formData.get("transaction_id"), "銀行明細ID");
  const billingItemIds = Array.from(
    new Set(
      formData
        .getAll("billing_item_ids")
        .map((value) => requireId(value, "請求項目ID"))
    )
  );

  if (billingItemIds.length === 0) {
    throw new Error("紐づける請求項目を選択してください");
  }

  const { error } = await supabase.rpc("match_bank_transaction_billing_items", {
    p_admin_profile_id: admin.id,
    p_transaction_id: transactionId,
    p_billing_item_ids: billingItemIds,
  });

  throwRpcError(error);
  revalidateMoneyPages();
}

export async function matchTransactionToIncomeItem(formData: FormData) {
  const admin = await requireAdmin();
  const transactionId = requireId(formData.get("transaction_id"), "銀行明細ID");
  const category = cleanText(formData.get("category"));
  const payerName = cleanText(formData.get("payer_name"));
  const note = cleanText(formData.get("note"));

  if (category !== "sponsorship" && category !== "other") {
    throw new Error("収入種別が不正です");
  }

  if (!payerName) {
    throw new Error("支払者を入力してください");
  }

  const { error } = await supabase.rpc("match_bank_transaction_income", {
    p_admin_profile_id: admin.id,
    p_transaction_id: transactionId,
    p_category: category,
    p_payer_name: payerName,
    p_note: note,
  });

  throwRpcError(error);
  revalidateMoneyPages();
}

export async function matchTransactionToExpenseItem(formData: FormData) {
  const admin = await requireAdmin();
  const transactionId = requireId(formData.get("transaction_id"), "銀行明細ID");
  const category = cleanText(formData.get("category"));
  const payeeName = cleanText(formData.get("payee_name"));
  const note = cleanText(formData.get("note"));

  if (!['event', 'fee', 'other'].includes(category)) {
    throw new Error("出費種別が不正です");
  }

  if (!payeeName) {
    throw new Error("支払先を入力してください");
  }

  const { error } = await supabase.rpc("match_bank_transaction_expense", {
    p_admin_profile_id: admin.id,
    p_transaction_id: transactionId,
    p_category: category,
    p_payee_name: payeeName,
    p_note: note,
  });

  throwRpcError(error);
  revalidateMoneyPages();
}

export async function matchTransactionToExistingAccountingItem(
  formData: FormData
) {
  const admin = await requireAdmin();
  const transactionId = requireId(formData.get("transaction_id"), "銀行明細ID");
  const itemId = requireId(formData.get("item_id"), "会計項目ID");
  const itemType = cleanText(formData.get("item_type"));
  const note = cleanText(formData.get("note"));

  if (itemType !== "income" && itemType !== "expense") {
    throw new Error("会計項目の種別が不正です");
  }

  const { error } = await supabase.rpc(
    "match_bank_transaction_existing_accounting_item",
    {
      p_admin_profile_id: admin.id,
      p_transaction_id: transactionId,
      p_item_type: itemType,
      p_item_id: itemId,
      p_note: note,
    }
  );

  throwRpcError(error);
  revalidateMoneyPages();
}

export async function matchTransactionToCoachNetPay(formData: FormData) {
  const admin = await requireAdmin();
  const transactionId = requireId(formData.get("transaction_id"), "銀行明細ID");
  const coachId = requireId(formData.get("coach_id"), "指導者ID");
  const targetMonth = cleanText(formData.get("target_month"));
  const note = cleanText(formData.get("note"));
  const report = await buildMonthlyVirtualPaymentReport(admin, targetMonth);
  const coachRow = report.rows.find((row) => row.coachId === coachId);

  if (!coachRow || coachRow.netPay <= 0) {
    throw new Error("この月の指導者手取り額が見つかりません");
  }

  const { error } = await supabase.rpc(
    "match_bank_transaction_coach_payment",
    {
      p_admin_profile_id: admin.id,
      p_transaction_id: transactionId,
      p_profile_id: coachId,
      p_target_month: targetMonth,
      p_expected_amount: coachRow.netPay,
      p_billing_item_ids: coachRow.deductionItems.filter((item) => item.status === "unpaid").map((item) => item.id),
      p_complete: formData.get("complete_payment") === "on",
      p_note: note,
    }
  );

  throwRpcError(error);
  revalidateMoneyPages();
}

export async function matchTransactionToTaxPayment(formData: FormData) {
  const admin = await requireAdmin();
  const transactionId = requireId(formData.get("transaction_id"), "銀行明細ID");
  const targetMonth = cleanText(formData.get("target_month"));
  const note = cleanText(formData.get("note"));
  const report = await buildMonthlyVirtualPaymentReport(admin, targetMonth);
  const expectedAmount = report.totals.withholdingTaxTotal;

  if (expectedAmount <= 0) {
    throw new Error("この月の源泉税額がありません");
  }

  const { error } = await supabase.rpc(
    "match_bank_transaction_virtual_payment",
    {
      p_admin_profile_id: admin.id,
      p_transaction_id: transactionId,
      p_match_type: "tax_payment",
      p_profile_id: null,
      p_target_month: targetMonth,
      p_expected_amount: expectedAmount,
      p_note: note,
    }
  );

  throwRpcError(error);
  revalidateMoneyPages();
}

export async function matchTransactionManually(formData: FormData) {
  const admin = await requireAdmin();
  const transactionId = requireId(formData.get("transaction_id"), "銀行明細ID");
  const note = cleanText(formData.get("note"));

  const { error } = await supabase.rpc("match_bank_transaction_manual", {
    p_admin_profile_id: admin.id,
    p_transaction_id: transactionId,
    p_note: note,
  });

  throwRpcError(error);
  revalidateBankPages();
}

export async function ignoreBankTransaction(formData: FormData) {
  const admin = await requireAdmin();
  const transactionId = requireId(formData.get("transaction_id"), "銀行明細ID");
  const memo = cleanText(formData.get("memo"));
  const { error } = await supabase.rpc("ignore_bank_transaction", {
    p_admin_profile_id: admin.id,
    p_transaction_id: transactionId,
    p_memo: memo,
  });

  throwRpcError(error);
  revalidateBankPages();
}

export async function unignoreBankTransaction(formData: FormData) {
  const admin = await requireAdmin();
  const transactionId = requireId(formData.get("transaction_id"), "銀行明細ID");
  const { error } = await supabase.rpc("unignore_bank_transaction", {
    p_admin_profile_id: admin.id,
    p_transaction_id: transactionId,
  });

  throwRpcError(error);
  revalidateBankPages();
}

export async function cancelBankTransactionMatch(formData: FormData) {
  const admin = await requireAdmin();
  const transactionId = requireId(formData.get("transaction_id"), "銀行明細ID");
  const { error } = await supabase.rpc("cancel_bank_transaction_match", {
    p_admin_profile_id: admin.id,
    p_transaction_id: transactionId,
  });

  throwRpcError(error);
  revalidateMoneyPages();
}
