import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, createTeam, loadTs, postgresClient } from "./helpers.mjs";

let db;
before(async () => { db = await createTestDatabase(); });
after(async () => { await db?.close(); });

function nodes(node, predicate, result = []) {
  if (!node || typeof node !== "object") return result;
  if (Array.isArray(node)) { node.forEach(child => nodes(child, predicate, result)); return result; }
  if (predicate(node)) result.push(node);
  nodes(node.props?.children, predicate, result);
  return result;
}

function mount({ period = false, remove = async () => {} } = {}) {
  const slots = [], jobs = [], calls = [], prompts = [];
  let cursor = 0, refreshes = 0;
  const event = { id: "event-one", title: "削除確認の予定", start_at: "2026-11-22T15:00:00Z", attendance_required: !period, display_type: period ? "period" : "normal" };
  const props = { currentAdmin: { id: "admin", name: "検証" }, targetMonth: "2026-11", currentMonth: "2026-11", prevMonth: "2026-10", nextMonth: "2026-12", todayKey: "2026-11-23", events: [event], responses: [], profiles: [] };
  const Component = loadTs("src/app/admin/calendar/AdminCalendarClient.tsx", {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useMemo: calculate => calculate(),
      useTransition: () => [false, action => { jobs.push(action()); }],
    },
    "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
    "./actions": { async deleteAdminCalendarEventFromModal(input) { calls.push(input); await remove(input); } },
    "@/components/SubmitButton": () => null,
    "@/components/LogoutButton": () => null,
  }).default;
  const render = () => { cursor = 0; return Component(props); };
  let tree = render();
  const day = nodes(tree, node => node.props?.["data-date-key"] === "2026-11-23")[0];
  day.props.onPointerDown({ pointerType: "mouse", button: 0, clientX: 0, clientY: 0 });
  nodes(tree, node => typeof node.props?.onPointerUp === "function")[0].props.onPointerUp();
  tree = render();
  if (period) {
    nodes(tree, node => node.type === "button" && nodes(node, child => child.type === "p" && child.props.children === event.title).length)[0].props.onClick();
    tree = render();
  }
  const deletion = nodes(tree, node => node.type === "form" && nodes(node, child => child.props?.children === "予定を削除").length)[0];
  assert.ok(deletion, "選択した予定に削除ボタンが表示される");
  const data = new FormData(); data.set("event_id", event.id);
  return { render, tree, deletion, calls, prompts, get refreshes() { return refreshes; },
    async submit(confirmed = true, times = 1) {
      const old = globalThis.window;
      globalThis.window = { confirm(message) { prompts.push(message); return confirmed; } };
      try { for (let i = 0; i < times; i++) deletion.props.action(data); await Promise.all(jobs); }
      finally { if (old === undefined) delete globalThis.window; else globalThis.window = old; }
    },
  };
}

test("カレンダーから開く通常・期間予定に、編集を開かず削除ボタンを表示する", () => {
  for (const period of [false, true]) {
    const ui = mount({ period });
    const hidden = nodes(ui.tree, node => node.type === "details" && !node.props.open);
    assert.ok(hidden.every(detail => !nodes(detail, node => node === ui.deletion).length));
    assert.equal(nodes(ui.deletion, node => node.type === "input" && node.props.name === "event_id")[0].props.value, "event-one");
  }
});

test("削除確認をキャンセルすると予定と開いている画面を保持する", async () => {
  const ui = mount(); await ui.submit(false);
  assert.equal(ui.calls.length, 0); assert.equal(ui.refreshes, 0);
  assert.match(ui.prompts[0], /削除確認の予定/);
  assert.equal(nodes(ui.render(), node => node.type === "h3" && node.props.children === "削除確認の予定").length, 1);
});

test("削除確定で選択した1件だけを送信し、画面を閉じて同じ月を更新する", async () => {
  const ui = mount(); await ui.submit(true, 2);
  assert.deepEqual(ui.calls, [{ eventId: "event-one" }]);
  assert.equal(ui.prompts.length, 1); assert.equal(ui.refreshes, 1);
  const tree = ui.render();
  assert.equal(nodes(tree, node => node.props?.className === "ui-modal-backdrop").length, 0);
  assert.ok(nodes(tree, node => node.props?.["data-date-key"] === "2026-11-23").length);
});

test("削除失敗時は画面を閉じずエラーを表示する", async () => {
  const ui = mount({ remove: async () => { throw Error("削除に失敗しました"); } }); await ui.submit();
  assert.equal(ui.refreshes, 0);
  assert.ok(nodes(ui.render(), node => node.props?.children === "削除に失敗しました").length);
  assert.ok(nodes(ui.render(), node => node.type === "h3" && node.props.children === "削除確認の予定").length);
});

function actions(actor, invalidated = []) {
  return loadTs("src/app/admin/calendar/actions.ts", {
    "@/lib/auth": { requireAdmin: async () => { if (!actor) throw Error("redirect:/login"); return actor; } },
    "@/lib/supabase": { supabase: postgresClient(db) },
    "next/cache": { revalidatePath(path) { invalidated.push(path); } },
  });
}

test("予定削除は対象の出欠も削除し、同日の他予定・他チーム・会員を保持する", async () => {
  const team = await createTeam(db), other = await createTeam(db), paths = [];
  const events = (await db.query("insert into calendar_events(group_id,title,start_at) values($1,'削除対象','2026-11-23'),($1,'保持対象','2026-11-23'),($2,'他チーム','2026-11-23') returning id", [team.groupId, other.groupId])).rows;
  await db.query("insert into event_responses(event_id,user_id,status) values($1,$3,'attend'),($2,$3,'pending')", [events[0].id, events[1].id, team.adminId]);
  await actions({ id: team.adminId, group_id: team.groupId }, paths).deleteAdminCalendarEventFromModal({ eventId: events[0].id });
  assert.equal((await db.query("select count(*)::int n from calendar_events where id=$1", [events[0].id])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from event_responses where event_id=$1", [events[0].id])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from calendar_events where id=any($1)", [[events[1].id, events[2].id]])).rows[0].n, 2);
  assert.equal((await db.query("select count(*)::int n from event_responses where event_id=$1", [events[1].id])).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from profiles where id=$1", [team.adminId])).rows[0].n, 1);
  assert.deepEqual(paths, ["/admin/calendar", "/user/calendar", `/admin/calendar/${events[0].id}`, `/user/calendar/${events[0].id}`]);
});

test("未認証・他チーム・IDなしの削除を拒否する", async () => {
  const team = await createTeam(db), other = await createTeam(db);
  const event = (await db.query("insert into calendar_events(group_id,title,start_at) values($1,'保持','2026-11-23') returning id", [other.groupId])).rows[0];
  await assert.rejects(actions(null).deleteAdminCalendarEventFromModal({ eventId: event.id }), /redirect:\/login/);
  const adminActions = actions({ id: team.adminId, group_id: team.groupId });
  await assert.rejects(adminActions.deleteAdminCalendarEventFromModal({ eventId: event.id }), /権限/);
  await assert.rejects(adminActions.deleteAdminCalendarEventFromModal({}), /予定ID/);
  assert.equal((await db.query("select count(*)::int n from calendar_events where id=$1", [event.id])).rows[0].n, 1);
});
