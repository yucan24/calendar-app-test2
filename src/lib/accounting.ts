export type AccountingCoach = {
  id: string;
  name: string;
};

export type AccountingCoachWorkLog = {
  coach_id: string;
  coaching_minutes: number;
  admin_minutes: number;
  travel_expense: number;
  other_expense: number;
};

export type AccountingBillingItem = {
  id: string;
  user_id: string;
  target_month: string;
  category: string;
  title: string;
  amount: number;
  status: string;
  note: string | null;
};

export type AccountingIncomeItem = {
  id: string;
  received_on: string;
  payer_name: string;
  category: string;
  title: string;
  amount: number;
  note: string | null;
};

export type AccountingReportRow = {
  coachId: string;
  coachName: string;
  coachingMinutes: number;
  adminMinutes: number;
  totalWorkMinutes: number;
  grossReward: number;
  withholdingTax: number;
  taxOfficePayment: number;
  reimbursedExpense: number;
  unpaidDeductionTotal: number;
  netPay: number;
  deductionItems: AccountingBillingItem[];
};

export type AccountingReportTotals = {
  paidTuitionTotal: number;
  sponsorshipTotal: number;
  otherIncomeTotal: number;
  incomeItemsTotal: number;
  unpaidChargeTotal: number;
  remainingUnpaidChargeTotal: number;
  paidRefundTotal: number;
  unsettledRefundTotal: number;
  grossRewardTotal: number;
  withholdingTaxTotal: number;
  reimbursedExpenseTotal: number;
  unpaidDeductionTotal: number;
  netPayTotal: number;
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
};

export const COACH_HOURLY_RATE = 1000;
export const WITHHOLDING_TAX_RATE = 0.1021;

const REFUND_TITLE = "返金";

export function calculateGrossReward(minutes: number) {
  return Math.round((minutes / 60) * COACH_HOURLY_RATE);
}

export function calculateWithholdingTax(grossReward: number) {
  return Math.floor(grossReward * WITHHOLDING_TAX_RATE);
}

export function formatTaxRate() {
  return `${(WITHHOLDING_TAX_RATE * 100).toFixed(2)}%`;
}

export function isRefundItem(item: AccountingBillingItem) {
  return item.title === REFUND_TITLE || item.category === "refund";
}

export function billingCategoryLabel(category: string) {
  if (category === "tuition") return "月謝";
  if (category === "trip") return "遠征費";
  if (category === "event") return "大会・イベント費";
  if (category === "uniform") return "ユニフォーム代";
  if (category === "refund") return REFUND_TITLE;
  return "その他";
}

export function billingItemLabel(item: AccountingBillingItem) {
  if (isRefundItem(item)) return REFUND_TITLE;
  return item.title || billingCategoryLabel(item.category);
}

export function deductionItemLabel(item: AccountingBillingItem) {
  const note = item.note?.trim();
  const label = billingItemLabel(item);

  if (!note) return label;

  return `${label}（${note}）`;
}

export function incomeCategoryLabel(category: string) {
  if (category === "sponsorship") return "協賛金";
  return "その他収入";
}

function sumBillingItemAmounts(items: AccountingBillingItem[]) {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

function sumIncomeItemAmounts(items: AccountingIncomeItem[]) {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

export function buildAccountingReport(input: {
  coaches: AccountingCoach[];
  logs: AccountingCoachWorkLog[];
  billingItems: AccountingBillingItem[];
  incomeItems: AccountingIncomeItem[];
}) {
  const summaryByCoach = new Map<
    string,
    {
      coachingMinutes: number;
      adminMinutes: number;
      travelExpense: number;
      otherExpense: number;
    }
  >();

  for (const coach of input.coaches) {
    summaryByCoach.set(coach.id, {
      coachingMinutes: 0,
      adminMinutes: 0,
      travelExpense: 0,
      otherExpense: 0,
    });
  }

  for (const log of input.logs) {
    const summary = summaryByCoach.get(log.coach_id);

    if (!summary) continue;

    summary.coachingMinutes += log.coaching_minutes;
    summary.adminMinutes += log.admin_minutes;
    summary.travelExpense += log.travel_expense;
    summary.otherExpense += log.other_expense;
  }

  const deductionItemsByCoach = new Map<string, AccountingBillingItem[]>();

  for (const item of input.billingItems) {
    if (item.status !== "unpaid" || isRefundItem(item)) continue;

    const list = deductionItemsByCoach.get(item.user_id) ?? [];
    list.push(item);
    deductionItemsByCoach.set(item.user_id, list);
  }

  const rows = input.coaches.map((coach): AccountingReportRow => {
    const summary = summaryByCoach.get(coach.id);
    const coachingMinutes = summary?.coachingMinutes ?? 0;
    const adminMinutes = summary?.adminMinutes ?? 0;
    const travelExpense = summary?.travelExpense ?? 0;
    const otherExpense = summary?.otherExpense ?? 0;
    const totalWorkMinutes = coachingMinutes + adminMinutes;
    const grossReward = calculateGrossReward(totalWorkMinutes);
    const withholdingTax = calculateWithholdingTax(grossReward);
    const reimbursedExpense = travelExpense + otherExpense;
    const deductionItems = deductionItemsByCoach.get(coach.id) ?? [];
    const unpaidDeductionTotal = sumBillingItemAmounts(deductionItems);

    return {
      coachId: coach.id,
      coachName: coach.name,
      coachingMinutes,
      adminMinutes,
      totalWorkMinutes,
      grossReward,
      withholdingTax,
      taxOfficePayment: withholdingTax,
      reimbursedExpense,
      unpaidDeductionTotal,
      netPay:
        grossReward -
        withholdingTax +
        reimbursedExpense -
        unpaidDeductionTotal,
      deductionItems,
    };
  });

  const paidTuitionTotal = sumBillingItemAmounts(
    input.billingItems.filter(
      (item) =>
        item.status === "paid" &&
        item.category === "tuition" &&
        !isRefundItem(item)
    )
  );
  const unpaidChargeTotal = sumBillingItemAmounts(
    input.billingItems.filter(
      (item) => item.status === "unpaid" && !isRefundItem(item)
    )
  );
  const paidRefundTotal = sumBillingItemAmounts(
    input.billingItems.filter(
      (item) => item.status === "paid" && isRefundItem(item)
    )
  );
  const unsettledRefundTotal = sumBillingItemAmounts(
    input.billingItems.filter(
      (item) => item.status === "unpaid" && isRefundItem(item)
    )
  );
  const sponsorshipTotal = sumIncomeItemAmounts(
    input.incomeItems.filter((item) => item.category === "sponsorship")
  );
  const otherIncomeTotal = sumIncomeItemAmounts(
    input.incomeItems.filter((item) => item.category !== "sponsorship")
  );
  const incomeItemsTotal = sponsorshipTotal + otherIncomeTotal;
  const grossRewardTotal = rows.reduce((sum, row) => sum + row.grossReward, 0);
  const withholdingTaxTotal = rows.reduce(
    (sum, row) => sum + row.taxOfficePayment,
    0
  );
  const reimbursedExpenseTotal = rows.reduce(
    (sum, row) => sum + row.reimbursedExpense,
    0
  );
  const unpaidDeductionTotal = rows.reduce(
    (sum, row) => sum + row.unpaidDeductionTotal,
    0
  );
  const netPayTotal = rows.reduce((sum, row) => sum + row.netPay, 0);
  const remainingUnpaidChargeTotal = Math.max(
    0,
    unpaidChargeTotal - unpaidDeductionTotal
  );
  const incomeTotal = paidTuitionTotal + incomeItemsTotal + unpaidDeductionTotal;
  const expenseTotal = grossRewardTotal + reimbursedExpenseTotal + paidRefundTotal;
  const totals: AccountingReportTotals = {
    paidTuitionTotal,
    sponsorshipTotal,
    otherIncomeTotal,
    incomeItemsTotal,
    unpaidChargeTotal,
    remainingUnpaidChargeTotal,
    paidRefundTotal,
    unsettledRefundTotal,
    grossRewardTotal,
    withholdingTaxTotal,
    reimbursedExpenseTotal,
    unpaidDeductionTotal,
    netPayTotal,
    incomeTotal,
    expenseTotal,
    balance: incomeTotal - expenseTotal,
  };

  return {
    rows,
    totals,
  };
}
