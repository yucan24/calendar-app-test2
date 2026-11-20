import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers.mjs";

const { assertDevelopmentDatabase, assertDatabaseEnvironment, PRODUCTION_SUPABASE_REF, TEST_SUPABASE_REF } = loadTs("src/lib/environment.ts");

test("開発サーバーは新旧本番DBへの接続を拒否する", () => {
  for (const ref of [PRODUCTION_SUPABASE_REF, "tqkblkxjgbnxoqkralmn"]) {
    assert.throws(() => assertDevelopmentDatabase(`https://${ref}.supabase.co`, "development"), /本番DBへ接続できません/);
  }
  assert.doesNotThrow(() => assertDevelopmentDatabase(`https://${TEST_SUPABASE_REF}.supabase.co`, "development"));
  assert.doesNotThrow(() => assertDevelopmentDatabase(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`, "production"));
});

test("Vercelの本番とプレビューはそれぞれの専用DBだけに接続する", () => {
  assert.throws(() => assertDatabaseEnvironment(`https://${TEST_SUPABASE_REF}.supabase.co`, "production", "production"), /本番用Supabase/);
  assert.throws(() => assertDatabaseEnvironment(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`, "production", "preview"), /テスト用Supabase/);
  assert.doesNotThrow(() => assertDatabaseEnvironment(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`, "production", "production"));
  assert.doesNotThrow(() => assertDatabaseEnvironment(`https://${TEST_SUPABASE_REF}.supabase.co`, "production", "preview"));
});
