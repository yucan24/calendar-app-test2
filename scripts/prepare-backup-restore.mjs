import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { parsePublicBackup, buildInsertSql, fingerprintQuery } from "./lib/backup-data.mjs";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (!args.includes("--backup") || !args.includes("--out")) {
  throw new Error("Usage: node scripts/prepare-backup-restore.mjs --backup <backup.gz> --out <new private directory>");
}
const backupPath = resolve(option("--backup"));
const output = resolve(option("--out"));
const backup = parsePublicBackup(readFileSync(backupPath));
mkdirSync(output, { mode: 0o700 });
const save = (name, text) => writeFileSync(join(output, name), text, { mode: 0o600, flag: "wx" });
const db = new PGlite();

try {
  await db.exec("create schema extensions; create role anon; create role authenticated; create role service_role;");
  for (const name of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()) {
    const migration = readFileSync(`supabase/migrations/${name}`, "utf8")
      .replaceAll("create extension if not exists pgcrypto with schema extensions;", "");
    await db.exec(migration);
  }
  const inserts = buildInsertSql(backup.tables);
  await db.exec("begin; set local standard_conforming_strings=on; set local timezone='UTC';\n" + inserts + "\ncommit;");
  const expected = (await db.query(fingerprintQuery(backup.tables))).rows;
  const manifest = {
    backup: basename(backupPath), sha256: backup.sha256,
    database: "postgres", schema: "public",
    rows: expected.reduce((sum, table) => sum + table.row_count, 0),
    tables: backup.tables.map(({ name, columns, rows }) => ({ name, columns, rowCount: rows.length })),
    fingerprints: expected,
    note: "Application data only. Cluster roles, managed schemas, secrets, and old migration history are not executed or restored.",
  };
  save("data-insert.sql", inserts + "\n");
  save("fingerprints.sql", fingerprintQuery(backup.tables) + ";\n");
  save("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ output, rows: manifest.rows, tables: expected.map(({ table_name, row_count }) => ({ table: table_name, count: row_count })), localRestore: "PASS" }));
} catch (error) {
  // Database error details can contain member names or login codes. Keep those out of logs.
  console.error(JSON.stringify({ localRestore: "FAIL", message: error.message }));
  process.exitCode = 1;
} finally {
  await db.close();
}
