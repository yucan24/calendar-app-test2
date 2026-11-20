import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestDatabase, createTeam } from "./helpers.mjs";

test("本番のアクセス設定は公開ロールの直接アクセスと管理者ID指定RPCを拒否する", async () => {
  const db = await createTestDatabase();
  try {
    const team = await createTeam(db);
    await db.exec(readFileSync("supabase/production/restrict-public-access.sql", "utf8"));
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role};`);
      await assert.rejects(db.query("select login_code from profiles"), /permission denied/);
      await assert.rejects(db.query("select * from list_accounting_income_items($1,$2)", [team.adminId, "2026-11"]), /permission denied/);
      await db.exec("reset role;");
    }
    const result = await db.query("select count(*)::integer as unsafe from pg_tables where schemaname='public' and not rowsecurity");
    assert.equal(result.rows[0].unsafe, 0);
    assert.equal((await db.query("select count(*)::integer as profiles from profiles")).rows[0].profiles, 1);
  } finally { await db.close(); }
});
