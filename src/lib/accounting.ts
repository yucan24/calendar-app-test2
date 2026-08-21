export type AccountingCoach = {
  id: string;
  name: string;
  coach_hourly_rate?: number | null;
};

export type AccountingCoachWorkLog = {
  coach_id: string;
  work_date: string;
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

export type AccountingExpenseItem = {
  id: string;
  spent_on: string;
  payee_name: string;
  category: string;
  title: string;
  amount: number;
  note: string | null;
};

export type AccountingRewardAdjustment = {
  id: string;
  coach_id: string;
  coach_name?: string;
  starts_on: string;
  ends_on: string | null;
  pay_rate_percent: number;
  note: string | null;
};

export type AccountingReportRow = {
  coachId: string;
  coachName: string;
  hourlyRate: number;
  coachingMinutes: number;
  adminMinutes: number;
  totalWorkMinutes: number;
  baseReward: number;
  rewardCutTotal: number;
  grossReward: number;
  withholdingTax: number;
  taxOfficePayment: number;
  reimbursedExpense: number;
  unpaidDeductionTotal: number;
  netPayBeforeDeduction: number;
  netPay: number;
  deductionItems: AccountingBillingItem[];
  rewardAdjustments: AccountingRewardAdjustment[];
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
  eventExpenseTotal: number;
  otherExpenseTotal: number;
  expenseItemsTotal: number;
  baseRewardTotal: number;
  rewardCutTotal: number;
  grossRewardTotal: number;
  withholdingTaxTotal: number;
  reimbursedExpenseTotal: number;
  unpaidDeductionTotal: number;
  netPayBeforeDeductionTotal: number;
  netPayTotal: number;
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
};

export const COACH_HOURLY_RATE = 1000;
export const WITHHOLDING_TAX_RATE = 0.1021;

const REFUND_TITLE = "返金";

export function normalizeCoachHourlyRate(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return COACH_HOURLY_RATE;
  }

  return value;
}

export function calculateGrossReward(minutes: number, hourlyRate: number) {
  return Math.round((minutes / 60) * hourlyRate);
}

export function calculateAdjustedReward(
  baseReward: number,
  payRatePercent: number
) {
  return Math.round((baseReward * payRatePercent) / 100);
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

export function expenseCategoryLabel(category: string) {
  if (category === "event") return "大会・イベント費";
  if (category === "fee") return "手数料";
  return "その他出費";
}

function sumBillingItemAmounts(items: AccountingBillingItem[]) {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

function sumIncomeItemAmounts(items: AccountingIncomeItem[]) {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

function sumExpenseItemAmounts(items: AccountingExpenseItem[]) {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

function findRewardAdjustment(
  adjustments: AccountingRewardAdjustment[],
  coachId: string,
  workDate: string
) {
  return adjustments
    .filter(
      (adjustment) =>
        adjustment.coach_id === coachId &&
        adjustment.starts_on <= workDate &&
        (!adjustment.ends_on || adjustment.ends_on >= workDate)
    )
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0];
}

export function buildAccountingReport(input: {
  coaches: AccountingCoach[];
  logs?: AccountingCoachWorkLog[];
  billingItems?: AccountingBillingItem[];
  incomeItems?: AccountingIncomeItem[];
  expenseItems?: AccountingExpenseItem[];
  rewardAdjustments?: AccountingRewardAdjustment[];
}) {
  const logs = input.logs ?? [];
  const billingItems = input.billingItems ?? [];
  const incomeItems = input.incomeItems ?? [];
  const expenseItems = input.expenseItems ?? [];
  const rewardAdjustments = input.rewardAdjustments ?? [];
  const summaryByCoach = new Map<
    string,
    {
      coachingMinutes: number;
      adminMinutes: number;
      travelExpense: number;
      otherExpense: number;
      hourlyRate: number;
      baseReward: number;
      grossReward: number;
      rewardCutTotal: number;
      rewardAdjustments: Map<string, AccountingRewardAdjustment>;
    }
  >();

  for (const coach of input.coaches) {
    const hourlyRate = normalizeCoachHourlyRate(coach.coach_hourly_rate);

    summaryByCoach.set(coach.id, {
      coachingMinutes: 0,
      adminMinutes: 0,
      travelExpense: 0,
      otherExpense: 0,
      hourlyRate,
      baseReward: 0,
      grossReward: 0,
      rewardCutTotal: 0,
      rewardAdjustments: new Map(),
    });
  }

  for (const log of logs) {
    const summary = summaryByCoach.get(log.coach_id);

    if (!summary) continue;

    const workMinutes = log.coaching_minutes + log.admin_minutes;
    const baseReward = calculateGrossReward(workMinutes, summary.hourlyRate);
    const rewardAdjustment = findRewardAdjustment(
      rewardAdjustments,
      log.coach_id,
      log.work_date
    );
    const adjustedReward = rewardAdjustment
      ? calculateAdjustedReward(baseReward, rewardAdjustment.pay_rate_percent)
      : baseReward;

    summary.coachingMinutes += log.coaching_minutes;
    summary.adminMinutes += log.admin_minutes;
    summary.travelExpense += log.travel_expense;
    summary.otherExpense += log.other_expense;
    summary.baseReward += baseReward;
    summary.grossReward += adjustedReward;
    summary.rewardCutTotal += baseReward - adjustedReward;

    if (rewardAdjustment) {
      summary.rewardAdjustments.set(rewardAdjustment.id, rewardAdjustment);
    }
  }

  const deductionItemsByCoach = new Map<string, AccountingBillingItem[]>();

  for (const item of billingItems) {
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
    const hourlyRate = normalizeCoachHourlyRate(
      summary?.hourlyRate ?? coach.coach_hourly_rate
    );
    const totalWorkMinutes = coachingMinutes + adminMinutes;
    const baseReward = summary?.baseReward ?? 0;
    const grossReward = summary?.grossReward ?? 0;
    const rewardCutTotal = summary?.rewardCutTotal ?? 0;
    const withholdingTax = calculateWithholdingTax(grossReward);
    const reimbursedExpense = travelExpense + otherExpense;
    const deductionItems = deductionItemsByCoach.get(coach.id) ?? [];
    const unpaidDeductionTotal = sumBillingItemAmounts(deductionItems);
    const netPayBeforeDeduction = grossReward - withholdingTax;

    return {
      coachId: coach.id,
      coachName: coach.name,
      hourlyRate,
      coachingMinutes,
      adminMinutes,
      totalWorkMinutes,
      baseReward,
      rewardCutTotal,
      grossReward,
      withholdingTax,
      taxOfficePayment: withholdingTax,
      reimbursedExpense,
      unpaidDeductionTotal,
      netPayBeforeDeduction,
      netPay: netPayBeforeDeduction - unpaidDeductionTotal,
      deductionItems,
      rewardAdjustments: summary
        ? Array.from(summary.rewardAdjustments.values())
        : [],
    };
  });

  const paidTuitionTotal = sumBillingItemAmounts(
    billingItems.filter(
      (item) =>
        item.status === "paid" &&
        item.category === "tuition" &&
        !isRefundItem(item)
    )
  );
  const unpaidChargeTotal = sumBillingItemAmounts(
    billingItems.filter(
      (item) => item.status === "unpaid" && !isRefundItem(item)
    )
  );
  const paidRefundTotal = sumBillingItemAmounts(
    billingItems.filter(
      (item) => item.status === "paid" && isRefundItem(item)
    )
  );
  const unsettledRefundTotal = sumBillingItemAmounts(
    billingItems.filter(
      (item) => item.status === "unpaid" && isRefundItem(item)
    )
  );
  const sponsorshipTotal = sumIncomeItemAmounts(
    incomeItems.filter((item) => item.category === "sponsorship")
  );
  const otherIncomeTotal = sumIncomeItemAmounts(
    incomeItems.filter((item) => item.category !== "sponsorship")
  );
  const incomeItemsTotal = sponsorshipTotal + otherIncomeTotal;
  const eventExpenseTotal = sumExpenseItemAmounts(
    expenseItems.filter((item) => item.category === "event")
  );
  const otherExpenseTotal = sumExpenseItemAmounts(
    expenseItems.filter((item) => item.category !== "event")
  );
  const expenseItemsTotal = eventExpenseTotal + otherExpenseTotal;
  const baseRewardTotal = rows.reduce((sum, row) => sum + row.baseReward, 0);
  const rewardCutTotal = rows.reduce((sum, row) => sum + row.rewardCutTotal, 0);
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
  const netPayBeforeDeductionTotal = rows.reduce(
    (sum, row) => sum + row.netPayBeforeDeduction,
    0
  );
  const netPayTotal = rows.reduce((sum, row) => sum + row.netPay, 0);
  const remainingUnpaidChargeTotal = Math.max(
    0,
    unpaidChargeTotal - unpaidDeductionTotal
  );
  const incomeTotal = paidTuitionTotal + incomeItemsTotal;
  const expenseTotal =
    netPayBeforeDeductionTotal + withholdingTaxTotal + expenseItemsTotal;
  const totals: AccountingReportTotals = {
    paidTuitionTotal,
    sponsorshipTotal,
    otherIncomeTotal,
    incomeItemsTotal,
    unpaidChargeTotal,
    remainingUnpaidChargeTotal,
    paidRefundTotal,
    unsettledRefundTotal,
    eventExpenseTotal,
    otherExpenseTotal,
    expenseItemsTotal,
    baseRewardTotal,
    rewardCutTotal,
    grossRewardTotal,
    withholdingTaxTotal,
    reimbursedExpenseTotal,
    unpaidDeductionTotal,
    netPayBeforeDeductionTotal,
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
