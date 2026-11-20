import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { decodeCopyValue, parsePublicBackup, buildInsertSql, fingerprintQuery, fingerprintAssertions } from "../scripts/lib/backup-data.mjs";

const sample = (rows = "1\tname\\twith\\nlines\t\\N") => gzipSync(`-- PostgreSQL database cluster dump
CREATE ROLE dangerous;
\\connect template1
COPY public.ignored (id) FROM stdin;
1
\\.
\\connect postgres
COPY auth.users (id) FROM stdin;
secret
\\.
COPY public.groups (id, name, created_at) FROM stdin;
${rows}
\\.
COPY public.profiles (id) FROM stdin;
\\.
`);

test("COPYのエスケープとNULLを区別して復元する", () => {
  assert.equal(decodeCopyValue("\\N"), null);
  assert.equal(decodeCopyValue("\\\\N"), "\\N");
  assert.equal(decodeCopyValue("a\\tb\\nc\\\\d"), "a\tb\nc\\d");
  assert.equal(decodeCopyValue("\\101\\x42"), "AB");
  assert.equal(decodeCopyValue("日本語\\343\\201\\202"), "日本語あ");
});

test("postgresのアプリ用テーブルだけを読み、ロールやauthデータを実行・復元しない", () => {
  const parsed = parsePublicBackup(sample());
  assert.deepEqual(parsed.tables.map((table) => table.name), ["groups", "profiles"]);
  assert.deepEqual(parsed.tables[0].rows[0], ["1", "name\twith\nlines", null]);
  const generated = buildInsertSql(parsed.tables);
  assert.ok(!generated.includes("dangerous"));
  assert.ok(!generated.includes("auth.users"));
});

test("不完全なCOPYや未知のテーブルを黙って省略しない", () => {
  assert.throws(() => parsePublicBackup(sample("1\tonly-two-columns")), /column count/);
  assert.throws(() => parsePublicBackup(gzipSync("-- PostgreSQL database dump\nCOPY public.groups (id) FROM stdin;\n1\n")), /Unterminated COPY/);
  assert.throws(() => parsePublicBackup(gzipSync("-- PostgreSQL database dump\nCOPY public.unknown (id) FROM stdin;\n1\n\\.\n")), /Unknown public table/);
});

test("引用符・改行・SQLに見える値をデータとして保ち、チェック失敗は原子的に戻す", async () => {
  const db = new PGlite();
  try {
    await db.exec("create table groups(id integer primary key,name text,created_at timestamptz); create table profiles(id integer primary key);");
    const parsed = parsePublicBackup(sample("1\tO'Reilly'); DROP TABLE profiles; --\\nnext line\t\\N"));
    await db.exec("set standard_conforming_strings=on;" + buildInsertSql(parsed.tables));
    assert.equal((await db.query("select name from groups")).rows[0].name, "O'Reilly'); DROP TABLE profiles; --\nnext line");
    const expected = (await db.query(fingerprintQuery(parsed.tables))).rows;
    await assert.rejects(db.exec("begin; update groups set name='changed';" + fingerprintAssertions(expected,parsed.tables) + "commit;"), /fingerprint mismatch/);
    await db.exec("rollback;");
    assert.deepEqual((await db.query(fingerprintQuery(parsed.tables))).rows, expected);
  } finally { await db.close(); }
});
