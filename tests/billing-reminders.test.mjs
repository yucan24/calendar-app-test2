import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createTestDatabase, createTeam, loadTs, postgresClient } from "./helpers.mjs";

let db;
before(async () => { db = await createTestDatabase(); });
after(async () => { await db?.close(); });
function filterForm(month = "2026-11", category = "tuition") { const f = new FormData(); f.set("month", month); f.set("category", category); return f; }
async function member(team, patch = {}) {
  const data = { group_id: team.groupId, name: `reminder-${randomUUID()}`, email: "synthetic@example.invalid", role: "user", login_enabled: true, email_verified_at: "2026-11-01T00:00:00Z", ...patch };
  return (await db.query(`insert into profiles(${Object.keys(data).join(",")}) values(${Object.keys(data).map((_, i) => `$${i + 1}`).join(",")}) returning *`, Object.values(data))).rows[0];
}
async function bill(team, person, patch = {}) {
  const data = { group_id: team.groupId, user_id: person.id, target_month: "2026-11", category: "tuition", title: "月謝", amount: 5000, status: "unpaid", ...patch };
  return (await db.query(`insert into billing_items(${Object.keys(data).join(",")}) values(${Object.keys(data).map((_, i) => `$${i + 1}`).join(",")}) returning *`, Object.values(data))).rows[0];
}
function actions(actor, { failure = false, disabled = false, brokenClaim = false, brokenHistory = false } = {}) {
  const mails = [], client = postgresClient(db), originalRpc = client.rpc.bind(client), originalFrom = client.from.bind(client);
  client.rpc = async (name, args) => {
    if (brokenClaim) return { data: null, error: { message: "private database details" } };
    const result = await originalRpc(name, args);
    return name === "consume_auth_rate_limit" && !result.error ? { ...result, data: result.data[0]?.consume_auth_rate_limit } : result;
  };
  client.from = (table) => table === "app_account_notifications" && brokenHistory ? { insert: async () => ({ error: { message: "history unavailable" } }) } : originalFrom(table);
  const mocks = {
    "server-only": {}, "next/cache": { revalidatePath() {} },
    "@/lib/supabase": { supabase: client },
    "@/lib/auth": { requireAdmin: async () => { if (!actor || actor.role !== "admin") throw new Error("not admin"); return actor; } },
    "@/lib/accountEmail": { applicationUrl: () => "https://team.example.invalid", sendAccountEmail: async (mail) => { if (failure) throw new Error("SMTP password must never appear"); if (disabled) return "disabled"; mails.push(mail); return "sent"; } },
  };
  return { ...loadTs("src/app/admin/users/reminder-actions.ts", mocks), mails };
}
async function setup() {
  const team = await createTeam(db), admin = (await db.query("select * from profiles where id=$1", [team.adminId])).rows[0], person = await member(team);
  return { team, admin, person, actions: actions(admin) };
}

test("月謝・全費目の未払いを月で絞り、支払済み・免除・返金・0円・未来月を除外する", async () => {
  const s = await setup();
  await bill(s.team, s.person); await bill(s.team, s.person, { target_month: "2026-10", amount: 3000 });
  await bill(s.team, s.person, { category: "trip", title: "遠征費", amount: 2000 });
  for (const patch of [{ target_month: "2026-12" }, { category: "other", title: "返金" }, { category: "other", amount: 0 }, { category: "other", status: "paid" }, { category: "other", status: "exempt" }]) await bill(s.team, s.person, patch);
  const tuition = await s.actions.previewBillingReminders(filterForm());
  assert.equal(tuition.ok, true); assert.equal(tuition.recipients.length, 1); assert.equal(tuition.recipients[0].total, 8000);
  const all = await s.actions.previewBillingReminders(filterForm("2026-11", "all")); assert.equal(all.recipients[0].total, 10000);
  assert.ok(!all.recipients[0].text.includes("2026年12月")); assert.equal(s.actions.mails.length, 0);
});

test("宛先確認だけでは送信せず、本人用の内訳だけを表示し、未確認メール・停止会員を送信不可にする", async () => {
  const s = await setup(), other = await member(s.team, { name: "別会員" }); await bill(s.team, s.person); await bill(s.team, other);
  const unverified = await member(s.team, { email_verified_at: null }), suspended = await member(s.team, { account_status: "suspended", login_enabled: false }), missing = await member(s.team, { email: "" });
  for (const p of [unverified, suspended, missing]) await bill(s.team, p);
  const preview = await s.actions.previewBillingReminders(filterForm());
  const own = preview.recipients.find((p) => p.id === s.person.id);
  assert.ok(!own.text.includes(other.name)); assert.equal(s.actions.mails.length, 0);
  assert.equal(preview.recipients.find((p) => p.id === unverified.id).unavailable, "メール未確認");
  assert.ok(preview.recipients.find((p) => p.id === suspended.id).unavailable);
  assert.equal(preview.recipients.find((p) => p.id === missing.id).unavailable, "メール未登録");
  for (const p of [unverified, suspended, missing]) assert.equal((await s.actions.sendBillingReminder(preview.recipients.find((r) => r.id === p.id).request)).status, "changed");
});

test("アプリの登録先へ個別送信し、履歴を残し、請求や入金状態は変更しない", async () => {
  const s = await setup(), original = await bill(s.team, s.person);
  const preview = await s.actions.previewBillingReminders(filterForm());
  const result = await s.actions.sendBillingReminder({ ...preview.recipients[0].request, email: "forged@example.invalid", amount: 1 });
  assert.equal(result.status, "sent"); assert.equal(s.actions.mails.length, 1);
  assert.equal(s.actions.mails[0].to, s.person.email); assert.match(s.actions.mails[0].text, /5,000/);
  assert.ok(!s.actions.mails[0].bcc); assert.ok(!s.actions.mails[0].cc);
  assert.deepEqual((await db.query("select * from billing_items where id=$1", [original.id])).rows[0], original);
  const notice = (await db.query("select * from app_account_notifications where profile_id=$1", [s.person.id])).rows[0];
  assert.equal(notice.kind, "billing_reminder"); assert.equal(notice.delivery_status, "sent"); assert.equal(notice.recipient, s.person.email);
  const again = (await s.actions.previewBillingReminders(filterForm())).recipients[0];
  assert.equal(again.lastDelivery.status, "sent"); assert.match(again.unavailable, /送信直後/);
});

test("確認後の支払済み・金額・メール・利用状態の変更を検出して送信を止める", async () => {
  for (const mutation of [
    async (s, b) => db.query("update billing_items set status='paid' where id=$1", [b.id]),
    async (s, b) => db.query("update billing_items set amount=9999 where id=$1", [b.id]),
    async (s) => db.query("update profiles set email='new@example.invalid' where id=$1", [s.person.id]),
    async (s) => db.query("update profiles set account_status='suspended' where id=$1", [s.person.id]),
  ]) {
    const s = await setup(), b = await bill(s.team, s.person), preview = await s.actions.previewBillingReminders(filterForm());
    await mutation(s, b);
    assert.equal((await s.actions.sendBillingReminder(preview.recipients[0].request)).status, "changed"); assert.equal(s.actions.mails.length, 0);
  }
});

test("一般会員・未ログインを拒否し、別チームの宛先を指定しても送信できない", async () => {
  const s = await setup(), another = await setup(); await bill(s.team, s.person);
  const request = (await s.actions.previewBillingReminders(filterForm())).recipients[0].request;
  for (const actor of [null, s.person]) {
    const forbidden = actions(actor);
    await assert.rejects(forbidden.previewBillingReminders(filterForm()), /not admin/);
    await assert.rejects(forbidden.sendBillingReminder(request), /not admin/);
    assert.equal(forbidden.mails.length, 0);
  }
  assert.equal((await another.actions.sendBillingReminder(request)).status, "changed"); assert.equal(another.actions.mails.length, 0);
});

test("同じ送信の12並列・別管理者からの再確認も、会員あたり5分内は1通に抑える", async () => {
  const s = await setup(); await bill(s.team, s.person);
  const request = (await s.actions.previewBillingReminders(filterForm())).recipients[0].request;
  const results = await Promise.all(Array.from({ length: 12 }, () => s.actions.sendBillingReminder(request)));
  assert.equal(results.filter((r) => r.status === "sent").length, 1); assert.equal(s.actions.mails.length, 1);
  const second = await member(s.team, { role: "admin" }), a = actions(second);
  const fresh = (await a.previewBillingReminders(filterForm())).recipients.find((r) => r.id === s.person.id);
  assert.equal((await a.sendBillingReminder(fresh.request)).status, "blocked"); assert.equal(a.mails.length, 0);
});

test("5分経過後の新しい確認では再送でき、古い要求の再実行は送信しない", async () => {
  const s = await setup(); await bill(s.team, s.person);
  const request = (await s.actions.previewBillingReminders(filterForm())).recipients[0].request;
  assert.equal((await s.actions.sendBillingReminder(request)).status, "sent");
  const bucket = createHash("sha256").update(`billing-reminder:member:${s.team.groupId}:${s.person.id}`).digest("hex");
  await db.query("update app_auth_rate_limits set window_started_at=now()-interval '301 seconds' where bucket_hash=$1", [bucket]);
  await db.query("update app_account_notifications set created_at=now()-interval '301 seconds' where profile_id=$1", [s.person.id]);
  assert.equal((await s.actions.sendBillingReminder(request)).status, "duplicate");
  const fresh = (await s.actions.previewBillingReminders(filterForm())).recipients[0];
  assert.equal(fresh.unavailable, null);
  assert.equal((await s.actions.sendBillingReminder(fresh.request)).status, "sent"); assert.equal(s.actions.mails.length, 2);
});

test("送信失敗・送信停止を記録し、失敗した請求は未払いのまま保持する", async () => {
  for (const mode of [{ failure: true }, { disabled: true }]) {
    const s = await setup(), b = await bill(s.team, s.person), a = actions(s.admin, mode);
    const request = (await a.previewBillingReminders(filterForm())).recipients[0].request;
    const result = await a.sendBillingReminder(request);
    assert.equal(result.status, mode.failure ? "failed" : "disabled"); assert.equal(a.mails.length, 0);
    assert.ok(!JSON.stringify(result).includes("SMTP password"));
    assert.equal((await db.query("select delivery_status from app_account_notifications where profile_id=$1", [s.person.id])).rows[0].delivery_status, result.status);
    assert.equal((await db.query("select status from billing_items where id=$1", [b.id])).rows[0].status, "unpaid");
  }
});

test("不正・期限切れ・別内容の送信指定はSMTPに到達しない", async () => {
  const s = await setup(); await bill(s.team, s.person);
  const request = (await s.actions.previewBillingReminders(filterForm())).recipients[0].request;
  for (const patch of [{ month: "2026-99" }, { category: "refund" }, { profileId: "bad" }, { requestId: "bad" }, { digest: "0".repeat(64) }, { preparedAt: Date.now() - 11 * 60_000 }, { preparedAt: Date.now() + 60000 }]) assert.equal((await s.actions.sendBillingReminder({ ...request, ...patch })).status, "changed");
  assert.equal((await s.actions.previewBillingReminders(filterForm("invalid"))).ok, false); assert.equal(s.actions.mails.length, 0);
});

test("重複防止DBが使えない場合は送らず、送信後の履歴エラーでは結果不明として再送を抑止する", async () => {
  const s = await setup(); await bill(s.team, s.person);
  const request = (await s.actions.previewBillingReminders(filterForm())).recipients[0].request;
  const blocked = actions(s.admin, { brokenClaim: true }); assert.equal((await blocked.sendBillingReminder(request)).status, "blocked"); assert.equal(blocked.mails.length, 0);
  const uncertain = actions(s.admin, { brokenHistory: true }); assert.equal((await uncertain.sendBillingReminder(request)).status, "unknown"); assert.equal(uncertain.mails.length, 1);
  assert.equal((await uncertain.sendBillingReminder(request)).status, "duplicate"); assert.equal(uncertain.mails.length, 1);
});

test("1,001件の未払いでもページ境界で金額や内訳を取り落とさない", async () => {
  const s = await setup();
  await db.query("insert into billing_items(group_id,user_id,target_month,category,title,amount) select $1,$2,'2026-11','other','追加費用',1 from generate_series(1,1001)", [s.team.groupId, s.person.id]);
  const preview = await s.actions.previewBillingReminders(filterForm("2026-11", "all"));
  assert.equal(preview.recipients[0].total, 1001);
  assert.equal((preview.recipients[0].text.match(/追加費用/g) ?? []).length, 1001);
  assert.equal((await s.actions.sendBillingReminder(preview.recipients[0].request)).status, "sent");
});
