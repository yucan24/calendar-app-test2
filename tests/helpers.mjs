import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import Module from "node:module";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

export function loadTs(filename, mocks = {}) {
  const fullPath = resolve(filename);
  const compiled = new Module(fullPath);
  compiled.filename = fullPath;
  compiled.paths = Module._nodeModulePaths(dirname(fullPath));
  const originalRequire = compiled.require.bind(compiled);
  compiled.require = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    const local = name.startsWith("@/") ? resolve("src", name.slice(2)) : name.startsWith(".") ? resolve(dirname(fullPath), name) : null;
    if (local) for (const extension of [".ts", ".tsx"]) if (existsSync(local + extension)) return loadTs(local + extension, mocks);
    return originalRequire(name);
  };
  compiled._compile(ts.transpileModule(readFileSync(fullPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, fullPath);
  return compiled.exports;
}

export async function createTestDatabase(beforeLatest) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("create schema extensions; create role anon; create role authenticated; create role service_role bypassrls;");
  for (const filename of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()) {
    if (filename.startsWith("20261120010000_") && beforeLatest) await beforeLatest(db);
    const sql = readFileSync(`supabase/migrations/${filename}`, "utf8");
    try { await db.exec(sql); }
    catch (error) { await db.close(); throw new Error(`${filename}: ${error.message}`); }
  }
  return db;
}

export async function createTeam(db) {
  const { rows: [group] } = await db.query("insert into groups(name) values('検証チーム') returning id");
  const { rows: [admin] } = await db.query(
    "insert into profiles(group_id,name,role,login_enabled) values($1,$2,'admin',true) returning id",
    [group.id, `検証管理者-${group.id}`]);
  return { groupId: group.id, adminId: admin.id };
}

export async function importTransactions(db, team, transactions, account = "1234567") {
  return (await db.query("select * from import_bank_transactions($1,$2::jsonb,$3::jsonb)", [
    team.adminId,
    JSON.stringify({ bankName: "検証銀行", branchName: "検証支店", accountType: "普通", accountNumber: account }),
    JSON.stringify(transactions.map((item) => ({ transactedOn: "2026-11-20", withdrawalAmount: 0,
      depositAmount: 0, description: "検証", normalizedDescription: "検証", balance: null, ...item }))),
  ])).rows[0];
}

export async function transactionId(db, team, number) {
  return (await db.query("select id from bank_transactions where group_id=$1 and bank_transaction_id=$2", [team.groupId, number])).rows[0].id;
}

// HTTPを使わず、実際のPostgresへServer Actionの問い合わせを渡すテスト用アダプター。
export function postgresClient(db) {
  const identifier = (value) => {
    if (!/^[a-z_][a-z_0-9]*$/.test(value)) throw new Error(`Invalid identifier: ${value}`);
    return `"${value}"`;
  };
  const result = async (sql, params, single = false) => {
    try {
      const { rows } = await db.query(sql, params);
      return { data: single ? rows[0] ?? null : rows, error: null };
    } catch (error) { return { data: null, error: { message: error.message } }; }
  };
  return {
    rpc(name, args) {
      const entries = Object.entries(args);
      const orders = [];
      let limit, offset;
      const query = {
        order(column, options = {}) { orders.push(`${identifier(column)} ${options.ascending === false ? "desc" : "asc"}`); return query; },
        range(from, to) { offset = from; limit = to - from + 1; return query; },
        then(resolveResult, reject) {
          let sql = `select * from ${identifier(name)}(${entries.map(([key], index) => `${identifier(key)} => $${index + 1}`).join(",")})`;
          if (orders.length) sql += ` order by ${orders.join(",")}`;
          if (limit !== undefined) sql += ` limit ${limit} offset ${offset}`;
          return result(sql, entries.map(([, value]) => value)).then(resolveResult, reject);
        },
      };
      return query;
    },
    from(table) {
      const params = [], conditions = [], orders = [];
      let selection = "*", operation = "select", values, limit, offset = 0;
      const columnList = (columns) => columns === "*" ? "*" : columns.split(",").map((column) => identifier(column.trim())).join(",");
      const bind = (value) => { params.push(value); return `$${params.length}`; };
      const run = (single = false) => {
        let sql;
        if (operation === "insert" || operation === "upsert") {
          const rows = Array.isArray(values) ? values : [values];
          const columns = Object.keys(rows[0]);
          sql = `insert into ${identifier(table)}(${columns.map(identifier).join(",")}) values${rows.map((row) => `(${columns.map((key) => bind(row[key])).join(",")})`).join(",")}`;
          if (operation === "upsert") sql += ` on conflict(${conflictColumns.split(",").map(identifier).join(",")}) do update set ${columns.map((key) => `${identifier(key)}=excluded.${identifier(key)}`).join(",")}`;
          sql += ` returning ${columnList(selection)}`;
        } else if (operation === "update") {
          sql = `update ${identifier(table)} set ${Object.entries(values).map(([key, value]) => `${identifier(key)}=${bind(value)}`).join(",")}`;
        } else if (operation === "delete") sql = `delete from ${identifier(table)}`;
        else sql = `select ${columnList(selection)} from ${identifier(table)}`;
        if (conditions.length && !["insert", "upsert"].includes(operation)) sql += ` where ${conditions.join(" and ")}`;
        if (operation === "update") sql += ` returning ${columnList(selection)}`;
        if (orders.length) sql += ` order by ${orders.join(",")}`;
        if (limit !== undefined) sql += ` limit ${limit} offset ${offset}`;
        return result(sql, params, single);
      };
      let conflictColumns;
      const query = {
        select(columns) { selection = columns; return query; },
        insert(data) { operation = "insert"; values = data; return query; },
        update(data) { operation = "update"; values = data; return query; },
        delete() { operation = "delete"; return query; },
        upsert(data, options) { operation = "upsert"; values = data; conflictColumns = options.onConflict; return query; },
        order(column, options = {}) { orders.push(`${identifier(column)} ${options.ascending === false ? "desc" : "asc"}`); return query; },
        range(from, to) { offset = from; limit = to - from + 1; return query; },
        limit(count) { limit = count; return query; },
        in(column, values) { conditions.push(values.length ? `${identifier(column)} in (${values.map(bind).join(",")})` : "false"); return query; },
        single() { return run(true); },
        maybeSingle() { return run(true); },
        then(resolveResult, reject) { return run().then(resolveResult, reject); },
      };
      for (const [method, operator] of Object.entries({ eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" })) {
        query[method] = (column, value) => { conditions.push(`${identifier(column)}${operator}${bind(value)}`); return query; };
      }
      return query;
    },
  };
}
