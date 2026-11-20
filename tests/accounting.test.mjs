import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers.mjs";

const { buildAccountingReport, buildCumulativeAccountingBalance } = loadTs("src/lib/accounting.ts");
const { isValidTargetMonth, isValidDate } = loadTs("src/lib/month.ts");
const { parseBankCsv } = loadTs("src/lib/bankReconciliation.ts");
const { fetchAllRows } = loadTs("src/lib/pagination.ts");
const bill = (overrides = {}) => ({ id: "bill", user_id: "coach", target_month: "2026-07", category: "other",
  title: "その他請求", amount: 245, status: "unpaid", note: null, ...overrides });
const input = {
  coaches: [{ id: "coach", name: "検証コーチ", coach_hourly_rate: 1000 }],
  logs: [
    { coach_id: "coach", work_date: "2026-07-14", coaching_minutes: 59, admin_minutes: 0, travel_expense: 1, other_expense: 0 },
    { coach_id: "coach", work_date: "2026-07-15", coaching_minutes: 0, admin_minutes: 60, travel_expense: 999, other_expense: 1 },
    { coach_id: "coach", work_date: "2026-07-16", coaching_minutes: 61, admin_minutes: 0, travel_expense: 0, other_expense: 1000 },
  ],
  rewardAdjustments: [{ id: "adjust", coach_id: "coach", starts_on: "2026-07-15", ends_on: "2026-07-15", pay_rate_percent: 50, note: null }],
  billingItems: [bill(), bill({ id: "tuition", user_id: "user", category: "tuition", amount: 5000, status: "paid" }),
    bill({ id: "refund", user_id: "user", title: "返金", amount: 2000, status: "paid" })],
  incomeItems: [{ id: "income", received_on: "2026-07-01", payer_name: "検証", category: "sponsorship", title: "協賛金", amount: 3001, note: null }],
  expenseItems: [{ id: "expense", spent_on: "2026-07-01", payee_name: "検証", category: "other", title: "出費", amount: 1001, note: null }],
};

test("立替を含む振込額、返金を含む出費、相殺後の収支が実入出金と一致する", () => {
  const before = buildAccountingReport(input);
  assert.equal(before.rows[0].grossReward, 2500);
  assert.equal(before.rows[0].withholdingTax, 255);
  assert.equal(before.rows[0].reimbursedExpense, 2001);
  assert.equal(before.rows[0].netPay, 4001);
  assert.equal(before.totals.expenseTotal, 7502);
  const after = buildAccountingReport({ ...input, billingItems: input.billingItems.map((item) => item.id === "bill"
    ? { ...item, status: "paid", coach_payment_transaction_id: "transfer" } : item) });
  assert.equal(after.rows[0].netPay, before.rows[0].netPay);
  assert.equal(after.rows[0].pendingDeductionTotal, 0);
  assert.equal(after.totals.balance, 8001 - (4001 + 255 + 1001 + 2000));
});

test("遠征費などの支払済み請求も収入へ含め、未払い・返金・免除は除く", () => {
  const report = buildAccountingReport({ coaches: [], billingItems: [bill({ category: "trip", amount: 3000, status: "paid" }),
    bill({ amount: 100, status: "exempt" }), bill({ amount: 200, status: "unpaid" }), bill({ amount: 50, title: "返金", status: "paid" })] });
  assert.equal(report.totals.incomeTotal, 3000);
  assert.equal(report.totals.expenseTotal, 50);
});

test("全額相殺できない請求を残し、振込額を負にしない", () => {
  const report = buildAccountingReport({ ...input, billingItems: [bill({ id: "large", amount: 100000 }), bill()] });
  assert.deepEqual(report.rows[0].deductionItems.map((item) => item.id), ["bill"]);
  assert.equal(report.rows[0].netPay, 4001);
  assert.equal(report.totals.remainingUnpaidChargeTotal, 100000);
});

test("累計は月ごとの税の丸め・請求相殺を合計する", () => {
  const reportInput = { coaches: input.coaches, logs: [1, 2].map((month) => ({ coach_id: "coach", work_date: `2026-0${month}-01`,
    coaching_minutes: 1, admin_minutes: 0, travel_expense: 0, other_expense: 0 })) };
  const expected = [1, 2].reduce((sum, month) => sum + buildAccountingReport({ ...reportInput,
    logs: reportInput.logs.filter((log) => log.work_date === `2026-0${month}-01`) }).totals.balance, 0);
  assert.equal(buildCumulativeAccountingBalance(reportInput), expected);
});

test("対象月・実在日付を厳密に検証する", () => {
  for (const value of ["2026-00", "2026-13", "0000-01", "2026-1", "2026-11\n"]) assert.equal(isValidTargetMonth(value), false, value);
  assert.equal(isValidTargetMonth("2026-11"), true);
  assert.equal(isValidDate("2024-02-29"), true);
  for (const value of ["2026-02-29", "2026-04-31", "0000-01-01", "2026-13-01"]) assert.equal(isValidDate(value), false, value);
});

test("UTF-8（BOMあり・なし）とCP932を文字化けせず読み取る", () => {
  const prefix = "Bank,Branch,Normal,1234567,20261101,20261130,now\n001,2026/11/20,0,5000,";
  for (const bom of ["", "\uFEFF"]) {
    assert.equal(parseBankCsv(new TextEncoder().encode(`${bom}${prefix}テスト,0\n`).buffer).transactions[0].description, "テスト");
  }
  const sjis = Buffer.concat([Buffer.from(prefix), Buffer.from("836583588367", "hex"), Buffer.from(",0\n")]);
  assert.equal(parseBankCsv(Uint8Array.from(sjis).buffer).transactions[0].description, "テスト");
});

test("不正な文字コード・日付・入出金方向を拒否する", () => {
  assert.throws(() => parseBankCsv(Uint8Array.from([0xff, 0xff, 0xff]).buffer));
  for (const row of ["001,2026/02/29,0,1,test,0", "001,2026/11/20,1,1,test,0"]) {
    assert.throws(() => parseBankCsv(new TextEncoder().encode(`Bank,Branch,Normal,1234567,,,now\n${row}`).buffer));
  }
});

test("5,000行・1,000行境界のページを漏れなく取得し、途中の失敗では部分集計を返さない", async () => {
  const source = Array.from({ length: 5000 }, (_, id) => ({ id }));
  let calls = 0;
  const result = await fetchAllRows(async (from, to) => { calls++; return { data: source.slice(from, to + 1), error: null }; });
  assert.deepEqual(result.data, source);
  assert.equal(calls, 11);
  const failed = await fetchAllRows(async (from, to) => from ? { data: null, error: { message: "失敗" } }
    : { data: source.slice(from, to + 1), error: null });
  assert.equal(failed.data, null);
  assert.equal(failed.error.message, "失敗");
});
