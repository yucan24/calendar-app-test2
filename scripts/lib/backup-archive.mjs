import { readFileSync, readdirSync, lstatSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { backupTableOrder, transientTables, identifier, sqlString, buildInsertSql } from "./backup-data.mjs";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const projects = { production: "wswntpyibylcrjjdmguy", test: "xvgqwdiyoorzejfozoca" };
const magic = Buffer.from("NSCTBK01");
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function migrations() {
  return readdirSync(join(root, "supabase/migrations")).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort().map((name) => {
    const sql = readFileSync(join(root, "supabase/migrations", name), "utf8");
    return { name, sql, sha256: sha256(sql) };
  });
}

export const permissionsSql = () => readFileSync(join(root, "supabase/production/restrict-public-access.sql"), "utf8");

export function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error("Backup directory must be private (0700), without symlinks");
}

export function readKey(path, create = false) {
  if (create) {
    privateDirectory(dirname(path));
    try { writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error("Backup key must be a private file (0600)");
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error("Invalid backup key");
  return key;
}

export function encryptArchive(archive, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(magic);
  const body = Buffer.concat([cipher.update(gzipSync(JSON.stringify(archive))), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), body]);
}

export function decryptArchive(bytes, key) {
  try {
    if (bytes.length < 37 || !bytes.subarray(0, 8).equals(magic)) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(8, 20));
    decipher.setAAD(magic);
    decipher.setAuthTag(bytes.subarray(20, 36));
    const compressed = Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
    return JSON.parse(gunzipSync(compressed, { maxOutputLength: 256 * 1024 * 1024 }).toString("utf8"));
  } catch { throw new Error("Backup authentication failed: wrong key, unsupported format or damaged file"); }
}

export function savePrivateJson(path, value) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.pending`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

export const layoutSql = `select coalesce(jsonb_agg(jsonb_build_object('name',t.tablename,'columns',(
  select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod)) order by a.attnum)
  from pg_attribute a where a.attrelid=(quote_ident(t.schemaname)||'.'||quote_ident(t.tablename))::regclass and a.attnum>0 and not a.attisdropped
)) order by t.tablename),'[]'::jsonb) as layout from pg_tables t where t.schemaname='public'`;

export async function createLocalDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec("create schema extensions; create role anon; create role authenticated; create role service_role bypassrls; create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);");
    for (const migration of migrations()) {
      await db.exec(migration.sql);
      await db.query("insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)", [migration.name.slice(0, 14), migration.name.slice(15, -4), [migration.sql]]);
    }
    await db.exec(permissionsSql());
    return db;
  } catch (error) { await db.close(); throw error; }
}

export async function currentLayout() {
  const db = await createLocalDatabase();
  try { return (await db.query(layoutSql)).rows[0].layout; }
  finally { await db.close(); }
}

// Cells are text/null, including numeric values and six-digit fractional seconds.
// Explicit UTC formatting makes the snapshot independent of server TimeZone.
function cellSql(column) {
  const name = identifier(column.name);
  if (column.type === "timestamp with time zone") return `to_char(${name} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'+00:00'`;
  if (column.type === "date") return `to_char(${name},'YYYY-MM-DD')`;
  return `${name}::text`;
}

function tableDataSql(table) {
  return `select coalesce(jsonb_agg(jsonb_build_array(${table.columns.map(cellSql).join(",")}) order by id),'[]'::jsonb) as data from public.${identifier(table.name)}`;
}

export function snapshotSql(layout, environment) {
  const projectRef = projects[environment];
  if (!projectRef) throw new Error("Choose --environment production or test");
  const tables = backupTableOrder.map((name) => {
    const table = layout.find((table) => table.name === name);
    if (!table) throw new Error("Incomplete local schema");
    return `(select jsonb_build_object('name',${sqlString(name)},'columns',${sqlString(JSON.stringify(table.columns.map((c) => c.name)))}::jsonb,'rows',data,'digest',md5(data::text)) from (${tableDataSql(table)}) d)`;
  });
  // One SELECT, one MVCC snapshot across all tables and migration metadata.
  return `select jsonb_build_object('format','nsct-backup','version',1,'environment',${sqlString(environment)},'projectRef',${sqlString(projectRef)},
    'createdAt',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'schema',(${layoutSql}),
    'migrationVersions',(select coalesce(jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations),
    'tables',jsonb_build_array(${tables.join(",\n")})) as snapshot;`;
}

function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function sortedLayout(layout) { return layout.map(({ name, columns }) => ({ name, columns: columns.map(({ name, type }) => ({ name, type })) })).sort((a, b) => a.name.localeCompare(b.name)); }

export function validateArchive(archive, layout) {
  if (archive?.format !== "nsct-backup" || archive.version !== 1 || projects[archive.environment] !== archive.projectRef || !projects[archive.environment] || !Number.isFinite(Date.parse(archive.createdAt))) throw new Error("Unsupported backup manifest");
  if (!same(archive.migrations, migrations()) || archive.permissionsSql !== permissionsSql()) throw new Error("Backup schema version differs from this checkout; use the matching source revision");
  if (!same(archive.migrationVersions, migrations().map((m) => m.name.slice(0, 14)))) throw new Error("Remote migration history differs from the backup schema");
  if (!same(sortedLayout(archive.schema), sortedLayout(layout))) throw new Error("Remote table/column schema differs from the backup schema");
  if (!Array.isArray(archive.tables) || !same(archive.tables.map((t) => t.name), backupTableOrder)) throw new Error("Incomplete backup table list");
  for (const table of archive.tables) {
    const definition = layout.find((t) => t.name === table.name);
    if (!same(table.columns, definition.columns.map((c) => c.name)) || !/^[a-f0-9]{32}$/.test(table.digest) || !Array.isArray(table.rows)) throw new Error("Invalid backup table definition");
    for (const row of table.rows) {
      if (!Array.isArray(row) || row.length !== table.columns.length || row.some((v) => v !== null && typeof v !== "string")) throw new Error("Invalid backup cells");
      if (table.name === "profiles" && row[table.columns.indexOf("login_code")] !== null) throw new Error("Plaintext credentials are not allowed in current backups");
    }
  }
}

export function snapshotFingerprintsSql(layout) {
  return backupTableOrder.map((name) => {
    const table = layout.find((t) => t.name === name);
    return `select ${sqlString(name)} as table_name,jsonb_array_length(data) as row_count,md5(data::text) as digest from (${tableDataSql(table)}) d`;
  }).join("\nunion all\n") + " order by table_name";
}

export function restoreDataSql(archive, layout) {
  const expected = archive.tables.map((t) => `(${sqlString(t.name)},${t.rows.length},${sqlString(t.digest)})`).join(",");
  const allTables = [...backupTableOrder, ...transientTables].map((t) => `public.${identifier(t)}`).join(",");
  return `begin;
set local lock_timeout='10s'; set local statement_timeout='120s'; set local standard_conforming_strings=on; set local timezone='UTC';
lock table ${allTables},supabase_migrations.schema_migrations in access exclusive mode;
do $empty_destination$ begin
if exists (${[...backupTableOrder, ...transientTables].map((t) => `select 1 from public.${identifier(t)}`).join(" union all ")}) then raise exception 'Restore requires an empty destination. No rows were changed.'; end if;
if (select coalesce(jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations)<>${sqlString(JSON.stringify(archive.migrationVersions))}::jsonb then raise exception 'Unexpected destination migration history'; end if;
if (${layoutSql})<>${sqlString(JSON.stringify(layout))}::jsonb then raise exception 'Unexpected destination schema'; end if;
end $empty_destination$;
${buildInsertSql(archive.tables)}
do $verify_restore$ begin
if exists(select 1 from (${snapshotFingerprintsSql(layout)}) actual full join (values ${expected}) expected(table_name,row_count,digest) using(table_name)
where actual.row_count is distinct from expected.row_count or actual.digest is distinct from expected.digest) then raise exception 'Restore fingerprint mismatch. No rows were committed.'; end if;
end $verify_restore$;
${permissionsSql()}
notify pgrst,'reload schema';
commit;`;
}

export function restoreSchemaSql(archive) {
  return `begin;
set local standard_conforming_strings=on;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text);
do $new_project$ begin
if exists(select 1 from pg_tables where schemaname='public') or exists(select 1 from supabase_migrations.schema_migrations) then raise exception 'Schema restore requires a new empty project'; end if;
end $new_project$;
create schema if not exists extensions;
${archive.migrations.map((m) => `${m.sql}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${sqlString(m.name.slice(0, 14))},${sqlString(m.name.slice(15, -4))},array[${sqlString(m.sql)}]);`).join("\n")}
${permissionsSql()}
notify pgrst,'reload schema';
commit;`;
}

export async function rehearseArchive(archive) {
  const db = await createLocalDatabase();
  try {
    const layout = (await db.query(layoutSql)).rows[0].layout;
    validateArchive(archive, layout);
    await db.exec(restoreDataSql(archive, layout));
    const fingerprints = (await db.query(snapshotFingerprintsSql(layout))).rows;
    return { localRestore: "PASS", projectRef: archive.projectRef, createdAt: archive.createdAt, rows: fingerprints.reduce((n, t) => n + t.row_count, 0), tables: fingerprints.map(({ table_name, row_count }) => ({ table: table_name, count: row_count })), resetTables: transientTables };
  } finally { await db.close(); }
}

export function archiveFromSnapshot(snapshot) {
  return { ...snapshot, migrations: migrations(), permissionsSql: permissionsSql() };
}
