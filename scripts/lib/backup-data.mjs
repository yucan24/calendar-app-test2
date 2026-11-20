import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

export const applicationTableOrder = [
  "groups", "profiles", "calendar_events", "event_responses", "billing_items",
  "coach_work_logs", "coach_reward_adjustments", "accounting_income_items",
  "accounting_expense_items", "profile_payment_aliases", "bank_csv_imports",
  "bank_transactions", "bank_transaction_matches", "developer_feedback", "ticket_balances",
];

export function identifier(value) {
  if (!/^[a-z_][a-z_0-9]*$/.test(value)) throw new Error("Unsupported SQL identifier");
  return `"${value}"`;
}

export function sqlString(value) {
  if (value === null) return "NULL";
  if (value.includes("\0")) throw new Error("Postgres text cannot contain NUL");
  return `'${value.replaceAll("'", "''")}'`;
}

export function decodeCopyValue(value) {
  if (value === "\\N") return null;
  const escaped = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\" };
  const chunks = [];
  let position = 0;
  for (const match of value.matchAll(/\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)/g)) {
    chunks.push(Buffer.from(value.slice(position, match.index), "utf8"));
    const token = match[1];
    if (/^[0-7]/.test(token)) chunks.push(Buffer.from([parseInt(token, 8)]));
    else if (token.startsWith("x") && token.length > 1) chunks.push(Buffer.from([parseInt(token.slice(1), 16)]));
    else chunks.push(Buffer.from(escaped[token] ?? token, "utf8"));
    position = match.index + match[0].length;
  }
  chunks.push(Buffer.from(value.slice(position), "utf8"));
  return Buffer.concat(chunks).toString("utf8");
}

export function parsePublicBackup(compressed) {
  const sql = gunzipSync(compressed).toString("utf8");
  if (!sql.includes("PostgreSQL database")) throw new Error("Expected a PostgreSQL SQL dump");
  const hasConnections = /^\\connect /m.test(sql);
  let database = hasConnections ? null : "postgres";
  const tables = new Map();
  let active = null;
  for (const line of sql.split(/\r?\n/)) {
    if (active) {
      if (line === "\\.") { active = null; continue; }
      const values = line.split("\t");
      if (values.length !== active.columns.length) throw new Error(`COPY column count mismatch: ${active.name}`);
      active.rows.push(values.map(decodeCopyValue));
      continue;
    }
    const connection = /^\\connect (?:"([^"]+)"|(\S+))/.exec(line);
    if (connection) { database = connection[1] ?? connection[2]; continue; }
    if (database !== "postgres") continue;
    const copy = /^COPY public\.([a-z_][a-z_0-9]*) \(([^\n]+)\) FROM stdin;$/.exec(line);
    if (!copy) continue;
    const name = copy[1];
    if (!applicationTableOrder.includes(name)) throw new Error(`Unknown public table: ${name}`);
    if (tables.has(name)) throw new Error(`Duplicate COPY block: ${name}`);
    const columns = copy[2].split(/,\s*/).map((column) => column.replace(/^"|"$/g, ""));
    columns.forEach(identifier);
    if (!columns.includes("id")) throw new Error(`Missing stable ID: ${name}`);
    active = { name, columns, rows: [] };
    tables.set(name, active);
  }
  if (active) throw new Error("Unterminated COPY block");
  if (!tables.has("profiles") || !tables.has("groups")) throw new Error("Application tables were not found");
  return {
    sha256: createHash("sha256").update(compressed).digest("hex"),
    tables: applicationTableOrder.filter((name) => tables.has(name)).map((name) => tables.get(name)),
  };
}

export function buildInsertSql(tables) {
  return tables.filter((table) => table.rows.length > 0).map((table) => {
    const columns = [...table.columns];
    const needsAccountKey = table.name === "bank_transactions" && !columns.includes("account_key");
    if (needsAccountKey) columns.push("account_key");
    const values = table.rows.map((row) => {
      const fields = row.map(sqlString);
      if (needsAccountKey) {
        const importId = row[table.columns.indexOf("import_id")];
        const id = row[table.columns.indexOf("id")];
        fields.push(`coalesce((select public.bank_account_key(jsonb_build_object('bankName',i.bank_name,'branchName',i.branch_name,'accountType',i.account_type,'accountNumber',i.account_number)) from public.bank_csv_imports i where i.id=${sqlString(importId)}::uuid), ${sqlString(`legacy:${id}`)})`);
      }
      return `(${fields.join(",")})`;
    });
    return `insert into public.${identifier(table.name)} (${columns.map(identifier).join(",")}) values\n${values.join(",\n")};`;
  }).join("\n\n");
}

export function fingerprintQuery(tables, projected = true) {
  return tables.map((table) => {
    const columns = projected ? table.columns.map(identifier).join(",") : "*";
    return `select ${sqlString(table.name)} as table_name,count(*)::integer as row_count,md5(coalesce(jsonb_agg(to_jsonb(q) order by q.id)::text,'[]')) as digest from (select ${columns} from public.${identifier(table.name)}) q`;
  }).join("\nunion all\n") + " order by table_name";
}

export function fingerprintAssertions(manifest, tables, projected = true) {
  const query = fingerprintQuery(tables, projected);
  const expected = manifest.map((entry) => `(${sqlString(entry.table_name)},${entry.row_count},${sqlString(entry.digest)})`).join(",\n");
  return `do $restore_fingerprints$\nbegin\nif exists(\nselect 1 from (${query}) actual\nfull join (values ${expected}) expected(table_name,row_count,digest) using(table_name)\nwhere actual.row_count is distinct from expected.row_count or actual.digest is distinct from expected.digest\n) then raise exception 'Restore fingerprint mismatch. No changes committed.'; end if;\nend;\n$restore_fingerprints$;`;
}
