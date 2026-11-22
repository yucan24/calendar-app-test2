import { readFileSync, writeFileSync, readdirSync, mkdtempSync, renameSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { root, projects, privateDirectory, readKey, encryptArchive, decryptArchive, savePrivateJson, currentLayout, snapshotSql, archiveFromSnapshot, rehearseArchive, sha256 } from "./lib/backup-archive.mjs";

const run = promisify(execFile);
const args = process.argv.slice(2);
const command = args.shift();
let phase = "arguments", directory, temporary, pending, key;
const value = (name) => args[args.indexOf(name) + 1];
const day = (date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(date));

try {
  if (!['create', 'verify', 'status'].includes(command)) throw new Error();
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    if (seen.has(args[i])) throw new Error();
    seen.add(args[i]);
    if (args[i] === "--scheduled") continue;
    if (!["--environment", "--out", "--key-file", "--backup"].includes(args[i]) || !args[++i] || args[i].startsWith("--")) throw new Error();
  }
  const environment = args.includes("--environment") ? value("--environment") : undefined;
  if (!projects[environment]) throw new Error();
  directory = resolve(args.includes("--out") ? value("--out") : join(root, ".backups", environment));
  const keyFile = resolve(args.includes("--key-file") ? value("--key-file") : join(root, ".backup-secrets/backup.key"));
  if (command === "status") {
    phase = "status";
    const success = join(directory, "last-success.json"), attempt = join(directory, "last-attempt.json");
    const lastSuccess = existsSync(success) ? JSON.parse(readFileSync(success, "utf8")) : null;
    const lastAttempt = existsSync(attempt) ? JSON.parse(readFileSync(attempt, "utf8")) : null;
    let authenticated = false;
    try {
      key = readKey(keyFile);
      authenticated = sha256(readFileSync(join(directory, lastSuccess.file))) === lastSuccess.sha256 && sha256(key).slice(0, 16) === lastSuccess.keyId;
    } catch { /* Missing file or key is unhealthy, without exposing either. */ }
    const fresh = authenticated && lastSuccess?.projectRef === projects[environment] && Date.now() - Date.parse(lastSuccess.verifiedAt) < 48 * 3600_000;
    console.log(JSON.stringify({ environment, lastSuccess, lastAttempt, healthy: Boolean(fresh && lastAttempt?.status === "PASS") }));
    if (!fresh || lastAttempt?.status !== "PASS") process.exitCode = 1;
  } else if (command === "verify") {
    phase = "verify";
    if (!args.includes("--backup")) throw new Error();
    key = readKey(keyFile);
    const archive = decryptArchive(readFileSync(resolve(value("--backup"))), key);
    if (archive.projectRef !== projects[environment]) throw new Error();
    console.log(JSON.stringify(await rehearseArchive(archive)));
  } else {
    phase = "storage";
    privateDirectory(directory);
    const previousFile = join(directory, "last-success.json");
    const knownDirectories = [directory, ...Object.keys(projects).map((name) => join(root, ".backups", name))];
    if (!existsSync(keyFile) && knownDirectories.some((folder) => existsSync(folder) && readdirSync(folder).some((name) => name.endsWith(".nsct-backup")))) throw new Error();
    key = readKey(keyFile, true);
    if (existsSync(previousFile)) {
      const previous = JSON.parse(readFileSync(previousFile, "utf8"));
      if (previous.projectRef !== projects[environment] || previous.keyId !== sha256(key).slice(0, 16)) throw new Error();
    }
    if (args.includes("--scheduled") && existsSync(previousFile)) {
      const previous = JSON.parse(readFileSync(previousFile, "utf8"));
      if (previous.projectRef === projects[environment] && day(previous.createdAt) === day(Date.now()) && existsSync(join(directory, previous.file))) {
        // Authenticate today's stored file too; a missing/damaged copy must not
        // cause the scheduler to quietly skip a replacement.
        try {
          const previousBytes = readFileSync(join(directory, previous.file));
          const existing = decryptArchive(previousBytes, key);
          if (sha256(previousBytes) === previous.sha256 && existing.projectRef === projects[environment]) {
            savePrivateJson(join(directory, "last-attempt.json"), { status: "PASS", attemptedAt: new Date().toISOString(), projectRef: projects[environment], skipped: true });
            console.log(JSON.stringify({ status: "SKIP", reason: "Already backed up today (Asia/Tokyo)", file: previous.file }));
            key.fill(0);
            process.exit(0);
          }
        } catch { /* Replace a damaged backup with a newly verified snapshot. */ }
      }
    }
    phase = "schema";
    const layout = await currentLayout();
    temporary = mkdtempSync(join(tmpdir(), "nsct-backup-query-"));
    const sqlFile = join(temporary, "snapshot.sql");
    writeFileSync(sqlFile, snapshotSql(layout, environment), { mode: 0o600, flag: "wx" });
    phase = "remote-read";
    const { stdout } = await run("npx", ["--yes", "supabase@3.2.0", "db", "query", `--remote=${projects[environment]}`, "--read-only", "--file", sqlFile, "--output", "json"], {
      cwd: root, maxBuffer: 256 * 1024 * 1024, timeout: 180_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    const result = JSON.parse(stdout);
    // CLI 3.2 wraps rows for agents; normal terminals/launchd get a plain array.
    const rows = Array.isArray(result) ? result : result.rows;
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0].snapshot) throw new Error();
    const archive = archiveFromSnapshot(rows[0].snapshot);
    if (archive.projectRef !== projects[environment]) throw new Error();
    phase = "encrypt";
    const filename = `${archive.createdAt.replaceAll(":", "-")}-${projects[environment]}-${randomBytes(4).toString("hex")}.nsct-backup`;
    const bytes = encryptArchive(archive, key);
    pending = join(directory, `.${filename}.pending`);
    writeFileSync(pending, bytes, { flag: "wx", mode: 0o600 });
    phase = "restore-rehearsal";
    const stored = readFileSync(pending);
    const verified = await rehearseArchive(decryptArchive(stored, key));
    phase = "publish";
    renameSync(pending, join(directory, filename));
    pending = undefined;
    const receipt = { status: "PASS", environment, ...verified, verifiedAt: new Date().toISOString(), file: filename, sha256: sha256(stored), keyId: sha256(key).slice(0, 16), migrations: archive.migrations.length };
    savePrivateJson(previousFile, receipt);
    savePrivateJson(join(directory, "last-attempt.json"), { status: "PASS", attemptedAt: receipt.verifiedAt, projectRef: archive.projectRef });
    phase = "retention";
    // Only this project's successful artifacts, never other files, are pruned.
    const pattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}T[0-9.-]+Z-${projects[environment]}-[a-f0-9]{8}\\.nsct-backup$`);
    const previous = readdirSync(directory).filter((name) => pattern.test(name) && name !== filename).sort().reverse();
    for (const expired of previous.slice(29)) rmSync(join(directory, expired));
    console.log(JSON.stringify(receipt));
  }
} catch {
  // Raw CLI/SQL errors can contain names, emails or credentials. Never echo them.
  const failure = { status: "FAIL", phase, attemptedAt: new Date().toISOString() };
  if (directory && command === "create" && phase !== "arguments") {
    try { savePrivateJson(join(directory, "last-attempt.json"), failure); } catch { /* Preserve the original failure. */ }
  }
  console.error(JSON.stringify({ ...failure, help: "See docs/backup.md; no remote writes are performed." }));
  process.exitCode = 1;
} finally {
  key?.fill(0);
  if (pending) rmSync(pending, { force: true });
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
