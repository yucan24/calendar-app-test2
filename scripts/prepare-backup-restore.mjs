import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, basename, dirname, join } from "node:path";
import { parsePublicBackup, buildInsertSql, fingerprintQuery } from "./lib/backup-data.mjs";
import { root, createLocalDatabase, decryptArchive, readKey, rehearseArchive, restoreDataSql, restoreSchemaSql, sha256 } from "./lib/backup-archive.mjs";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
let db, output, created = false, key;
try {
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    if (seen.has(args[i])) throw new Error();
    seen.add(args[i]);
    if (!["--backup", "--out", "--key-file"].includes(args[i]) || !args[++i] || args[i].startsWith("--")) throw new Error();
  }
  if (!args.includes("--backup") || !args.includes("--out")) throw new Error();
  const backupPath = resolve(option("--backup"));
  output = resolve(option("--out"));
  const bytes = readFileSync(backupPath);
  let files, manifest;
  if (bytes.subarray(0, 8).toString() === "NSCTBK01") {
    key = readKey(resolve(args.includes("--key-file") ? option("--key-file") : join(root, ".backup-secrets/backup.key")));
    const archive = decryptArchive(bytes, key);
    const result = await rehearseArchive(archive);
    manifest = { ...result, backup: basename(backupPath), sha256: sha256(bytes), environment: archive.environment, migrations: archive.migrations.map(({ name, sha256 }) => ({ name, sha256 })) };
    files = { "schema.sql": restoreSchemaSql(archive), "restore.sql": restoreDataSql(archive, archive.schema) };
  } else {
    // Legacy cluster SQL is parsed as data only, never executed wholesale.
    const backup = parsePublicBackup(bytes);
    db = await createLocalDatabase();
    const inserts = buildInsertSql(backup.tables);
    await db.exec("begin; set local standard_conforming_strings=on; set local timezone='UTC';\n" + inserts + "\ncommit;");
    const expected = (await db.query(fingerprintQuery(backup.tables))).rows;
    manifest = {
      backup: basename(backupPath), sha256: backup.sha256, database: "postgres", schema: "public",
      rows: expected.reduce((sum, table) => sum + table.row_count, 0),
      tables: backup.tables.map(({ name, columns, rows }) => ({ name, columns, rowCount: rows.length })),
      fingerprints: expected, skippedTables: backup.skippedTables, localRestore: "PASS",
      note: "Legacy data converted by current migrations/triggers. Plaintext codes become hashes. Roles, managed schemas and authentication tokens are not restored. This output is preparation only, not a safe remote apply script.",
    };
    files = { "data-insert.sql": inserts, "fingerprints.sql": fingerprintQuery(backup.tables) + ";" };
  }
  // Nothing is emitted until validation and the full local restore succeed.
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  mkdirSync(output, { mode: 0o700 });
  created = true;
  for (const [name, content] of Object.entries(files)) writeFileSync(join(output, name), content + "\n", { mode: 0o600, flag: "wx" });
  writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ output, rows: manifest.rows, localRestore: "PASS" }));
} catch {
  if (created) rmSync(output, { recursive: true, force: true });
  console.error(JSON.stringify({ localRestore: "FAIL", help: "See docs/backup.md. No cloud writes or partial output. Database details are omitted to protect personal data." }));
  process.exitCode = 1;
} finally {
  key?.fill(0);
  await db?.close();
}
