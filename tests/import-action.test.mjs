import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers.mjs";

const bank = loadTs("src/lib/bankReconciliation.ts");
const calls = [];
const { importBankCsv } = loadTs("src/app/admin/bank-reconciliation/actions.ts", {
  "next/cache": { revalidatePath() {} },
  "@/lib/auth": { requireAdmin: async () => ({ id: "admin", group_id: "team" }) },
  "@/lib/bankReconciliation": bank,
  "./paymentReport": {},
  "@/lib/supabase": { supabase: { rpc: async (...args) => { calls.push(args); return {
    error: null, data: [{ imported_count: 1, skipped_count: 0, conflict_count: 1, conflict_transaction_ids: ["CHANGED"] }],
  }; } } },
});

test("5MBちょうどのCSVを受理し、訂正版の警告を結果へ表示する", async () => {
  const prefix = "Bank,Branch,Normal,1234567,,,now\n001,2026/11/20,0,1,";
  const suffix = ",0\n";
  const text = prefix + "x".repeat(5 * 1024 * 1024 - prefix.length - suffix.length) + suffix;
  const form = new FormData();
  form.set("csv_file", new File([text], "synthetic.csv"));
  const result = await importBankCsv({}, form);
  assert.equal(result.ok, true);
  assert.match(result.message, /内容が異なる明細が1件/);
  assert.match(result.message, /CHANGED/);
  assert.equal(calls.length, 1);
});

test("5MB+1byteはDBを呼ばずに容量エラーを返す", async () => {
  const form = new FormData();
  form.set("csv_file", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "oversize.csv"));
  const count = calls.length;
  const result = await importBankCsv({}, form);
  assert.equal(result.ok, false);
  assert.match(result.message, /5MB以下/);
  assert.equal(calls.length, count);
});
