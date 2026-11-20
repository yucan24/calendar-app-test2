import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, createTeam, importTransactions, transactionId, loadTs, postgresClient } from "./helpers.mjs";

let db;
before(async () => { db = await createTestDatabase(); });
after(async () => { await db?.close(); });

function actionsFor(team) {
  const mocks = {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth": { requireAdmin: async () => ({ id: team.adminId, group_id: team.groupId }) },
    "@/lib/supabase": { supabase: postgresClient(db) },
    "@/lib/month": loadTs("src/lib/month.ts"),
    "@/lib/accounting": loadTs("src/lib/accounting.ts"),
    "@/lib/pagination": loadTs("src/lib/pagination.ts"),
    "@/lib/bankReconciliation": loadTs("src/lib/bankReconciliation.ts"),
  };
  const report = loadTs("src/app/admin/bank-reconciliation/paymentReport.ts", mocks);
  return {
    ...loadTs("src/app/admin/users/actions.ts", mocks),
    ...loadTs("src/app/admin/bank-reconciliation/actions.ts", { ...mocks, "./paymentReport": report }),
    ...loadTs("src/app/admin/accounting/actions.ts", { ...mocks, "../bank-reconciliation/paymentReport": report }),
    ...report,
  };
}
const form = (values) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
async function recordWork(team, travelExpense) {
  await db.query("insert into coach_work_logs(group_id,coach_id,work_date,coaching_minutes,travel_expense) values($1,$2,'2026-11-01',60,$3)", [team.groupId, team.adminId, travelExpense]);
}

test("実際のServer Actionで請求作成・分割給与照合・相殺保護・取消まで連携する", async () => {
  const team = await createTeam(db);
  const actions = actionsFor(team);
  await recordWork(team, 10);
  await actions.createBillingItem(form({ user_id: team.adminId, target_month: "2026-11", category: "other", amount: "245" }));
  const billId = (await db.query("select id from billing_items where group_id=$1", [team.groupId])).rows[0].id;
  await importTransactions(db, team, [{ bankTransactionId: "ACTION1", withdrawalAmount: 300 }, { bankTransactionId: "ACTION2", withdrawalAmount: 363 }]);
  const ids = await Promise.all(["ACTION1", "ACTION2"].map((value) => transactionId(db, team, value)));
  for (const id of ids) await actions.matchTransactionToCoachNetPay(form({ transaction_id: id, coach_id: team.adminId, target_month: "2026-11" }));
  const row = (await actions.buildMonthlyVirtualPaymentReport({ id: team.adminId, group_id: team.groupId }, "2026-11")).rows[0];
  assert.equal(row.netPay, 663);
  assert.equal(row.pendingDeductionTotal, 0);
  await assert.rejects(actions.updateBillingItemStatus(form({ item_id: billId, status: "unpaid" })), /相殺済み/);
  await actions.cancelBankTransactionMatch(form({ transaction_id: ids[1] }));
  assert.equal((await db.query("select status from billing_items where id=$1", [billId])).rows[0].status, "unpaid");
  await actions.updateBillingItemStatus(form({ item_id: billId, status: "exempt" }));
  assert.equal((await db.query("select status from billing_items where id=$1", [billId])).rows[0].status, "exempt");
});

test("振込なしの相殺は実際の報酬計算に一致する場合だけ確定できる", async () => {
  const team = await createTeam(db);
  const actions = actionsFor(team);
  await recordWork(team, 0);
  await actions.createBillingItem(form({ user_id: team.adminId, target_month: "2026-11", category: "tuition", amount: "898" }));
  const values = form({ coach_id: team.adminId, target_month: "2026-11" });
  await actions.settleCoachOffsetsWithoutTransfer(values);
  assert.equal((await db.query("select status from billing_items where group_id=$1", [team.groupId])).rows[0].status, "paid");
  await assert.rejects(actions.settleCoachOffsetsWithoutTransfer(values), /振込額が0円/);
  await actions.cancelCoachOffsetsWithoutTransfer(values);
  assert.equal((await db.query("select status from billing_items where group_id=$1", [team.groupId])).rows[0].status, "unpaid");
});
