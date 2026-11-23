import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, createTeam, importTransactions, transactionId, loadTs } from "./helpers.mjs";

let db;
before(async () => { db = await createTestDatabase(); });
after(async () => { await db?.close(); });
const billing = async (team, amount = 245, month = "2026-11") => (await db.query(
  "insert into billing_items(group_id,user_id,target_month,category,title,amount) values($1,$2,$3,'other','検証請求',$4) returning id",
  [team.groupId, team.adminId, month, amount])).rows[0].id;
const state = async (id) => (await db.query("select status,coach_payment_transaction_id from billing_items where id=$1", [id])).rows[0];
const payCoach = async (team, id, bills, complete = false) => db.query(
  "select match_bank_transaction_coach_payment($1,$2,$3,'2026-11',4001,$4::uuid[],$5,'検証')",
  [team.adminId, id, team.adminId, bills, complete]);

test("同一CSVの再取込は増えず、訂正版は内容相違として警告し、既存値を保持する", async () => {
  const team = await createTeam(db);
  const transaction = { bankTransactionId: "DUP", depositAmount: 5000 };
  assert.equal((await importTransactions(db, team, [transaction])).imported_count, 1);
  assert.equal((await importTransactions(db, team, [transaction])).skipped_count, 1);
  const changed = await importTransactions(db, team, [{ ...transaction, depositAmount: 5001 }]);
  assert.equal(changed.conflict_count, 1);
  assert.deepEqual(changed.conflict_transaction_ids, ["DUP"]);
  assert.equal((await db.query("select deposit_amount from bank_transactions where group_id=$1", [team.groupId])).rows[0].deposit_amount, 5000);
  const history = (await db.query("select * from list_bank_csv_imports($1,10)", [team.adminId])).rows;
  assert.equal(history.reduce((sum, row) => sum + row.conflict_count, 0), 1);
});

test("別口座で同じ取引番号を保持し、口座表記の全半角・空白差では重複登録しない", async () => {
  const team = await createTeam(db);
  const transaction = { bankTransactionId: "SAME", depositAmount: 1000 };
  await importTransactions(db, team, [transaction], "1234567");
  assert.equal((await importTransactions(db, team, [transaction], "7654321")).imported_count, 1);
  assert.equal((await importTransactions(db, team, [transaction], "１２３４５６７")).skipped_count, 1);
  const rows = (await db.query("select * from list_bank_transactions($1)", [team.adminId])).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.account_label.includes("末尾")));
});

test("給与の分割払いは最終支払いで請求を相殺し、途中の送金を取り消すと未払いへ復元する", async () => {
  const team = await createTeam(db);
  const billId = await billing(team);
  await importTransactions(db, team, [{ bankTransactionId: "PAY1", withdrawalAmount: 2000 }, { bankTransactionId: "PAY2", withdrawalAmount: 2001 }]);
  const first = await transactionId(db, team, "PAY1");
  const second = await transactionId(db, team, "PAY2");
  await payCoach(team, first, [billId]);
  assert.equal((await state(billId)).status, "unpaid");
  await payCoach(team, second, [billId]);
  assert.deepEqual(await state(billId), { status: "paid", coach_payment_transaction_id: second });
  let totals = (await db.query("select * from list_bank_payment_totals($1,'2026-11')", [team.adminId])).rows[0];
  assert.equal(Number(totals.amount), 4001);
  assert.equal(totals.settled, true);
  await db.query("select cancel_bank_transaction_match($1,$2)", [team.adminId, first]);
  assert.deepEqual(await state(billId), { status: "unpaid", coach_payment_transaction_id: null });
  totals = (await db.query("select * from list_bank_payment_totals($1,'2026-11')", [team.adminId])).rows[0];
  assert.equal(Number(totals.amount), 2001);
  assert.equal(totals.settled, false);
  await payCoach(team, first, [billId]);
  assert.equal((await state(billId)).status, "paid");
  await db.query("select cancel_bank_transaction_match($1,$2)", [team.adminId, second]);
  assert.equal((await state(billId)).status, "unpaid");
});

test("1円不足でも管理者が精算完了を指定でき、取消で相殺を戻す", async () => {
  const team = await createTeam(db);
  const billId = await billing(team);
  await importTransactions(db, team, [{ bankTransactionId: "SHORT", withdrawalAmount: 4000 }]);
  const id = await transactionId(db, team, "SHORT");
  await payCoach(team, id, [billId], true);
  assert.equal((await state(billId)).status, "paid");
  await db.query("select cancel_bank_transaction_match($1,$2)", [team.adminId, id]);
  assert.equal((await state(billId)).status, "unpaid");
});

test("源泉税を分割納付し、片方だけ取り消せる", async () => {
  const team = await createTeam(db);
  await importTransactions(db, team, [{ bankTransactionId: "TAX1", withdrawalAmount: 100 }, { bankTransactionId: "TAX2", withdrawalAmount: 155 }]);
  const ids = await Promise.all(["TAX1", "TAX2"].map((id) => transactionId(db, team, id)));
  for (const id of ids) await db.query("select match_bank_transaction_virtual_payment($1,$2,'tax_payment',null,'2026-11',255,'')", [team.adminId, id]);
  assert.equal(Number((await db.query("select amount from list_bank_payment_totals($1,'2026-11')", [team.adminId])).rows[0].amount), 255);
  await db.query("select cancel_bank_transaction_match($1,$2)", [team.adminId, ids[0]]);
  assert.equal(Number((await db.query("select amount from list_bank_payment_totals($1,'2026-11')", [team.adminId])).rows[0].amount), 155);
});

test("相殺済み請求の手動変更と他チームの請求相殺を拒否する", async () => {
  const team = await createTeam(db);
  const other = await createTeam(db);
  const billId = await billing(team);
  const foreignBill = await billing(other);
  await importTransactions(db, team, [{ bankTransactionId: "SEC", withdrawalAmount: 4001 }]);
  const id = await transactionId(db, team, "SEC");
  await assert.rejects(payCoach(team, id, [foreignBill]), /invalid billing item selection/);
  await payCoach(team, id, [billId]);
  await db.exec("set role service_role");
  try {
    await assert.rejects(db.query("update billing_items set status='unpaid' where id=$1", [billId]), /先に銀行照合/);
    await assert.rejects(db.query("update billing_items set coach_payment_transaction_id=null where id=$1", [billId]), /先に銀行照合/);
  } finally { await db.exec("reset role"); }
  assert.equal((await state(foreignBill)).status, "unpaid");
});

test("同じ明細の二重処理を拒否し、取消で銀行明細も未処理へ戻す", async () => {
  const team = await createTeam(db);
  await importTransactions(db, team, [{ bankTransactionId: "TWICE", withdrawalAmount: 4001 }]);
  const id = await transactionId(db, team, "TWICE");
  const results = await Promise.allSettled([payCoach(team, id, []), payCoach(team, id, [])]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  await db.query("select cancel_bank_transaction_match($1,$2)", [team.adminId, id]);
  assert.equal((await db.query("select status from bank_transactions where id=$1", [id])).rows[0].status, "unmatched");
});

test("不正対象月を請求・支払照合・月次RPCで拒否する", async () => {
  const team = await createTeam(db);
  await importTransactions(db, team, [{ bankTransactionId: "MONTH", withdrawalAmount: 1 }]);
  const id = await transactionId(db, team, "MONTH");
  for (const month of ["2026-00", "2026-13", "0000-01"]) {
    await assert.rejects(billing(team, 1, month));
    await assert.rejects(db.query("select match_bank_transaction_virtual_payment($1,$2,'tax_payment',null,$3,1,'')", [team.adminId, id, month]), /invalid target month/);
    await assert.rejects(db.query("select * from list_accounting_income_items($1,$2)", [team.adminId, month]), /invalid target month/);
  }
});

test("5,000件を取込・ページ取得でき、5,001件は全体を拒否する", async () => {
  const team = await createTeam(db);
  const transactions = Array.from({ length: 5000 }, (_, index) => ({ bankTransactionId: `VOLUME-${index}`, depositAmount: 1 }));
  assert.equal((await importTransactions(db, team, transactions)).imported_count, 5000);
  const { fetchAllRows } = loadTs("src/lib/pagination.ts");
  const result = await fetchAllRows(async (from, to) => ({ error: null, data: (await db.query(
    "select * from list_bank_transactions($1) order by id limit $2 offset $3", [team.adminId, to - from + 1, from])).rows }));
  assert.equal(result.data.length, 5000);
  assert.equal(new Set(result.data.map((row) => row.id)).size, 5000);
  await assert.rejects(importTransactions(db, team, [...transactions, { bankTransactionId: "OVER", depositAmount: 1 }]), /invalid transaction count/);
  assert.equal((await db.query("select count(*)::int as count from bank_transactions where group_id=$1", [team.groupId])).rows[0].count, 5000);
});

test("振込なしの全額相殺を確定・取消でき、二重精算を拒否する", async () => {
  const team = await createTeam(db);
  const billId = await billing(team, 898);
  await db.query("select settle_coach_offsets_without_transfer($1,$2,'2026-11',$3::uuid[],898)", [team.adminId, team.adminId, [billId]]);
  assert.equal((await state(billId)).status, "paid");
  const item = (await db.query("select * from billing_items where id=$1", [billId])).rows[0];
  const { buildAccountingReport } = loadTs("src/lib/accounting.ts");
  const report = buildAccountingReport({ coaches: [{ id: team.adminId, name: "検証", coach_hourly_rate: 1000 }],
    logs: [{ coach_id: team.adminId, work_date: "2026-11-01", coaching_minutes: 60, admin_minutes: 0, travel_expense: 0, other_expense: 0 }],
    billingItems: [item] });
  assert.equal(report.rows[0].netPay, 0);
  assert.equal(report.rows[0].pendingDeductionTotal, 0);
  await assert.rejects(db.query("select settle_coach_offsets_without_transfer($1,$2,'2026-11',$3::uuid[],898)", [team.adminId, team.adminId, [billId]]));
  await db.query("select cancel_coach_offsets_without_transfer($1,$2,'2026-11')", [team.adminId, team.adminId]);
  assert.equal((await state(billId)).status, "unpaid");
  assert.equal((await db.query("select coach_payment_offset_month from billing_items where id=$1", [billId])).rows[0].coach_payment_offset_month, null);
});

test("既存の不正対象月を失わずにmigrationを適用でき、新規の不正月は拒否する", async () => {
  let oldTeam;
  const legacyDb = await createTestDatabase(async (connection) => {
    oldTeam = await createTeam(connection);
    await connection.query("insert into billing_items(group_id,user_id,target_month,category,title,amount) values($1,$2,'2026-13','other','既存データ',1)", [oldTeam.groupId, oldTeam.adminId]);
  });
  try {
    assert.equal((await legacyDb.query("select count(*)::int as count from billing_items where target_month='2026-13'")).rows[0].count, 1);
    await assert.rejects(legacyDb.query("insert into billing_items(group_id,user_id,target_month,category,title,amount) values($1,$2,'2026-00','other','新規データ',1)", [oldTeam.groupId, oldTeam.adminId]));
  } finally { await legacyDb.close(); }
});
