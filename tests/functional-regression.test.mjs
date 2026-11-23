import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTestDatabase, createTeam, importTransactions, transactionId, loadTs, postgresClient } from "./helpers.mjs";

let db;
before(async () => { db = await createTestDatabase(); });
after(async () => { await db?.close(); });
const form = (values) => { const f = new FormData(); for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) f.append(key, item); return f; };
const count = async (table, group) => (await db.query(`select count(*)::integer as n from ${table} where group_id=$1`, [group])).rows[0].n;
const member = async (team, suffix = "member", enabled = true) => (await db.query("insert into profiles(group_id,name,role,email,login_code,login_enabled) values($1,$2,'user','member@example.test','1234',$3) returning *", [team.groupId, `${suffix}-${team.groupId}`, enabled])).rows[0];
function actionsFor(team, user) {
  const mocks = {
    "server-only": {}, "next/cache": { revalidatePath() {} },
    "next/navigation": { redirect: (url) => { throw new Error(`redirect:${url}`); } },
    "@/lib/auth": { requireAdmin: async () => ({ id: team.adminId, group_id: team.groupId }), requireUser: async () => ({ id: user?.id ?? team.adminId, group_id: team.groupId }) },
    "@/lib/supabase": { supabase: postgresClient(db) },
    "@/lib/authRateLimit": { allowAuthAttempt: async () => true },
    "@/lib/accountPolicy": loadTs("src/lib/accountPolicy.ts"),
    "@/lib/accountLinks": { sendAccountLink: async () => ({ ok: true, message: "test email" }), notifyRegistration: async () => ({ ok: true }), recordAccountMail: async () => ({ ok: true }) },
    "@/lib/accountEmail": { sendAccountEmail: async () => "disabled", applicationUrl: () => "http://localhost:3010" },
    "@/lib/month": loadTs("src/lib/month.ts"), "@/lib/accounting": loadTs("src/lib/accounting.ts"),
    "@/lib/pagination": loadTs("src/lib/pagination.ts"), "@/lib/bankReconciliation": loadTs("src/lib/bankReconciliation.ts"),
  };
  const report = loadTs("src/app/admin/bank-reconciliation/paymentReport.ts", mocks);
  return { mocks, ...report,
    ...loadTs("src/app/register/actions.ts", mocks), ...loadTs("src/app/admin/members/actions.ts", mocks),
    ...loadTs("src/app/admin/users/actions.ts", mocks), ...loadTs("src/app/admin/coach-work/actions.ts", mocks),
    ...loadTs("src/app/admin/calendar/actions.ts", mocks), ...loadTs("src/app/admin/calendar/[id]/actions.ts", mocks),
    ...loadTs("src/app/user/calendar/[id]/actions.ts", mocks),
    ...loadTs("src/app/admin/bank-reconciliation/actions.ts", { ...mocks, "./paymentReport": report }),
    ...loadTs("src/app/admin/accounting/actions.ts", { ...mocks, "../bank-reconciliation/paymentReport": report }),
  };
}

test("[AUTH-01 MEM-02] 登録→未承認→承認→停止まで、送信された管理者権限を信用しない", async () => {
  const team = await createTeam(db), actions = actionsFor(team), previous = process.env.APP_GROUP_ID;
  process.env.APP_GROUP_ID = team.groupId;
  try {
    const f = form({ name: ` 新 規-${team.groupId}`, email: "new@example.test", login_code: "1234", role: "admin", group_id: "forged" });
    await assert.rejects(actions.registerMember({}, f), /^Error: redirect:\/register\/thanks$/);
    const p = (await db.query("select * from profiles where name=$1", [`新規-${team.groupId}`])).rows[0];
    assert.equal(p.role, "user"); assert.equal(p.group_id, team.groupId); assert.equal(p.login_enabled, false);
    assert.equal(p.login_code_hash, null);
    assert.equal((await db.query("select * from authenticate_app_session($1,'1234',$2)", [p.name, "a".repeat(64)])).rows[0].outcome, "failed");
    await actions.updateMemberLoginEnabled(form({ member_id: p.id, login_enabled: "true" }));
    assert.equal((await db.query("select account_status from profiles where id=$1", [p.id])).rows[0].account_status, "invited");
    await db.query("select * from issue_app_account_token($1,'setup',$2,$3,$4)", [p.id,"b".repeat(64),p.email,team.adminId]);
    await db.query("select consume_app_account_token($1,'1234')", ["b".repeat(64)]);
    assert.equal((await db.query("select * from authenticate_app_session($1,'1234',$2)", [p.name, "a".repeat(64)])).rows[0].outcome, "authenticated");
    await actions.updateMemberLoginEnabled(form({ member_id: p.id, login_enabled: "false" }));
    assert.equal((await db.query("select * from get_app_session_profile($1)", ["a".repeat(64)])).rows.length, 0);
  } finally { if (previous === undefined) delete process.env.APP_GROUP_ID; else process.env.APP_GROUP_ID = previous; }
});

test("[AUTH-01] 登録の必須・メール・重複の入力検証（4桁は承認後に設定）", async () => {
  const team = await createTeam(db), actions = actionsFor(team), previous = process.env.APP_GROUP_ID;
  process.env.APP_GROUP_ID = team.groupId;
  try {
    const values = { name: `new-${team.groupId}`, email: "new@example.test", login_code: "1234" };
    for (const patch of [{ name: " " }, { email: "bad" }, { name: "a".repeat(101) }]) assert.equal((await actions.registerMember({}, form({ ...values, ...patch }))).ok, false);
    await assert.rejects(actions.registerMember({}, form(values)), /^Error: redirect:\/register\/thanks$/);
    assert.equal((await actions.registerMember({}, form(values))).ok, false);
    assert.equal(await count("profiles", team.groupId), 2);
  } finally { if (previous === undefined) delete process.env.APP_GROUP_ID; else process.env.APP_GROUP_ID = previous; }
});

test("[MEM-01 MEM-03 MEM-04] 会員の正常編集・重複・コード検証・他チーム・自己保護", async () => {
  const team = await createTeam(db), other = await createTeam(db), p = await member(team), duplicate = await member(team, "duplicate"), foreign = await member(other), a = actionsFor(team);
  const base = { member_id: p.id, name: ` 変 更-${team.groupId}`, email: "changed@example.test", login_code: "5678" };
  assert.equal((await a.updateMemberProfile({}, form(base))).ok, true);
  assert.equal((await db.query("select name from profiles where id=$1", [p.id])).rows[0].name, `変更-${team.groupId}`);
  assert.equal((await a.updateMemberProfile({}, form({ ...base, name: duplicate.name }))).ok, false);
  const previousHash = (await db.query("select login_code_hash from profiles where id=$1", [p.id])).rows[0].login_code_hash;
  assert.equal((await a.updateMemberProfile({}, form({ ...base, login_code: "12" }))).ok, true);
  assert.equal((await db.query("select login_code_hash from profiles where id=$1", [p.id])).rows[0].login_code_hash, previousHash);
  assert.equal((await a.updateMemberProfile({}, form({ ...base, member_id: foreign.id }))).ok, false);
  await assert.rejects(a.updateMemberLoginEnabled(form({ member_id: team.adminId, login_enabled: "false" })), /自分自身/);
  await assert.rejects(a.updateMemberRole(form({ member_id: team.adminId, role: "user" })), /自分自身/);
  await assert.rejects(a.updateMemberRole(form({ member_id: foreign.id, role: "admin" })), /権限/);
  await assert.rejects(a.updateMemberLoginEnabled(form({ member_id: foreign.id, login_enabled: "false" })), /権限/);
  assert.equal((await db.query("select login_enabled from profiles where id=$1", [foreign.id])).rows[0].login_enabled, true);
  await a.updateMemberRole(form({ member_id: p.id, role: "admin" }));
  assert.equal((await db.query("select role from profiles where id=$1", [p.id])).rows[0].role, "admin");
});

test("[MEM-01] 会員編集でも不正なメールアドレスは保存せず拒否する", async () => {
  const team = await createTeam(db), p = await member(team), a = actionsFor(team);
  const r = await a.updateMemberProfile({}, form({ member_id: p.id, name: p.name, email: "not-an-email", login_code: "1234" }));
  assert.equal(r.ok, false, "登録では拒否するメール形式を編集では受け付けている");
});

test("[WORK-01 WORK-02] 複数指導者・複数日を整理して作成し、時間・実費の編集と削除ができる", async () => {
  const team = await createTeam(db), second = await member(team, "coach"), a = actionsFor(team);
  await db.query("update profiles set role='admin' where id=$1", [second.id]);
  await a.createCoachWorkLogsForDates(form({ coach_ids: [team.adminId, second.id, second.id], date_keys: ["2026-11-01", "2026-11-02", "2026-11-01"], coaching_hours: "2", admin_hours: "1", travel_expense: "120", other_expense: "30" }));
  const rows = (await db.query("select * from coach_work_logs where group_id=$1", [team.groupId])).rows;
  assert.equal(rows.length, 4); assert.equal(new Set(rows.map(r => r.batch_id)).size, 1);
  assert.equal(rows[0].coaching_minutes, 120); assert.equal(rows[0].admin_minutes, 60);
  await a.updateCoachWorkLog(form({ log_id: rows[0].id, coach_id: team.adminId, work_date: "2026-11-03", coaching_hours: "3", admin_hours: "0", travel_expense: "200", other_expense: "10" }));
  assert.equal((await db.query("select travel_expense from coach_work_logs where id=$1", [rows[0].id])).rows[0].travel_expense, 200);
  await a.deleteCoachWorkLog(form({ log_id: rows[0].id })); assert.equal(await count("coach_work_logs", team.groupId), 3);
});

test("[WORK-03] 画面で許可される0.5時間を30分として新規保存できる", async () => {
  const team = await createTeam(db), a = actionsFor(team);
  await a.createCoachWorkLogs(form({ coach_ids: team.adminId, work_date: "2026-11-01", coaching_hours: "0.5", admin_hours: "0.25", travel_expense: "0", other_expense: "0" }));
  const r = (await db.query("select coaching_minutes,admin_minutes from coach_work_logs where group_id=$1", [team.groupId])).rows[0];
  assert.equal(r.coaching_minutes, 30); assert.equal(r.admin_minutes, 15);
});

test("[WORK-03] 取込済み90分を画面の1.5時間のまま再保存できる", async () => {
  const team = await createTeam(db), a = actionsFor(team);
  const r = (await db.query("insert into coach_work_logs(group_id,coach_id,work_date,coaching_minutes,admin_minutes,travel_expense,other_expense) values($1,$2,'2026-11-01',90,45,120,30) returning id", [team.groupId, team.adminId])).rows[0];
  await a.updateCoachWorkLog(form({ log_id: r.id, coach_id: team.adminId, work_date: "2026-11-01", coaching_hours: "1.5", admin_hours: "0.75", travel_expense: "120", other_expense: "30" }));
  assert.deepEqual((await db.query("select coaching_minutes,admin_minutes,travel_expense,other_expense from coach_work_logs where id=$1", [r.id])).rows[0], { coaching_minutes: 90, admin_minutes: 45, travel_expense: 120, other_expense: 30 });
});

test("[WORK-03] 複数指導者・複数日の小数時間を分単位で保存し、会計にも反映する", async () => {
  const team = await createTeam(db), second = await member(team, "fractional-coach"), a = actionsFor(team);
  await db.query("update profiles set role='admin',coach_hourly_rate=1000 where id in ($1,$2)", [team.adminId, second.id]);
  await a.createCoachWorkLogsForDates(form({ coach_ids: [team.adminId, second.id], date_keys: ["2026-11-01", "2026-11-02"], coaching_hours: "1.25", admin_hours: "0.75", travel_expense: "120", other_expense: "30" }));
  const rows = (await db.query("select coaching_minutes,admin_minutes from coach_work_logs where group_id=$1", [team.groupId])).rows;
  assert.equal(rows.length, 4);
  assert.ok(rows.every(r => r.coaching_minutes === 75 && r.admin_minutes === 45));
  const report = await a.buildMonthlyVirtualPaymentReport({ id: team.adminId, group_id: team.groupId }, "2026-11");
  assert.ok(report.rows.every(r => r.grossReward === 4000 && r.reimbursedExpense === 300));
});

test("[WORK-03 WORK-04] 小数時間でも不正値は拒否し、更新失敗時に元の分数・実費を維持する", async () => {
  const team = await createTeam(db), a = actionsFor(team);
  const base = { coach_ids: team.adminId, work_date: "2026-11-01", coaching_hours: "1.5", admin_hours: "0.25", travel_expense: "120", other_expense: "30" };
  await a.createCoachWorkLogs(form(base));
  const original = (await db.query("select * from coach_work_logs where group_id=$1", [team.groupId])).rows[0];
  for (const field of ["coaching_hours", "admin_hours"]) {
    for (const invalid of ["-0.25", "NaN", "Infinity", "0.001", "1000000000"]) {
      await assert.rejects(a.createCoachWorkLogs(form({ ...base, [field]: invalid })));
      await assert.rejects(a.updateCoachWorkLog(form({ ...base, log_id: original.id, coach_id: team.adminId, [field]: invalid })));
    }
  }
  assert.deepEqual((await db.query("select * from coach_work_logs where group_id=$1", [team.groupId])).rows, [original]);
  await a.createCoachWorkLogs(form({ ...base, coaching_hours: "", admin_hours: "" }));
  assert.equal((await db.query("select count(*)::integer as n from coach_work_logs where group_id=$1 and coaching_minutes=0 and admin_minutes=0", [team.groupId])).rows[0].n, 1);
});

test("[WORK-04] 負数・小数金額・不正日付・他チーム指導者は作成を拒否する", async () => {
  const team = await createTeam(db), other = await createTeam(db), a = actionsFor(team);
  const base = { coach_ids: team.adminId, work_date: "2026-11-01", coaching_hours: "1", admin_hours: "0", travel_expense: "0", other_expense: "0" };
  for (const patch of [{ coaching_hours: "-1" }, { travel_expense: "0.5" }, { work_date: "2026-02-30" }, { coach_ids: other.adminId }]) await assert.rejects(a.createCoachWorkLogs(form({ ...base, ...patch })));
  assert.equal(await count("coach_work_logs", team.groupId), 0);
});

test("[CAL-01 CAL-06] 予定の作成・編集・削除とJSTの月末/月初を維持する", async () => {
  const team = await createTeam(db), a = actionsFor(team);
  await a.createAdminCalendarEventFromModal({ dateKey: "2026-11-30", title: "予定", timeText: "18:00-20:00", titleColor: "#123456", isHoliday: true });
  const e = (await db.query("select *,to_char(start_at at time zone 'Asia/Tokyo','YYYY-MM-DD') as date from calendar_events where group_id=$1", [team.groupId])).rows[0];
  assert.equal(e.date, "2026-11-30"); assert.equal(e.title_color, "#123456"); assert.equal(e.is_holiday, true); assert.equal(e.time_text, "18:00-20:00");
  await a.updateAdminCalendarEventFromModal({ eventId: e.id, dateKey: "2026-12-01", title: "変更予定", timeText: "AM" });
  const changed = (await db.query("select title,time_text,to_char(start_at at time zone 'Asia/Tokyo','YYYY-MM-DD') as date from calendar_events where id=$1", [e.id])).rows[0];
  assert.deepEqual(changed, { title: "変更予定", time_text: "AM", date: "2026-12-01" });
  await assert.rejects(a.deleteEvent(form({ id: e.id })), /redirect:/); assert.equal(await count("calendar_events", team.groupId), 0);
});

test("[CAL-02 CAL-05] 複数日の重複を整理し、期間予定の出欠を無効にして不正日を拒否する", async () => {
  const team = await createTeam(db), a = actionsFor(team);
  await a.createAdminCalendarEventsForDates({ dateKeys: ["2026-11-01", "2026-11-02", "2026-11-01"], title: "期間", displayType: "period", attendanceRequired: true });
  const rows = (await db.query("select * from calendar_events where group_id=$1", [team.groupId])).rows;
  assert.equal(rows.length, 2); assert.ok(rows.every(r => !r.attendance_required && r.display_type === "period"));
  await assert.rejects(a.createAdminCalendarEventFromModal({ dateKey: "2026-02-30", title: "不正" }));
  assert.equal(await count("calendar_events", team.groupId), 2);
});

test("[CAL-03 CAL-04] 本人の出欠変更・未回答と他チーム/回答不要の拒否", async () => {
  const team = await createTeam(db), other = await createTeam(db), p = await member(team), a = actionsFor(team, p);
  await a.createAdminCalendarEventFromModal({ dateKey: "2026-11-01", title: "出欠", attendanceRequired: true });
  const e = (await db.query("select id from calendar_events where group_id=$1", [team.groupId])).rows[0];
  for (const status of ["attend", "pending", "absent"]) await assert.rejects(a.submitResponse(form({ event_id: e.id, user_id: other.adminId, status })), /redirect:/);
  assert.deepEqual((await db.query("select user_id,status from event_responses where event_id=$1", [e.id])).rows, [{ user_id: p.id, status: "absent" }]);
  await assert.rejects(a.submitResponse(form({ event_id: e.id, status: "" })), /redirect:/);
  assert.equal((await db.query("select count(*)::integer as n from event_responses where event_id=$1", [e.id])).rows[0].n, 0);
  await assert.rejects(a.updateAdminAttendance(e.id, other.adminId, "attend"), /権限/);
  await db.query("update calendar_events set attendance_required=false where id=$1", [e.id]);
  await assert.rejects(a.submitResponse(form({ event_id: e.id, status: "attend" })), /回答不要/);
});

test("[BILL-01 BILL-03] 全請求カテゴリの状態変更と返金は収入/出費へ正しく反映", async () => {
  const team = await createTeam(db), p = await member(team), a = actionsFor(team);
  for (const category of ["tuition", "trip", "event", "uniform", "other", "refund"]) await a.createBillingItem(form({ user_id: p.id, target_month: "2026-11", category, amount: "100" }));
  const rows = (await db.query("select * from billing_items where group_id=$1", [team.groupId])).rows;
  for (const r of rows) for (const status of ["paid", "exempt", "unpaid", "paid"]) await a.updateBillingItemStatus(form({ item_id: r.id, status }));
  const report = loadTs("src/lib/accounting.ts").buildAccountingReport({ coaches: [], billingItems: (await db.query("select * from billing_items where group_id=$1", [team.groupId])).rows });
  assert.equal(report.totals.incomeTotal, 500); assert.equal(report.totals.paidRefundTotal, 100); assert.equal(report.totals.balance, 400);
  await a.createBillingItem(form({ user_id: p.id, target_month: "2026-11", category: "refund", amount: "0" }));
  assert.equal((await db.query("select count(*)::integer as n from billing_items where group_id=$1 and amount=0", [team.groupId])).rows[0].n, 1);
});

test("[BILL-02] 月謝一括作成は有効な一般会員だけを対象とし再実行しても増えない", async () => {
  const team = await createTeam(db), other = await createTeam(db), a = actionsFor(team);
  await member(team); await member(team, "second"); await member(team, "disabled", false); await member(other);
  const f = form({ target_month: "2026-11", amount: "5000" });
  await a.createTuitionForAllUsers(f); await a.createTuitionForAllUsers(f);
  assert.equal(await count("billing_items", team.groupId), 2);
});

test("[BILL-02] 同月の月謝一括作成が同時に届いても二重請求を作らない", async () => {
  const team = await createTeam(db), a = actionsFor(team); await member(team);
  await Promise.all([a.createTuitionForAllUsers(form({ target_month: "2026-11", amount: "5000" })), a.createTuitionForAllUsers(form({ target_month: "2026-11", amount: "5000" }))]);
  assert.equal(await count("billing_items", team.groupId), 1, "同一会員・同一月の月謝が重複している");
});

test("[BILL-04] 別チームの請求と不正金額・月・状態を拒否する", async () => {
  const team = await createTeam(db), other = await createTeam(db), foreign = await member(other), a = actionsFor(team);
  await assert.rejects(a.createBillingItem(form({ user_id: foreign.id, target_month: "2026-11", category: "tuition", amount: "100" })), /権限/);
  const p = await member(team);
  for (const patch of [{ amount: "-1" }, { amount: "0.5" }, { target_month: "2026-13" }, { category: "unknown" }]) await assert.rejects(a.createBillingItem(form({ user_id: p.id, target_month: "2026-11", category: "tuition", amount: "100", ...patch })));
  assert.equal(await count("billing_items", team.groupId), 0);
});

test("[ACC-02] 時給500/1000円、減額の開始/終了日・翌日、立替の非減額", () => {
  const coaches = [{ id: "a", name: "a", coach_hourly_rate: 1000 }, { id: "b", name: "b", coach_hourly_rate: 500 }];
  const dates = ["2026-07-27", "2026-07-28", "2026-08-28", "2026-08-29"];
  const report = loadTs("src/lib/accounting.ts").buildAccountingReport({ coaches, logs: coaches.flatMap(c => dates.map(date => ({ coach_id: c.id, work_date: date, coaching_minutes: 60, admin_minutes: 0, travel_expense: 100, other_expense: 0 }))), rewardAdjustments: coaches.map(c => ({ id: c.id, coach_id: c.id, starts_on: "2026-07-28", ends_on: "2026-08-28", pay_rate_percent: 50 })) });
  assert.deepEqual(report.rows.map(r => r.grossReward), [3000, 1500]); assert.deepEqual(report.rows.map(r => r.reimbursedExpense), [400, 400]);
});

test("[ACC-03] 手入力の収入・出費・手数料を作成、編集、削除し他チームを拒否", async () => {
  const team = await createTeam(db), other = await createTeam(db), a = actionsFor(team), b = actionsFor(other);
  await a.createAccountingIncomeItem(form({ received_on: "2026-11-01", payer_name: "検証協賛", category: "sponsorship", amount: "1000" }));
  const income = (await db.query("select id from accounting_income_items where group_id=$1", [team.groupId])).rows[0];
  await a.updateAccountingIncomeItem(form({ item_id: income.id, received_on: "2026-11-02", payer_name: "検証", category: "other", amount: "1500" }));
  assert.equal((await db.query("select amount from accounting_income_items where id=$1", [income.id])).rows[0].amount, 1500);
  await assert.rejects(b.deleteAccountingIncomeItem(form({ item_id: income.id })));
  await a.deleteAccountingIncomeItem(form({ item_id: income.id }));
  await a.createAccountingExpenseItem(form({ spent_on: "2026-11-01", payee_name: "銀行", category: "fee", amount: "110" }));
  const expense = (await db.query("select id from accounting_expense_items where group_id=$1", [team.groupId])).rows[0];
  await a.updateAccountingExpenseItem(form({ item_id: expense.id, spent_on: "2026-11-02", payee_name: "銀行", category: "fee", amount: "220" }));
  assert.equal((await db.query("select amount from accounting_expense_items where id=$1", [expense.id])).rows[0].amount, 220);
  await a.deleteAccountingExpenseItem(form({ item_id: expense.id }));
  assert.equal(await count("accounting_income_items", team.groupId), 0); assert.equal(await count("accounting_expense_items", team.groupId), 0);
});

test("[BANK-04] 新規収入・出費の照合と取消は派生項目を作成/削除して編集保護する", async () => {
  const team = await createTeam(db), a = actionsFor(team);
  await importTransactions(db, team, [{ bankTransactionId: "income", depositAmount: 1000 }, { bankTransactionId: "expense", withdrawalAmount: 110 }]);
  const incomeId = await transactionId(db, team, "income"), expenseId = await transactionId(db, team, "expense");
  await a.matchTransactionToIncomeItem(form({ transaction_id: incomeId, category: "sponsorship", payer_name: "検証支援者" }));
  await a.matchTransactionToExpenseItem(form({ transaction_id: expenseId, category: "fee", payee_name: "銀行" }));
  assert.equal(await count("accounting_income_items", team.groupId), 1); assert.equal(await count("accounting_expense_items", team.groupId), 1);
  const e = (await db.query("select id from accounting_expense_items where group_id=$1", [team.groupId])).rows[0];
  await assert.rejects(a.deleteAccountingExpenseItem(form({ item_id: e.id })));
  await a.cancelBankTransactionMatch(form({ transaction_id: incomeId })); await a.cancelBankTransactionMatch(form({ transaction_id: expenseId }));
  assert.equal(await count("accounting_income_items", team.groupId), 0); assert.equal(await count("accounting_expense_items", team.groupId), 0);
});

test("[BANK-04] 既存の会計項目を照合しても二重計上せず、取消で元項目を残す", async () => {
  const team = await createTeam(db), a = actionsFor(team);
  await a.createAccountingIncomeItem(form({ received_on: "2026-11-20", payer_name: "既存協賛", category: "sponsorship", amount: "1000" }));
  const item = (await db.query("select id from accounting_income_items where group_id=$1", [team.groupId])).rows[0];
  await importTransactions(db, team, [{ bankTransactionId: "existing", depositAmount: 1000 }]); const id = await transactionId(db, team, "existing");
  await a.matchTransactionToExistingAccountingItem(form({ transaction_id: id, item_type: "income", item_id: item.id })); assert.equal(await count("accounting_income_items", team.groupId), 1);
  await a.cancelBankTransactionMatch(form({ transaction_id: id })); assert.equal(await count("accounting_income_items", team.groupId), 1);
});

test("[BANK-06] 対象外・復帰・手動処理・取消を往復し、他チームを拒否", async () => {
  const team = await createTeam(db), other = await createTeam(db), a = actionsFor(team), b = actionsFor(other);
  await importTransactions(db, team, [{ bankTransactionId: "manual", depositAmount: 500 }]); const id = await transactionId(db, team, "manual");
  await assert.rejects(b.ignoreBankTransaction(form({ transaction_id: id, memo: "forged" })));
  await a.ignoreBankTransaction(form({ transaction_id: id, memo: "対象外検証" })); assert.equal((await db.query("select status from bank_transactions where id=$1", [id])).rows[0].status, "ignored");
  await a.unignoreBankTransaction(form({ transaction_id: id }));
  await a.matchTransactionManually(form({ transaction_id: id, note: "手動" })); assert.equal((await db.query("select status from bank_transactions where id=$1", [id])).rows[0].status, "matched");
  await a.cancelBankTransactionMatch(form({ transaction_id: id })); assert.equal((await db.query("select status from bank_transactions where id=$1", [id])).rows[0].status, "unmatched");
});

test("[BANK-06] 名義別名の全半角正規化・編集・削除と他チーム拒否", async () => {
  const team = await createTeam(db), other = await createTeam(db), p = await member(team), a = actionsFor(team), b = actionsFor(other);
  await a.createPaymentAlias(form({ profile_id: p.id, alias_name: "ﾔﾏﾀﾞ ﾀﾛｳ" }));
  const alias = (await db.query("select * from profile_payment_aliases where group_id=$1", [team.groupId])).rows[0];
  assert.equal(alias.normalized_alias_name, "ヤマダタロウ");
  await a.updatePaymentAlias(form({ alias_id: alias.id, alias_name: "ﾔﾏﾀﾞ ﾊﾅｺ" }));
  await assert.rejects(b.deletePaymentAlias(form({ alias_id: alias.id })));
  await a.deletePaymentAlias(form({ alias_id: alias.id })); assert.equal(await count("profile_payment_aliases", team.groupId), 0);
});

test("[AUTH-05] 登録は20回/時、ログインはアカウント単位の20回/日を超えると拒否", async () => {
  const client = postgresClient(db);
  const rate = loadTs("src/lib/authRateLimit.ts", { "server-only": {}, "next/headers": { headers: async () => new Headers() },
    "@/lib/supabase": { supabase: { rpc: async (name, args) => { const r = await client.rpc(name, args); return { ...r, data: r.data?.[0]?.consume_auth_rate_limit }; } } } });
  for (let i = 0; i < 20; i++) assert.equal(await rate.allowAuthAttempt("register"), true);
  assert.equal(await rate.allowAuthAttempt("register"), false);
  const registerBucket = createHash("sha256").update("register:ip:shared").digest("hex");
  await db.query("update app_auth_rate_limits set window_started_at=now()-interval '61 minutes' where bucket_hash=$1", [registerBucket]);
  assert.equal(await rate.allowAuthAttempt("register"), true);
  const name = "daily-limit-test", accountBucket = createHash("sha256").update("login:account:" + name).digest("hex");
  for (let i = 0; i < 20; i++) {
    if (i && i % 5 === 0) await db.query("update app_auth_rate_limits set window_started_at=now()-interval '16 minutes' where bucket_hash=$1", [accountBucket]);
    assert.equal(await rate.allowAuthAttempt("login", name), true);
  }
  await db.query("update app_auth_rate_limits set window_started_at=now()-interval '16 minutes' where bucket_hash=$1", [accountBucket]);
  assert.equal(await rate.allowAuthAttempt("login", name), false);
});

test("[ACC-02] 時給と減額0/100%の設定・変更・削除・範囲外の拒否", async () => {
  const team = await createTeam(db), a = actionsFor(team);
  await a.updateCoachHourlyRate(form({ coach_id: team.adminId, coach_hourly_rate: "500" }));
  await db.query("insert into coach_work_logs(group_id,coach_id,work_date,coaching_minutes) values($1,$2,'2026-11-01',60)", [team.groupId, team.adminId]);
  const f = { coach_id: team.adminId, starts_on: "2026-11-01", ends_on: "2026-11-30", pay_rate_percent: "0" };
  await a.createCoachRewardAdjustment(form(f));
  const adjustment = (await db.query("select id from coach_reward_adjustments where group_id=$1", [team.groupId])).rows[0];
  const report = () => a.buildMonthlyVirtualPaymentReport({ id: team.adminId, group_id: team.groupId }, "2026-11");
  assert.equal((await report()).rows[0].grossReward, 0);
  await a.updateCoachRewardAdjustment(form({ ...f, adjustment_id: adjustment.id, pay_rate_percent: "100" }));
  assert.equal((await report()).rows[0].grossReward, 500);
  await assert.rejects(a.createCoachRewardAdjustment(form({ ...f, pay_rate_percent: "101" })));
  await assert.rejects(a.createCoachRewardAdjustment(form({ ...f, ends_on: "2026-10-31" })));
  await a.deleteCoachRewardAdjustment(form({ adjustment_id: adjustment.id }));
  assert.equal(await count("coach_reward_adjustments", team.groupId), 0);
});

test("[BANK-03] 複数請求の照合と取消は全件を復元し、二重操作を拒否", async () => {
  const team = await createTeam(db), p = await member(team), a = actionsFor(team);
  for (const amount of [100, 200]) await a.createBillingItem(form({ user_id: p.id, target_month: "2026-11", category: "other", amount: String(amount) }));
  const bills = (await db.query("select id from billing_items where group_id=$1 order by amount", [team.groupId])).rows;
  await importTransactions(db, team, [{ bankTransactionId: "combined", depositAmount: 300 }]);
  const id = await transactionId(db, team, "combined"), f = form({ transaction_id: id, billing_item_ids: bills.map(b => b.id) });
  await a.matchTransactionToBillingItems(f);
  assert.ok((await db.query("select status from billing_items where group_id=$1", [team.groupId])).rows.every(r => r.status === "paid"));
  await assert.rejects(a.matchTransactionToBillingItems(f));
  await a.cancelBankTransactionMatch(form({ transaction_id: id }));
  assert.ok((await db.query("select status,paid_at from billing_items where group_id=$1", [team.groupId])).rows.every(r => r.status === "unpaid" && r.paid_at === null));
});

test("[BANK-06] 名義の正規化・候補の重複整理と入金/返金の方向を混同しない", () => {
  const bank = loadTs("src/lib/bankReconciliation.ts");
  const aliases = [{ profileId: "p", profileName: "検証", aliasName: "ﾔﾏﾀﾞ ﾀﾛｳ", normalizedAliasName: "ヤマダタロウ" }, { profileId: "p", profileName: "検証", aliasName: "ヤマダ", normalizedAliasName: "ヤマダ" }];
  const transaction = { transactedOn: "2026-11-20", depositAmount: 5000, withdrawalAmount: 0, description: "振込 ヤマダ タロウ" };
  assert.equal(bank.inferProfileCandidates(transaction, aliases).length, 1);
  const billingItems = [{ id: "tuition", userId: "p", userName: "検証", targetMonth: "2026-11", category: "tuition", title: "月謝", amount: 5000, status: "unpaid" }, { id: "refund", userId: "p", userName: "検証", targetMonth: "2026-11", category: "other", title: "返金", amount: 5000, status: "unpaid" }];
  assert.deepEqual(bank.buildMatchCandidates({ transaction, aliases, billingItems }).map(c => c.billingItemId), ["tuition"]);
  assert.deepEqual(bank.buildMatchCandidates({ transaction: { ...transaction, depositAmount: 0, withdrawalAmount: 5000 }, aliases, billingItems }).map(c => c.billingItemId), ["refund"]);
});

test("[UI-04] 意見フォームは宛先を固定し、日本語と記号をmailtoへ正しく符号化する", () => {
  const originalFormData = globalThis.FormData, originalWindow = globalThis.window;
  try {
    globalThis.FormData = class extends Map { constructor(values) { super(Object.entries(values)); } };
    globalThis.window = { location: { href: "" } };
    const Component = loadTs("src/app/feedback/FeedbackForm.tsx").default;
    let prevented = false;
    Component().props.onSubmit({ preventDefault() { prevented = true; }, currentTarget: { category: "bug", urgency: "urgent", page_path: "/admin/accounting?a=1&b=2", message: "日本語 & ? # 改行\n次の行" } });
    const url = new URL(globalThis.window.location.href);
    assert.equal(prevented, true); assert.equal(url.protocol, "mailto:"); assert.equal(url.pathname, "bbstatus@gmail.com");
    assert.equal(url.searchParams.get("subject"), "【NSCT-U15BBC webapp】不具合のご意見");
    assert.ok(url.searchParams.get("body").includes("日本語 & ? # 改行\n次の行"));
    assert.ok(url.searchParams.get("body").includes("/admin/accounting?a=1&b=2"));
    assert.equal([...url.searchParams.keys()].length, 2);
  } finally {
    globalThis.FormData = originalFormData;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  }
});

test("[CAL-05 UI-01] 最大年の12月を指定してもカレンダーと勤怠でRangeErrorを起こさない", async () => {
  const team = await createTeam(db), a = actionsFor(team);
  const mocks = { ...a.mocks, "./AdminCalendarClient": () => null, "./UserCalendarClient": () => null, "./CoachWorkCalendarClient": () => null };
  const pages = ["src/app/admin/calendar/page.tsx", "src/app/user/calendar/page.tsx", "src/app/admin/coach-work/page.tsx"];
  const results = await Promise.allSettled(pages.map(file => loadTs(file, mocks).default({ searchParams: Promise.resolve({ month: "9999-12" }) })));
  const errors = results.flatMap((r, i) => r.status === "rejected" && !String(r.reason).includes("redirect:") ? [`${pages[i]}: ${r.reason.message}`] : []);
  assert.deepEqual(errors, []);
});
