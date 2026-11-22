import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync, symlinkSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFileSync, spawnSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { root, createLocalDatabase, layoutSql, snapshotSql, archiveFromSnapshot, rehearseArchive, encryptArchive, decryptArchive, restoreSchemaSql, restoreDataSql, snapshotFingerprintsSql, validateArchive, readKey, sha256 } from "../scripts/lib/backup-archive.mjs";
import { backupTableOrder, transientTables } from "../scripts/lib/backup-data.mjs";

let source, layout, archive, admin, directory;
const copy = (value) => structuredClone(value);
before(async () => {
  directory = mkdtempSync(join(tmpdir(), "nsct-backup-tests-"));
  source = await createLocalDatabase();
  const query = async (sql, params) => (await source.query(sql, params)).rows[0];
  const group = await query("insert into groups(name,created_at,updated_at) values('復元検証','2026-11-22 12:34:56.123456+09','2026-11-22 12:34:56.987654+09') returning id");
  admin = await query("insert into profiles(group_id,name,email,role,login_code,login_enabled,email_verified_at) values($1,$2,'synthetic@example.invalid','admin','0007',true,now()) returning id,name,login_code_hash", [group.id, "復元テスト'管理者\\\n日本語"]);
  const member = await query("insert into profiles(group_id,name,account_status,login_code) values($1,'停止会員','suspended','0100') returning id", [group.id]);
  const event = await query("insert into calendar_events(group_id,created_by,title,description,start_at) values($1,$2,'練習',$3,'2026-11-22 19:00:00.123456+09') returning id", [group.id, admin.id, "引用符'\t改行\n\\N; DROP TABLE profiles; --"]);
  await query("insert into event_responses(event_id,user_id,status,note) values($1,$2,'attend',null)", [event.id, member.id]);
  const bill = await query("insert into billing_items(group_id,user_id,target_month,category,title,amount,status,paid_at) values($1,$2,'2026-11','tuition','月謝',140000,'paid','2026-11-22 00:00:00.999999Z') returning id", [group.id, member.id]);
  await query("insert into coach_work_logs(group_id,coach_id,work_date,coaching_minutes,travel_expense,status) values($1,$2,'2026-11-22',75,500,'approved')", [group.id, admin.id]);
  await query("insert into coach_reward_adjustments(group_id,coach_id,starts_on,ends_on,pay_rate_percent) values($1,$2,'2026-07-28','2026-10-28',50)", [group.id, admin.id]);
  await query("insert into accounting_income_items(group_id,received_on,payer_name,title,amount) values($1,'2026-11-22','協賛者','協賛金',10000)", [group.id]);
  await query("insert into accounting_expense_items(group_id,spent_on,payee_name,title,amount) values($1,'2026-11-22','施設','会場費',1000)", [group.id]);
  await query("insert into profile_payment_aliases(group_id,profile_id,alias_name,normalized_alias_name) values($1,$2,'カナ','カナ')", [group.id, member.id]);
  const bankImport = await query("insert into bank_csv_imports(group_id,account_number) values($1,'0000123') returning id", [group.id]);
  const transaction = await query("insert into bank_transactions(group_id,import_id,bank_transaction_id,transacted_on,deposit_amount,account_key,status) values($1,$2,'0001','2026-11-22',140000,'fixture-account','matched') returning id", [group.id, bankImport.id]);
  await query("insert into bank_transaction_matches(group_id,transaction_id,direction,match_type,target_id,amount) values($1,$2,'deposit','billing_item',$3,140000)", [group.id, transaction.id, bill.id]);
  await query("insert into developer_feedback(group_id,profile_id,category,message) values($1,$2,'request','復元検証')", [group.id, member.id]);
  await query("insert into ticket_balances(group_id,user_id,remaining_count,expires_at) values($1,$2,-2,'2026-12-31')", [group.id, member.id]);
  await query("insert into app_account_notifications(profile_id,kind,recipient,delivery_status) values($1,'setup','synthetic@example.invalid','sent')", [admin.id]);
  await query("insert into app_sessions(token_hash,profile_id) values($1,$2)", ['a'.repeat(64), admin.id]);
  await query("insert into app_auth_rate_limits(bucket_hash,attempts) values($1,4)", ['b'.repeat(64)]);
  await query("insert into app_account_tokens(profile_id,purpose,token_hash,email,previous_email,status_snapshot) values($1,'reset',$2,'synthetic@example.invalid','','active')", [admin.id, 'c'.repeat(64)]);
  layout = (await source.query(layoutSql)).rows[0].layout;
  await source.exec("set timezone='America/Los_Angeles'");
  archive = archiveFromSnapshot((await source.query(snapshotSql(layout, "test"))).rows[0].snapshot);
});
after(async () => { await source?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });

test("全16保存テーブル・現行20migrationを暗号化し、時差・小数秒・会計・ログインを保持して復元する", async () => {
  assert.equal(archive.migrations.length, 20);
  assert.deepEqual(archive.tables.map((t) => t.name), backupTableOrder);
  assert.ok(archive.tables.every((t) => t.rows.length > 0));
  const key = randomBytes(32);
  const bytes = encryptArchive(archive, key);
  assert.ok(!bytes.includes(Buffer.from(admin.name)));
  assert.ok(!bytes.includes(Buffer.from(admin.login_code_hash)));
  assert.notDeepEqual(encryptArchive(archive, key), bytes);
  const result = await rehearseArchive(decryptArchive(bytes, key));
  assert.equal(result.localRestore, "PASS");
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    // Exercise the exact two scripts an operator would use on a fresh project.
    await db.exec(restoreSchemaSql(archive));
    await db.exec(restoreDataSql(archive, layout));
    assert.deepEqual((await db.query(snapshotFingerprintsSql(layout))).rows, (await source.query(snapshotFingerprintsSql(layout))).rows);
    for (const table of transientTables) assert.equal((await db.query(`select count(*)::integer as n from ${table}`)).rows[0].n, 0);
    const login = (await db.query("select * from authenticate_app_session($1,'0007',$2)", [admin.name, 'd'.repeat(64)])).rows[0];
    assert.equal(login.outcome, "authenticated");
    assert.equal(login.profile_id, admin.id);
    assert.equal((await db.query("select count(*)::integer as n from pg_tables where schemaname='public' and not rowsecurity")).rows[0].n, 0);
    assert.equal((await db.query("select has_function_privilege('anon','public.create_monthly_tuition(uuid,text,integer,text)','execute') as allowed")).rows[0].allowed, false);
    await assert.rejects(db.exec(restoreSchemaSql(archive)), /new empty project/);
    await db.exec('rollback');
  } finally { await db.close(); }
});

test("誤った復号鍵・改ざん・切断・未知の形式は認証に失敗する", () => {
  const key = randomBytes(32), encrypted = encryptArchive(archive, key);
  assert.throws(() => decryptArchive(encrypted, randomBytes(32)), /authentication failed/);
  const corrupt = Buffer.from(encrypted); corrupt[50] ^= 1;
  assert.throws(() => decryptArchive(corrupt, key), /authentication failed/);
  assert.throws(() => decryptArchive(encrypted.subarray(0, -10), key), /authentication failed/);
  assert.throws(() => decryptArchive(Buffer.from("unknown"), key), /authentication failed/);
});

test("列・テーブル・migration履歴・同梱SQL・平文コードの変化を黙って受け入れない", () => {
  for (const change of [
    (a) => a.schema[0].columns.push({ name: 'future_column', type: 'text' }),
    (a) => a.schema.push({ name: 'future_table', columns: [] }),
    (a) => a.tables.pop(),
    (a) => a.migrationVersions.pop(),
    (a) => { a.migrations[0].sql += "\nselect 'tampered';"; },
    (a) => { const p = a.tables.find((t) => t.name === 'profiles'); p.rows[0][p.columns.indexOf('login_code')] = '1234'; },
    (a) => { a.projectRef = 'wswntpyibylcrjjdmguy'; },
  ]) {
    const changed = copy(archive); change(changed);
    assert.throws(() => validateArchive(changed, layout));
  }
});

test("行の欠落・内容変更は元DBのハッシュ検証で検出する", async () => {
  const changed = copy(archive);
  changed.tables.find((t) => t.name === 'billing_items').rows[0][changed.tables.find((t) => t.name === 'billing_items').columns.indexOf('amount')] = '1';
  await assert.rejects(rehearseArchive(changed), /fingerprint mismatch/);
});

test("既存データのある復元先を上書きせず、請求重複も削除・合算しない", async () => {
  const db = await createLocalDatabase();
  try {
    const group = (await db.query("insert into groups(name) values('残すチーム') returning id")).rows[0];
    await assert.rejects(db.exec(restoreDataSql(archive, layout)), /empty destination/);
    await db.exec("rollback");
    assert.equal((await db.query("select id from groups")).rows[0].id, group.id);
    assert.equal((await db.query("select count(*)::integer as n from profiles")).rows[0].n, 0);
  } finally { await db.close(); }
  const duplicate = copy(archive), bills = duplicate.tables.find((t) => t.name === 'billing_items');
  const row = [...bills.rows[0]]; row[bills.columns.indexOf('id')] = '00000000-0000-4000-8000-000000000099'; bills.rows.push(row);
  await assert.rejects(rehearseArchive(duplicate), /duplicate key/);
});

test("鍵は0600で一度だけ作成し、公開権限・symlinkの事故を防ぐ", () => {
  const keyFile = join(directory, 'keys', 'backup.key');
  const key = readKey(keyFile, true);
  assert.deepEqual(readKey(keyFile, true), key);
  assert.equal(statSync(keyFile).mode & 0o777, 0o600);
  chmodSync(keyFile, 0o644);
  assert.throws(() => readKey(keyFile), /private file/);
  chmodSync(keyFile, 0o600);
  const link = join(directory, 'keys', 'linked.key');
  symlinkSync(keyFile, link);
  assert.throws(() => readKey(link), /private file/);
});

test("実CLIで暗号化バックアップを検証・復元準備し、出力権限・上書き拒否・秘密非表示を確認する", () => {
  const keyFile = join(directory, 'cli-keys', 'backup.key'), key = readKey(keyFile, true);
  const file = join(directory, 'fixture.nsct-backup'), output = join(directory, 'restore');
  writeFileSync(file, encryptArchive(archive, key), { mode: 0o600 });
  const stdout = execFileSync(process.execPath, [join(root, 'scripts/backup.mjs'), 'verify', '--environment', 'test', '--backup', file, '--key-file', keyFile], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(JSON.parse(stdout).localRestore, 'PASS');
  assert.ok(!stdout.includes(admin.name));
  execFileSync(process.execPath, [join(root, 'scripts/prepare-backup-restore.mjs'), '--backup', file, '--key-file', keyFile, '--out', output], { cwd: tmpdir() });
  assert.equal(statSync(output).mode & 0o777, 0o700);
  assert.equal(statSync(join(output, 'restore.sql')).mode & 0o777, 0o600);
  const saved = readFileSync(join(output, 'restore.sql'));
  const rerun = spawnSync(process.execPath, [join(root, 'scripts/prepare-backup-restore.mjs'), '--backup', file, '--key-file', keyFile, '--out', output], { encoding: 'utf8' });
  assert.equal(rerun.status, 1);
  assert.deepEqual(readFileSync(join(output, 'restore.sql')), saved);
  const wrongEnv = spawnSync(process.execPath, [join(root, 'scripts/backup.mjs'), 'verify', '--environment', 'production', '--backup', file, '--key-file', keyFile], { encoding: 'utf8' });
  assert.equal(wrongEnv.status, 1);
  assert.ok(!wrongEnv.stderr.includes(admin.name));
  const ambiguous = spawnSync(process.execPath, [join(root, 'scripts/backup.mjs'), 'create', '--environment', 'production', '--environment', 'test'], { encoding: 'utf8' });
  assert.equal(ambiguous.status, 1);
  assert.equal(JSON.parse(ambiguous.stderr).phase, 'arguments');
  const damaged = join(directory, 'damaged.nsct-backup');
  writeFileSync(damaged, Buffer.from('NSCTBK01broken'));
  const invalidOut = join(directory, 'must-not-exist');
  const failure = spawnSync(process.execPath, [join(root, 'scripts/prepare-backup-restore.mjs'), '--backup', damaged, '--key-file', keyFile, '--out', invalidOut]);
  assert.equal(failure.status, 1);
  assert.equal(existsSync(invalidOut), false);
});

test("旧COPYバックアップも実CLIで現行認証migrationまで復元し、一時認証データを除外する", () => {
  const file = join(directory, 'legacy.gz'), output = join(directory, 'legacy-restore');
  writeFileSync(file, gzipSync(`-- PostgreSQL database dump
COPY public.groups (id, name) FROM stdin;
00000000-0000-4000-8000-000000000001\t旧形式
\\.
COPY public.profiles (id, group_id, name, role, login_code, login_enabled) FROM stdin;
00000000-0000-4000-8000-000000000002\t00000000-0000-4000-8000-000000000001\t旧管理者\tadmin\t0007\tt
\\.
COPY public.app_sessions (token_hash, profile_id) FROM stdin;
${'e'.repeat(64)}\t00000000-0000-4000-8000-000000000002
\\.
COPY public.app_auth_rate_limits (bucket_hash, attempts) FROM stdin;
${'f'.repeat(64)}\t1
\\.
COPY public.app_account_tokens (id) FROM stdin;
00000000-0000-4000-8000-000000000003
\\.
`));
  const stdout = execFileSync(process.execPath, [join(root, 'scripts/prepare-backup-restore.mjs'), '--backup', file, '--out', output], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(JSON.parse(stdout).localRestore, 'PASS');
  assert.deepEqual(JSON.parse(readFileSync(join(output, 'manifest.json'))).skippedTables, transientTables);
  assert.ok(!readFileSync(join(output, 'data-insert.sql'), 'utf8').includes('app_sessions'));
});

test("保存失敗では過去世代を保持し、成功時だけ30世代に整理する。日次スキップは通信しない", () => {
  const bin = join(directory, 'mock-cli'), output = join(directory, 'retention'), keyFile = join(directory, 'retention-keys', 'key');
  mkdirSync(bin, { mode: 0o700 }); mkdirSync(output, { mode: 0o700 });
  const key = readKey(keyFile, true), encrypted = encryptArchive(archive, key);
  const response = join(bin, 'response.json'), calls = join(bin, 'calls');
  writeFileSync(response, JSON.stringify({ rows: [{ snapshot: archive }] }));
  writeFileSync(join(bin, 'npx'), `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(process.env.MOCK_CALLS,'called\\n');if(process.env.MOCK_FAIL){console.error('PRIVATE-MEMBER-DO-NOT-LOG');process.exit(1);}process.stdout.write(fs.readFileSync(process.env.MOCK_RESPONSE));`, { mode: 0o700 });
  for (let i = 1; i <= 32; i++) {
    const timestamp = new Date(Date.UTC(2025, 0, i)).toISOString().replaceAll(':', '-');
    writeFileSync(join(output, `${timestamp}-${archive.projectRef}-00000000.nsct-backup`), encrypted, { mode: 0o600 });
  }
  const foreign = '2025-01-01T00-00-00.000000Z-wswntpyibylcrjjdmguy-00000000.nsct-backup';
  writeFileSync(join(output, foreign), 'leave untouched');
  const invoke = (extra = [], fail = false) => spawnSync(process.execPath, [join(root, 'scripts/backup.mjs'), 'create', '--environment', 'test', '--out', output, '--key-file', keyFile, ...extra], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MOCK_RESPONSE: response, MOCK_CALLS: calls, MOCK_FAIL: fail ? '1' : '' },
  });
  const failed = invoke([], true);
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stderr).phase, 'remote-read');
  assert.ok(!failed.stderr.includes('PRIVATE-MEMBER'));
  assert.equal(readdirSync(output).filter((name) => name.endsWith('.nsct-backup')).length, 33);
  assert.equal(existsSync(join(output, 'last-success.json')), false);
  const success = invoke();
  assert.equal(success.status, 0, success.stderr);
  assert.equal(readdirSync(output).filter((name) => name.includes(archive.projectRef) && name.endsWith('.nsct-backup')).length, 30);
  assert.equal(readFileSync(join(output, foreign), 'utf8'), 'leave untouched');
  const callsBefore = readFileSync(calls, 'utf8');
  const skip = invoke(['--scheduled']);
  assert.equal(JSON.parse(skip.stdout).status, 'SKIP');
  assert.equal(readFileSync(calls, 'utf8'), callsBefore);
  const receipt = JSON.parse(readFileSync(join(output, 'last-success.json')));
  writeFileSync(join(output, receipt.file), 'damaged');
  // A real scheduled process has no CODEX environment: CLI returns a bare array.
  writeFileSync(response, JSON.stringify([{ snapshot: archive }]));
  const retry = invoke(['--scheduled']);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(JSON.parse(retry.stdout).status, 'PASS');
  assert.notEqual(readFileSync(calls, 'utf8'), callsBefore);
});

test("statusは成功が古い・ファイル破損・鍵紛失の場合に正常と表示しない", () => {
  const output = join(directory, 'status'), keyFile = join(directory, 'status-keys', 'key');
  mkdirSync(output, { mode: 0o700 });
  const key = readKey(keyFile, true), file = 'current.nsct-backup', bytes = encryptArchive(archive, key);
  writeFileSync(join(output, file), bytes, { mode: 0o600 });
  const receiptFile = join(output, 'last-success.json');
  const receipt = { status: 'PASS', projectRef: archive.projectRef, file, sha256: sha256(bytes), keyId: sha256(key).slice(0, 16), verifiedAt: new Date().toISOString() };
  const save = () => writeFileSync(receiptFile, JSON.stringify(receipt));
  save();
  writeFileSync(join(output, 'last-attempt.json'), JSON.stringify({ status: 'PASS' }));
  const invoke = () => spawnSync(process.execPath, [join(root, 'scripts/backup.mjs'), 'status', '--environment', 'test', '--out', output, '--key-file', keyFile], { encoding: 'utf8' });
  assert.equal(invoke().status, 0);
  receipt.verifiedAt = new Date(Date.now() - 49 * 3600_000).toISOString(); save();
  assert.equal(invoke().status, 1);
  receipt.verifiedAt = new Date().toISOString(); save();
  writeFileSync(join(output, file), 'damaged');
  assert.equal(invoke().status, 1);
  writeFileSync(join(output, file), bytes);
  rmSync(keyFile);
  const missingKey = invoke();
  assert.equal(missingKey.status, 1);
  assert.equal(JSON.parse(missingKey.stdout).healthy, false);
});
