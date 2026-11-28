import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { loadTs, createTestDatabase, createTeam, postgresClient } from "./helpers.mjs";

function nodes(node, predicate, result = []) {
  if (!node || typeof node !== "object") return result;
  if (Array.isArray(node)) { node.forEach(child => nodes(child, predicate, result)); return result; }
  if (predicate(node)) result.push(node);
  nodes(node.props?.children, predicate, result);
  return result;
}

function textOf(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return node ? textOf(node.props?.children) : "";
}

function mount(overrides = {}, actionOverrides = {}) {
  const slots = [], jobs = [], calls = []; let cursor = 0, refreshes = 0;
  const first = { id: "morning", title: "通常練習予定", location: "総合運動公園", time_text: "09:00-12:00", start_at: "2026-11-27T15:00:00Z", display_type: "normal", attendance_required: true };
  const baseLog = { id: "mine", batch_id: "batch", coach_id: "me", entered_by: "me", work_date: "2026-11-28", coaching_minutes: 120, admin_minutes: 30, travel_expense: 500, other_expense: 100, note: "立替の内訳", created_at: "2026-11-28T01:00:00Z", updated_at: "2026-11-28T01:00:00Z" };
  const props = { currentAdmin: { id: "me", name: "本人" }, targetMonth: "2026-11", anchorDate: "2026-11-28", todayKey: "2026-11-28", coaches: [{ id: "me", name: "本人", can_record: true }, { id: "other", name: "補助", can_record: true }], events: [{ ...first, id: "afternoon", title: "午後合同練習", time_text: "14:00-17:00" }, first], logs: [baseLog, { ...baseLog, id: "other-log", coach_id: "other", coaching_minutes: 60, travel_expense: 0, other_expense: 0 }, { ...baseLog, id: "next-month", work_date: "2026-12-01", coaching_minutes: 6000 }], ...overrides };
  const mocks = Object.fromEntries(["createCoachWorkLogs", "createCoachWorkLogsForDates", "updateCoachWorkLog", "deleteCoachWorkLog"].map(name => [name, async data => { calls.push({ name, data }); }]));
  const Component = loadTs("src/app/admin/coach-work/CoachWorkCalendarClient.tsx", {
    react: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useMemo: fn => fn(), useTransition: () => [false, fn => jobs.push(fn())],
    },
    "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
    "@/components/ui/CalendarToolbar": () => null,
    "@/components/LogoutButton": () => null,
    "@/components/SubmitButton": () => null,
    "./actions": { ...mocks, ...actionOverrides },
  }).default;
  return { props, jobs, calls, render() { cursor = 0; return Component(props); }, get refreshes() { return refreshes; } };
}

function day(ui, date = "2026-11-28") { return nodes(ui.render(), node => node.props?.["data-date-key"] === date)[0]; }
function selectDay(ui, date) { day(ui, date).props.onKeyDown({ key: "Enter", preventDefault() {} }); }
function toolbar(ui) { return nodes(ui.render(), node => node.props?.baseHref === "/admin/coach-work")[0]; }
function formWith(ui, name) { return nodes(ui.render(), node => node.type === "form" && nodes(node, child => child.props?.name === name).length)[0]; }
function formDefaults(form) {
  const data = new FormData();
  for (const field of nodes(form, node => ["input", "textarea", "select"].includes(node.type) && node.props.name)) {
    const p = field.props;
    if (p.type === "checkbox") { if (p.defaultChecked) data.append(p.name, p.value ?? "on"); }
    else data.append(p.name, p.value ?? p.defaultValue ?? "");
  }
  return data;
}

test("勤怠も月・週・日の表示範囲と共通操作欄を使い、範囲外の年の日付を無効にする", () => {
  for (const [view, count] of [["month", 42], ["week", 7], ["day", 1]]) {
    const ui = mount({ view });
    assert.equal(nodes(ui.render(), node => node.props?.["data-date-key"]).length, count);
    assert.equal(toolbar(ui).props.view, view); assert.equal(toolbar(ui).props.anchorDate, "2026-11-28");
  }
  for (const targetMonth of ["0001-01", "9999-12"]) {
    const ui = mount({ targetMonth, anchorDate: `${targetMonth}-01` });
    const invalid = nodes(ui.render(), node => node.props?.["data-date-key"] && !/^\d{4}-/.test(node.props["data-date-key"]));
    assert.ok(invalid.every(node => node.props.disabled));
  }
});

test("予定は時間順に全件表示し、期間は帯に分け、指導・事務は自分と全員を表示する", () => {
  const ui = mount();
  ui.props.events.push(...["2026-11-28", "2026-11-29"].map(date => ({ ...ui.props.events[0], id: date, title: "遠征期間", time_text: null, start_at: `${date}T00:00:00+09:00`, attendance_required: false, display_type: "period" })));
  const previews = nodes(day(ui), node => node.type?.name === "CalendarEventPreview");
  assert.deepEqual(previews.map(node => node.props.event.id), ["morning", "afternoon"]);
  assert.ok(previews.every(node => node.props.showAttendance === false));
  assert.ok(nodes(day(ui), node => node.props?.["aria-label"] === "自分の指導2時間、全員の指導3時間").length);
  assert.ok(nodes(day(ui), node => node.props?.["aria-label"] === "自分の事務30分、全員の事務1時間").length);
  assert.equal(nodes(ui.render(), node => node.type?.name === "CalendarPeriodBands")[0].props.groups[0].events.length, 2);
});

test("日表示の時間枠から当日の勤怠フォームを開き、小数時間・実費・対象日を保存する", async () => {
  const ui = mount({ view: "day" });
  const timeline = nodes(ui.render(), node => node.type?.name === "CalendarDayTimeline")[0];
  assert.equal(timeline.props.showAttendance, false);
  assert.deepEqual(timeline.props.events.map(event => event.id), ["morning", "afternoon"]);
  timeline.props.onSelect("afternoon");
  const form = formWith(ui, "coach_ids"), data = formDefaults(form);
  assert.equal(data.get("work_date"), "2026-11-28"); assert.deepEqual(data.getAll("coach_ids"), ["me"]);
  data.set("coaching_hours", "1.5"); data.set("admin_hours", "0.25"); data.set("travel_expense", "500"); data.set("other_expense", "100"); data.set("note", "内訳");
  form.props.action(data); await Promise.all(ui.jobs);
  assert.equal(ui.calls[0].name, "createCoachWorkLogs"); assert.equal(ui.calls[0].data.get("coaching_hours"), "1.5");
  assert.equal(ui.calls[0].data.get("other_expense"), "100"); assert.equal(ui.refreshes, 1);
  assert.equal(nodes(ui.render(), node => node.props?.className === "ui-modal-backdrop").length, 0);
  assert.equal(toolbar(ui).props.view, "day");
});

test("複数登録の選択・解除と、一括入力の対象日と対象者を維持する", async () => {
  const ui = mount(); toolbar(ui).props.children.props.onClick();
  assert.equal(nodes(ui.render(), node => node.props?.onPointerUp)[0].props["data-pull-refresh-ignore"], "");
  selectDay(ui, "2026-11-29"); selectDay(ui, "2026-11-28");
  nodes(toolbar(ui).props.selectionActions, node => node.type === "button")[0].props.onClick();
  const form = formWith(ui, "date_keys"), data = formDefaults(form);
  assert.deepEqual(data.getAll("date_keys"), ["2026-11-28", "2026-11-29"]);
  assert.deepEqual(data.getAll("coach_ids"), ["me"]);
  form.props.action(data); await Promise.all(ui.jobs);
  assert.equal(ui.calls[0].name, "createCoachWorkLogsForDates"); assert.equal(ui.refreshes, 1);
  assert.equal(toolbar(ui).props.selectionActions, null);
});

test("勤怠の編集・削除は対象の記録IDと小数時間を保持し、削除キャンセルでは送信しない", async () => {
  const ui = mount(); selectDay(ui, "2026-11-28");
  let edit = formWith(ui, "coach_id"), data = formDefaults(edit);
  assert.equal(data.get("log_id"), "mine"); assert.equal(data.get("coaching_hours"), "2");
  assert.equal(data.get("admin_hours"), "0.5"); assert.equal(data.get("travel_expense"), "500");
  data.set("coaching_hours", "1.5"); edit.props.action(data); await Promise.all(ui.jobs);
  assert.equal(ui.calls[0].name, "updateCoachWorkLog"); assert.equal(ui.calls[0].data.get("log_id"), "mine");
  selectDay(ui, "2026-11-28");
  const deletion = nodes(ui.render(), node => node.type === "form" && node.props.onSubmit)[0];
  const previous = globalThis.window;
  try {
    globalThis.window = { confirm: () => false }; let prevented = false;
    deletion.props.onSubmit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(ui.calls.length, 1);
    globalThis.window.confirm = () => true;
    deletion.props.onSubmit({ preventDefault() { throw Error("承認した削除は送信できる"); } });
    deletion.props.action(formDefaults(deletion)); await Promise.all(ui.jobs);
    assert.equal(ui.calls[1].name, "deleteCoachWorkLog"); assert.equal(ui.calls[1].data.get("log_id"), "mine");
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test("月間集計と登録詳細には隣月の時間・実費を混ぜず、日表示でも月全体を保持する", () => {
  const ui = mount({ view: "day" });
  const article = nodes(ui.render(), node => node.type === "article" && nodes(node, child => child.type === "button" && child.props.children === "本人").length)[0];
  assert.match(textOf(article), /指導時間2時間/); assert.match(textOf(article), /交通費500円立替合計600円/);
  nodes(article, node => node.type === "button")[0].props.onClick();
  const modal = nodes(ui.render(), node => node.props?.className === "ui-modal-backdrop")[0];
  assert.match(textOf(modal), /2026年11月28日/); assert.doesNotMatch(textOf(modal), /2026年12月1日/);
});

test("日付の変更で新規入力を分離し、保存失敗時は対象日と入力画面を保持する", async () => {
  const ui = mount({}, { createCoachWorkLogs: async () => { throw Error("保存の確認用エラー"); } });
  selectDay(ui, "2026-11-28"); const first = formWith(ui, "coach_ids");
  selectDay(ui, "2026-11-29"); const next = formWith(ui, "coach_ids");
  assert.notEqual(first.key, next.key); assert.equal(formDefaults(next).get("work_date"), "2026-11-29");
  next.props.action(formDefaults(next)); await Promise.all(ui.jobs);
  assert.match(textOf(ui.render()), /保存の確認用エラー/); assert.equal(ui.refreshes, 0);
  assert.equal(formDefaults(formWith(ui, "coach_ids")).get("work_date"), "2026-11-29");
});

let db;
before(async () => { db = await createTestDatabase(); });
after(async () => { await db?.close(); });

test("取得は対象チームと月を限定し、隣月の見える日・期間の継続・1000件超の勤怠を扱う", async () => {
  const team = await createTeam(db), other = await createTeam(db);
  await db.query("update profiles set accounting_coach=true,account_status='active' where id=$1", [team.adminId]);
  await db.query("insert into coach_work_logs(group_id,coach_id,work_date,coaching_minutes) select $1,$2,'2026-11-15',1 from generate_series(1,1001)", [team.groupId, team.adminId]);
  await db.query("insert into coach_work_logs(group_id,coach_id,work_date,coaching_minutes) values($1,$2,'2026-10-26',60),($1,$2,'2026-12-01',60),($3,$4,'2026-11-15',999)", [team.groupId, team.adminId, other.groupId, other.adminId]);
  const events = (await db.query("insert into calendar_events(group_id,title,start_at,attendance_required) values($1,'月外の予定','2026-11-30T15:00:00Z',true),($1,'継続の前日','2026-10-24T15:00:00Z',false),($1,'取得対象外','2026-10-24T15:00:00Z',true),($2,'他チーム','2026-11-28',true) returning id", [team.groupId, other.groupId])).rows;
  const Page = loadTs("src/app/admin/coach-work/page.tsx", { "@/lib/auth": { requireAdmin: async () => ({ id: team.adminId, group_id: team.groupId, name: "確認" }) }, "@/lib/supabase": { supabase: postgresClient(db) }, "./CoachWorkCalendarClient": () => null }).default;
  for (const view of ["month", "week", "day"]) {
    const tree = await Page({ searchParams: Promise.resolve({ month: "2026-11", date: "2026-11-28", view }) });
    assert.equal(tree.key, `${view}:2026-11-28`); assert.equal(tree.props.view, view);
    assert.equal(tree.props.logs.length, 1003); assert.equal(tree.props.coaches.length, 1); assert.equal(tree.props.coaches[0].can_record, true);
    assert.deepEqual(new Set(tree.props.events.map(event => event.id)), new Set(events.slice(0, 2).map(event => event.id)));
  }
});
