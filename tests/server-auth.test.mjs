import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTestDatabase, createTeam, loadTs, postgresClient } from "./helpers.mjs";

let db;
before(async () => { db = await createTestDatabase(); });
after(async () => { await db?.close(); });
const session = loadTs("src/lib/session.ts");
const form = (values) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };

async function member(role = "admin") {
  const team = await createTeam(db);
  await db.query("update profiles set login_code='1234',role=$2 where id=$1", [team.adminId, role]);
  const profile = (await db.query("select * from profiles where id=$1", [team.adminId])).rows[0];
  return { ...team, profile };
}

async function signIn(profile) {
  const token = session.createSessionToken();
  const result = await db.query("select * from authenticate_app_session($1,'1234',$2)", [profile.name, session.hashSessionToken(token)]);
  assert.equal(result.rows[0].outcome, "authenticated");
  return token;
}

function request(cookieValues = {}) {
  const values = new Map(Object.entries(cookieValues));
  const client = postgresClient(db);
  const mocks = {
    "server-only": {},
    "next/headers": { cookies: async () => ({ get: (name) => values.has(name) ? { value: values.get(name) } : undefined, delete: (name) => values.delete(name) }) },
    "next/navigation": { redirect: (url) => { throw new Error(`redirect:${url}`); } },
    "next/cache": { revalidatePath() {} },
    "@/lib/supabase": { supabase: client },
    "@/lib/session": session,
    "@/lib/month": loadTs("src/lib/month.ts"),
  };
  const auth = loadTs("src/lib/auth.ts", mocks);
  return { auth, values, mocks: { ...mocks, "@/lib/auth": auth } };
}

test("UUID Cookie・改ざん・ランダム値ではなりすませず、DBにはセッションのハッシュだけを保存する", async () => {
  const team = await member();
  assert.equal(await request({ profile_id: team.adminId }).auth.getCurrentProfile(), null);
  assert.equal(await request({ [session.sessionCookieName()]: team.adminId }).auth.getCurrentProfile(), null);
  const token = await signIn(team.profile);
  const current = request({ [session.sessionCookieName()]: token });
  assert.equal((await current.auth.requireAdmin()).id, team.adminId);
  const stored = (await db.query("select token_hash from app_sessions where profile_id=$1", [team.adminId])).rows[0].token_hash;
  assert.equal(stored, session.hashSessionToken(token));
  assert.notEqual(stored, token);
  const altered = (token[0] === "a" ? "b" : "a") + token.slice(1);
  assert.equal(await request({ [session.sessionCookieName()]: altered }).auth.getCurrentProfile(), null);
  assert.equal(session.sessionCookieName("production"), "__Host-nsct_session");
});

test("誤ったコード・未承認ではセッションを作らず、有効期限切れとログアウト後の再利用を拒否する", async () => {
  const team = await member();
  const hash = session.hashSessionToken(session.createSessionToken());
  assert.equal((await db.query("select * from authenticate_app_session($1,'9999',$2)", [team.profile.name, hash])).rows[0].outcome, "failed");
  await db.query("update profiles set login_enabled=false where id=$1", [team.adminId]);
  assert.equal((await db.query("select * from authenticate_app_session($1,'1234',$2)", [team.profile.name, hash])).rows[0].outcome, "pending");
  assert.equal((await db.query("select count(*)::integer as n from app_sessions where profile_id=$1", [team.adminId])).rows[0].n, 0);
  await db.query("update profiles set login_enabled=true where id=$1", [team.adminId]);
  const expired = await signIn(team.profile);
  await db.query("update app_sessions set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where token_hash=$1", [session.hashSessionToken(expired)]);
  assert.equal(await request({ [session.sessionCookieName()]: expired }).auth.getCurrentProfile(), null);
  const token = await signIn(team.profile);
  const current = request({ [session.sessionCookieName()]: token, profile_id: team.adminId });
  await current.auth.endSession();
  assert.equal(current.values.size, 0);
  assert.equal(await request({ [session.sessionCookieName()]: token }).auth.getCurrentProfile(), null);
});

test("ログイン停止・権限・コードの変更で既存セッションを失効させる", async () => {
  for (const change of ["login_enabled=false", "role='user'", "login_code='5678'"]) {
    const team = await member();
    const token = await signIn(team.profile);
    await db.query(`update profiles set ${change} where id=$1`, [team.adminId]);
    assert.equal(await request({ [session.sessionCookieName()]: token }).auth.getCurrentProfile(), null);
    assert.equal((await db.query("select count(*)::integer as n from app_sessions where profile_id=$1", [team.adminId])).rows[0].n, 0);
  }
});

test("永続レート制限は上限超過を拒否し、別アカウントと期限リセットを正しく扱う", async () => {
  const name = `rate-${session.createSessionToken()}`;
  const client = postgresClient(db);
  const rate = loadTs("src/lib/authRateLimit.ts", {
    "server-only": {}, "next/headers": { headers: async () => new Headers() },
    "@/lib/supabase": { supabase: { rpc: async (fn, args) => {
      const result = await client.rpc(fn, args);
      return { ...result, data: result.data?.[0]?.consume_auth_rate_limit };
    } } },
  });
  for (let i = 0; i < 5; i++) assert.equal(await rate.allowAuthAttempt("login", name), true);
  assert.equal(await rate.allowAuthAttempt("login", name), false);
  assert.equal(await rate.allowAuthAttempt("login", name + "other"), true);
  const bucket = createHash("sha256").update("login:account:" + name).digest("hex");
  await db.query("update app_auth_rate_limits set window_started_at=now()-interval '16 minutes' where bucket_hash=$1", [bucket]);
  assert.equal(await rate.allowAuthAttempt("login", name), true);
  await assert.rejects(db.query("select consume_auth_rate_limit('invalid',5,900)"), /Invalid rate/);
});

test("公開ロールはセッション取得・作成・レート制限を直接呼び出せない", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role};`);
    try {
      await assert.rejects(db.query("select * from app_sessions"), /permission denied/);
      await assert.rejects(db.query("select * from get_app_session_profile($1)", ["a".repeat(64)]), /permission denied/);
      await assert.rejects(db.query("select * from authenticate_app_session('test','1234',$1)", ["a".repeat(64)]), /permission denied/);
      await assert.rejects(db.query("select consume_auth_rate_limit($1,5,900)", ["a".repeat(64)]), /permission denied/);
    } finally { await db.exec("reset role;"); }
  }
});

test("予定詳細のActionは未ログイン・一般ユーザー・別チームの会員や予定を拒否する", async () => {
  const own = await member(); const other = await member();
  const user = (await db.query("insert into profiles(group_id,name,role,login_enabled,login_code) values($1,$2,'user',true,'1234') returning *", [own.groupId, `user-${own.groupId}`])).rows[0];
  const event = async (team) => (await db.query("insert into calendar_events(group_id,created_by,title,start_at,attendance_required) values($1,$2,'検証予定','2026-11-20T00:00:00Z',true) returning id", [team.groupId, team.adminId])).rows[0].id;
  const ownEvent = await event(own), otherEvent = await event(other);
  const adminRequest = request({ [session.sessionCookieName()]: await signIn(own.profile) });
  const actions = loadTs("src/app/admin/calendar/[id]/actions.ts", adminRequest.mocks);
  await assert.rejects(actions.updateAdminAttendance(ownEvent, other.adminId, "attend"), /権限/);
  await assert.rejects(actions.updateAdminAttendance(otherEvent, user.id, "attend"), /権限/);
  await actions.updateAdminAttendance(ownEvent, user.id, "attend");
  assert.equal((await db.query("select status from event_responses where event_id=$1 and user_id=$2", [ownEvent, user.id])).rows[0].status, "attend");
  await assert.rejects(actions.updateEvent(form({ id: otherEvent, date: "2026-11-20", title: "不正変更" })), /権限/);
  await assert.rejects(actions.deleteEvent(form({ id: otherEvent })), /redirect:\/admin\/calendar/);
  assert.equal((await db.query("select count(*)::integer as n from calendar_events where id=$1", [otherEvent])).rows[0].n, 1);
  const userRequest = request({ [session.sessionCookieName()]: await signIn(user) });
  await assert.rejects(loadTs("src/app/admin/calendar/[id]/actions.ts", userRequest.mocks).updateAdminAttendance(ownEvent, user.id, "absent"), /redirect:\/user/);
  await assert.rejects(loadTs("src/app/admin/calendar/[id]/actions.ts", request().mocks).updateAdminAttendance(ownEvent, user.id, "absent"), /redirect:\/login/);
  const userActions = loadTs("src/app/user/calendar/[id]/actions.ts", userRequest.mocks);
  await assert.rejects(userActions.submitResponse(form({ event_id: otherEvent, status: "attend" })), /権限/);
  await assert.rejects(userActions.submitResponse(form({ event_id: ownEvent, user_id: other.adminId, status: "pending" })), /redirect:\/user\/calendar/);
  const rows = (await db.query("select user_id,status from event_responses where event_id=$1", [ownEvent])).rows;
  assert.deepEqual(rows, [{ user_id: user.id, status: "pending" }]);
});

test("実際のログイン処理は承認済みだけ成功し、制限・DB障害時には失敗する", async () => {
  const team = await member();
  let allowed = true;
  const client = postgresClient(db);
  const login = loadTs("src/lib/login.ts", { "server-only": {}, "@/lib/supabase": { supabase: client }, "@/lib/session": session,
    "@/lib/authRateLimit": { allowAuthAttempt: async () => allowed } });
  assert.equal((await login.authenticateLogin(team.profile.name, "9999")).reason, "failed");
  const result = await login.authenticateLogin(team.profile.name, "1234");
  assert.equal(result.ok, true);
  assert.equal((await request({ [session.sessionCookieName()]: result.token }).auth.getCurrentProfile()).id, team.adminId);
  allowed = false;
  assert.equal((await login.authenticateLogin(team.profile.name, "1234")).reason, "limited");
  const unavailable = loadTs("src/lib/login.ts", { "server-only": {}, "@/lib/supabase": { supabase: client }, "@/lib/session": session,
    "@/lib/authRateLimit": { allowAuthAttempt: async () => { throw new Error("unavailable"); } } });
  assert.equal((await unavailable.authenticateLogin(team.profile.name, "1234")).reason, "unavailable");
});
