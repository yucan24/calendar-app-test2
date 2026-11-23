import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { root, privateDirectory, projects } from "./lib/backup-archive.mjs";

const label = "jp.nsct.calendar.backup";
const agentDirectory = join(homedir(), "Library/LaunchAgents");
const plistFile = join(agentDirectory, `${label}.plist`);
const logs = join(root, ".backups/logs");
const escapeXml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const program = [process.execPath, join(root, "scripts/backup.mjs"), "create", "--environment", "production", "--scheduled"];
const path = `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}`;
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${program.map((value) => `<string>${escapeXml(value)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${escapeXml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escapeXml(path)}</string></dict>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>3600</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${escapeXml(join(logs, "schedule.log"))}</string>
<key>StandardErrorPath</key><string>${escapeXml(join(logs, "schedule-error.log"))}</string>
<key>Umask</key><integer>63</integer>
</dict></plist>
`;

try {
  const command = process.argv[2] ?? "--print";
  if (command === "--print") console.log(plist);
  else {
    if (process.platform !== "darwin" || !["--install", "--uninstall"].includes(command)) throw new Error();
    const domain = `gui/${process.getuid()}`;
    if (command === "--install") {
      const receipt = JSON.parse(readFileSync(join(root, ".backups/production/last-success.json"), "utf8"));
      if (receipt.status !== "PASS" || receipt.projectRef !== projects.production || !existsSync(join(root, ".backups/production", receipt.file))) throw new Error();
      privateDirectory(logs);
      mkdirSync(agentDirectory, { recursive: true });
      writeFileSync(plistFile, plist, { mode: 0o600 });
    }
    try { execFileSync("/bin/launchctl", ["bootout", `${domain}/${label}`], { stdio: "pipe" }); } catch { /* Not installed yet. */ }
    if (command === "--install") execFileSync("/bin/launchctl", ["bootstrap", domain, plistFile], { stdio: "pipe" });
    else rmSync(plistFile, { force: true });
    console.log(JSON.stringify({ status: "PASS", action: command, label, plistFile, intervalSeconds: 3600, dailyTimezone: "Asia/Tokyo", retainedCopies: 30 }));
  }
} catch {
  console.error(JSON.stringify({ status: "FAIL", help: "See docs/backup.md. A verified production backup is required before installing the schedule." }));
  process.exitCode = 1;
}
