import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTs, createTestDatabase, createTeam, postgresClient } from "./helpers.mjs";

const calendar = loadTs("src/lib/calendar.ts");
const preview = loadTs("src/components/ui/CalendarEventPreview.tsx");

function nodes(node, predicate, result = []) {
  if (!node || typeof node !== "object") return result;
  if (Array.isArray(node)) { node.forEach(child => nodes(child, predicate, result)); return result; }
  if (predicate(node)) result.push(node);
  nodes(node.props?.children, predicate, result);
  return result;
}

function mount(area, overrides = {}, actionOverrides = {}) {
  const slots = [], jobs = [], saves = [], edits = [];
  let cursor = 0, refreshes = 0;
  const event = { id: "one", title: "通常練習予定", location: "市民体育館", time_text: "19:00-21:00", start_at: "2026-11-27T15:00:00Z", attendance_required: true, display_type: "normal" };
  const props = { currentAdmin: { id: "coach", name: "検証" }, currentUser: { id: "coach", name: "検証" }, targetMonth: "2026-11", todayKey: "2026-11-28", events: [event], responses: [], profiles: [{ id: "coach", role: "admin", name: "指導者" }], ...overrides };
  const Component = loadTs(`src/app/${area}/calendar/${area === "admin" ? "Admin" : "User"}CalendarClient.tsx`, {
    react: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useMemo: fn => fn(), useTransition: () => [false, fn => jobs.push(fn())],
    },
    "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
    "@/components/ui/CalendarToolbar": () => null,
    "@/components/LogoutButton": () => null,
    "@/components/SubmitButton": () => null,
    "./actions": { async updateAdminCalendarAttendance(...args) { saves.push(args); }, async updateUserCalendarAttendance(input) { saves.push(input); }, async updateAdminCalendarEventFromModal(input) { edits.push(input); }, ...actionOverrides },
  }).default;
  const render = () => { cursor = 0; return Component(props); };
  return { render, props, saves, edits, jobs, get refreshes() { return refreshes; } };
}

function selectModalEvent(ui, title) {
  const button = nodes(ui.render(), node => node.type === "button" && nodes(node, child => child.type === "p" && child.props.children === title).length)[0];
  assert.ok(button, `予定「${title}」を選択できる`);
  button.props.onClick();
}

function formWith(ui, name) {
  return nodes(ui.render(), node => node.type === "form" && nodes(node, child => child.props?.name === name).length)[0];
}

function formDefaults(form) {
  const data = new FormData();
  for (const field of nodes(form, node => ["input", "textarea", "select"].includes(node.type) && node.props.name)) {
    const { name, type, defaultChecked, value, defaultValue } = field.props;
    if (type === "checkbox") { if (defaultChecked) data.append(name, "on"); }
    else data.append(name, value ?? defaultValue ?? "");
  }
  return data;
}

test("日・週・月は日本時間の範囲を使い、月外の予定を含む週と月を取得する", () => {
  assert.deepEqual(calendar.getCalendarUtcRange("2026-12", "week", "2026-12-01"), { startIso: "2026-11-29T15:00:00.000Z", endIso: "2026-12-06T15:00:00.000Z" });
  assert.deepEqual(calendar.getCalendarUtcRange("2026-11", "month", "2026-11-28"), { startIso: "2026-10-25T15:00:00.000Z", endIso: "2026-12-06T15:00:00.000Z" });
  assert.deepEqual(calendar.getCalendarUtcRange("2026-12", "day", "2026-12-01"), { startIso: "2026-11-30T15:00:00.000Z", endIso: "2026-12-01T15:00:00.000Z" });
  assert.equal(calendar.getCalendarDays("2024-02", "month", "2024-02-29").filter(day => day.isCurrentMonth).length, 29);
});

test("日付移動は年越し・月末・うるう年に対応し、不正なURLパラメーターを補正する", () => {
  assert.equal(calendar.moveCalendarDate("2026-12-31", "day", 1), "2027-01-01");
  assert.equal(calendar.moveCalendarDate("2026-12-31", "week", 1), "2027-01-07");
  assert.equal(calendar.moveCalendarDate("2024-01-31", "month", 1), "2024-02-29");
  assert.equal(calendar.moveCalendarDate("0099-12-31", "month", 1), "0100-01-31");
  assert.deepEqual(calendar.resolveCalendarSelection({ view: "bad", date: "2026-02-30", month: "0000-12" }, "2026-11-28"), { view: "month", anchorDate: "2026-11-28", targetMonth: "2026-11" });
  assert.deepEqual(calendar.resolveCalendarSelection({ view: "week", date: "2026-12-01" }, "2026-11-28"), { view: "week", anchorDate: "2026-12-01", targetMonth: "2026-12" });
  assert.deepEqual(calendar.resolveCalendarSelection({ month: "2026-08", date: "2026-09-01" }, "2026-11-28").anchorDate, "2026-08-01");
  assert.equal(calendar.calendarHref("/admin/calendar", "week", "2026-12-01"), "/admin/calendar?month=2026-12&view=week&date=2026-12-01");
  for (const date of ["0001-01-01", "9999-12-31"]) for (const view of ["day", "week", "month"]) assert.doesNotThrow(() => calendar.getCalendarUtcRange(date.slice(0, 7), view, date));
});

test("時刻が文字列で登録された同日の予定も午前から午後の順に並ぶ", () => {
  const events = [{ start_at: "2026-11-27T15:00:00Z", time_text: "14:00-17:00" }, { start_at: "2026-11-27T15:00:00Z", time_text: "09:00-12:00" }];
  assert.equal(events.sort(calendar.compareCalendarEvents)[0].time_text, "09:00-12:00");
});

test("日表示は入力された時間を優先し、全角・終了24時・翌日終了・開始時刻だけの予定を扱う", () => {
  const event = { id: "time", start_at: "2026-11-27T15:00:00Z" };
  assert.deepEqual(calendar.getCalendarEventTime({ ...event, time_text: "９：３０～１２：００" }), { start: 570, end: 720, label: "09:30〜12:00" });
  assert.deepEqual(calendar.getCalendarEventTime({ ...event, time_text: "22:00-24:00" }), { start: 1320, end: 1440, label: "22:00〜24:00" });
  assert.deepEqual(calendar.getCalendarEventTime({ ...event, time_text: "23:00-01:00" }), { start: 1380, end: 1440, label: "23:00〜翌01:00" });
  assert.deepEqual(calendar.getCalendarEventTime({ ...event, time_text: "00:00-01:00" }), { start: 0, end: 60, label: "00:00〜01:00" });
  assert.deepEqual(calendar.getCalendarEventTime({ ...event, time_text: "19:15" }), { start: 1155, end: 1215, label: "19:15" });
  for (const time_text of [undefined, "", "終日", "午前中", "25:00-26:00", "09:75", "09:00-24:30"]) assert.equal(calendar.getCalendarEventTime({ ...event, time_text }), null);
});

test("文字列の時間がない既存データは日本時間の開始・終了を使い、日付だけの予定と区別する", () => {
  assert.deepEqual(calendar.getCalendarEventTime({ id: "real-time", start_at: "2026-11-28T07:30:00Z", end_at: "2026-11-28T09:30:00Z" }), { start: 990, end: 1110, label: "16:30〜18:30" });
  assert.deepEqual(calendar.getCalendarEventTime({ id: "night", start_at: "2026-11-28T14:00:00Z", end_at: "2026-11-28T16:00:00Z" }), { start: 1380, end: 1440, label: "23:00〜翌01:00" });
  assert.equal(calendar.getCalendarEventTime({ id: "day-only", start_at: "2026-11-27T15:00:00Z" }), null);
});

test("日表示は時系列・重複時間の列分け・列の再利用・時間未定の分離を行い、元データを変えない", () => {
  const event = (id, time_text) => ({ id, time_text, start_at: "2026-11-27T15:00:00Z" });
  const source = [event("later", "14:00-17:00"), event("second", "09:30-10:30"), event("first", "09:00-12:00"), event("third", "10:30-11:00"), event("notice", "午前中")];
  const before = structuredClone(source), layout = calendar.layoutCalendarDay(source);
  assert.deepEqual(source, before);
  assert.deepEqual(layout.timed.map(slot => [slot.event.id, slot.column, slot.columns]), [["first", 0, 2], ["second", 1, 2], ["third", 1, 2], ["later", 0, 1]]);
  assert.deepEqual(layout.untimed.map(event => event.id), ["notice"]);
  assert.equal(layout.startHour, 8); assert.equal(layout.endHour, 22);
  const edges = calendar.layoutCalendarDay([event("early", "05:15-06:00"), event("late", "23:00-24:00")]);
  assert.equal(edges.startHour, 5); assert.equal(edges.endHour, 24);
  assert.equal(calendar.layoutCalendarDay([]).timed.length, 0);
  const short = calendar.layoutCalendarDay([event("short", "10:00-10:05"), event("next", "10:10-10:20")]);
  assert.deepEqual(short.timed.map(slot => slot.columns), [2, 2]);
});

test("出席人数は指導者・選手を分け、未定・欠席・不明会員と重複を数えない", () => {
  const profiles = new Map([["c", { role: "admin" }], ["p", { role: "user" }], ["a", { role: "user" }], ["u", { role: "user" }]]);
  assert.deepEqual(calendar.summarizeAttendance([{ user_id: "c", status: "attend" }, { user_id: "p", status: "attend" }, { user_id: "p", status: "attend" }, { user_id: "a", status: "absent" }, { user_id: "u", status: "pending" }, { user_id: "foreign", status: "attend" }], profiles), { coachCount: 1, playerCount: 1, attend: 2, pending: 1, absent: 1 });
  assert.deepEqual(calendar.summarizeAttendance([], profiles), { coachCount: 0, playerCount: 0, attend: 0, pending: 0, absent: 0 });
});

test("予定ごとの人数と6文字の予定名を表示し、出欠不要の予定には人数を表示しない", () => {
  const event = { id: "one", title: "通常練習予定", attendance_required: true };
  const html = renderToStaticMarkup(preview.default({ event, summary: { coachCount: 2, playerCount: 12 }, ownStatus: "pending", showOwnStatus: true }));
  assert.match(html, /通常練習予定/); assert.match(html.replace(/<[^>]*>/g, ""), /2人12人/); assert.match(html, /出席予定 指導者2人、選手12人/); assert.match(html, /自分の出欠：未定/);
  const legend = renderToStaticMarkup(preview.CalendarAttendanceLegend());
  assert.match(legend, /指導者/); assert.match(legend, /選手/);
  const workHtml = renderToStaticMarkup(preview.default({ event, summary: { coachCount: 2, playerCount: 12 }, ownStatus: "pending", showOwnStatus: false, showAttendance: false }));
  assert.match(workHtml, /通常練習予定/); assert.doesNotMatch(workHtml, /出席予定|自分の出欠/);
  assert.doesNotMatch(renderToStaticMarkup(preview.default({ event: { ...event, attendance_required: false }, summary: { coachCount: 0, playerCount: 0 }, showOwnStatus: true })), /出席予定|自分の出欠/);
  assert.match(renderToStaticMarkup(preview.OwnAttendance({})), /未回答/);
});

test("操作欄の月・週・日切替と日付送りは権限・表示形式・基準日を維持する", () => {
  const Toolbar = loadTs("src/components/ui/CalendarToolbar.tsx", {
    "next/link": () => null,
    "@/components/PendingNavigationButton": () => null,
  }).default;
  for (const area of ["admin", "user"]) for (const view of ["month", "week", "day"]) {
    const tree = Toolbar({ baseHref: `/${area}/calendar`, view, anchorDate: "2026-11-28", targetMonth: "2026-11", todayKey: "2026-12-01" });
    const modes = nodes(tree, node => node.props?.className === "ui-tab");
    assert.deepEqual(modes.map(node => node.props.children), ["月", "週", "日"]);
    for (const [index, mode] of ["month", "week", "day"].entries()) {
      assert.equal(modes[index].props.href, calendar.calendarHref(`/${area}/calendar`, mode, "2026-11-28"));
      assert.equal(modes[index].props["aria-current"], view === mode ? "page" : undefined);
    }
    const navigation = nodes(tree, node => node.props?.["aria-label"] === "表示期間の切替")[0];
    assert.deepEqual(navigation.props.children.map(node => node.props.href), [
      calendar.moveCalendarDate("2026-11-28", view, -1), "2026-12-01", calendar.moveCalendarDate("2026-11-28", view, 1),
    ].map(date => calendar.calendarHref(`/${area}/calendar`, view, date)));
  }
});

for (const area of ["admin", "user"]) {
  test(`${area}: 引っ張って更新した指離しでは予定を開かず、複数選択中は更新対象外にする`, () => {
    const ui = mount(area);
    const day = () => nodes(ui.render(), node => node.props?.["data-date-key"] === "2026-11-28")[0];
    const release = () => nodes(ui.render(), node => node.props?.onPointerUp)[0].props.onPointerUp();
    const previous = globalThis.document;
    try {
      globalThis.document = { documentElement: { hasAttribute: () => true } };
      day().props.onPointerDown({ pointerType: "touch", clientX: 0, clientY: 0 }); release();
      assert.equal(nodes(ui.render(), node => node.props?.className === "ui-modal-backdrop").length, 0);
      globalThis.document.documentElement.hasAttribute = () => false;
      day().props.onPointerDown({ pointerType: "touch", clientX: 0, clientY: 0 }); release();
      assert.equal(nodes(ui.render(), node => node.props?.className === "ui-modal-backdrop").length, 1);
      nodes(ui.render(), node => node.props?.baseHref === `/${area}/calendar`)[0].props.children.props.onClick();
      assert.equal(nodes(ui.render(), node => node.props?.onPointerUp)[0].props["data-pull-refresh-ignore"], "");
    } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
  });

  test(`${area}: 同日2予定と未回答の予定を切り替えたら、フォームも切替先の値とIDに入れ替わる`, async () => {
    const first = { id: "one", title: "午前の予定", location: "第一体育館", description: "午前の備考", time_text: "09:00-12:00", start_at: "2026-11-27T15:00:00Z", title_color: "#123456", location_color: "#234567", time_color: "#345678", attendance_required: true, is_holiday: true, display_type: "normal" };
    const second = { ...first, id: "two", title: "午後の予定", location: "第二体育館", description: "午後の備考", time_text: "14:00-17:00", title_color: "#abcdef", location_color: "#bcdef0", time_color: "#cdef01", is_holiday: false };
    const third = { ...second, id: "three", title: "未回答の予定" };
    const ui = mount(area, { events: [first, second, third], responses: [{ event_id: "one", user_id: "coach", status: "absent", note: "午前は欠席" }, { event_id: "two", user_id: "coach", status: "pending", note: "午後は調整中" }] });
    nodes(ui.render(), node => node.props?.["data-date-key"] === "2026-11-28")[0].props.onKeyDown({ key: "Enter", preventDefault() {} });
    const firstAnswer = formWith(ui, "status"), firstEdit = formWith(ui, "title");
    assert.ok(firstAnswer.key, "予定ごとに入力欄の状態を分離する");
    selectModalEvent(ui, second.title);
    let answer = formWith(ui, "status");
    assert.notEqual(answer.key, firstAnswer.key);
    assert.deepEqual(Object.fromEntries(formDefaults(answer)), { event_id: "two", status: "pending", note: "午後は調整中" });
    if (area === "admin") {
      const edit = formWith(ui, "title");
      assert.notEqual(edit.key, firstEdit.key);
      const data = formDefaults(edit);
      assert.equal(data.get("event_id"), "two"); assert.equal(data.get("title"), second.title);
      assert.equal(data.get("location"), second.location); assert.equal(data.get("time_text"), second.time_text);
      assert.equal(data.get("description"), second.description); assert.equal(data.get("title_color"), second.title_color);
      assert.equal(data.get("location_color"), second.location_color); assert.equal(data.get("time_color"), second.time_color);
      assert.equal(data.get("is_holiday"), null); assert.equal(data.get("attendance_required"), "on");
      edit.props.action(data); await Promise.all(ui.jobs);
      assert.equal(ui.edits.length, 1); assert.equal(ui.edits[0].eventId, "two");
      assert.equal(ui.edits[0].title, second.title); assert.equal(ui.edits[0].timeText, second.time_text);
      assert.equal(ui.edits[0].isHoliday, false); assert.equal(ui.edits[0].attendanceRequired, true);
      nodes(ui.render(), node => node.props?.["data-date-key"] === "2026-11-28")[0].props.onKeyDown({ key: "Enter", preventDefault() {} });
    }
    selectModalEvent(ui, third.title);
    assert.notEqual(formWith(ui, "status").key, answer.key);
    assert.deepEqual(Object.fromEntries(formDefaults(formWith(ui, "status"))), { event_id: "three", status: "attend", note: "" });
    selectModalEvent(ui, first.title);
    assert.deepEqual(Object.fromEntries(formDefaults(formWith(ui, "status"))), { event_id: "one", status: "absent", note: "午前は欠席" });
    selectModalEvent(ui, second.title);
    answer = formWith(ui, "status");
    answer.props.action(formDefaults(answer)); await Promise.all(ui.jobs);
    assert.deepEqual(ui.saves, area === "admin" ? [["two", "pending", "午後は調整中"]] : [{ eventId: "two", event_id: "two", status: "pending", note: "午後は調整中" }]);
  });

  test(`${area}: 保存失敗を別の予定に持ち越さず、保存中は対象予定を切り替えない`, async () => {
    let release;
    const response = new Promise(resolve => { release = resolve; });
    const fail = async () => { await response; throw new Error("この予定の保存に失敗"); };
    const ui = mount(area, {}, { updateAdminCalendarAttendance: fail, updateUserCalendarAttendance: fail });
    ui.props.events.push({ ...ui.props.events[0], id: "two", title: "2件目" });
    nodes(ui.render(), node => node.props?.["data-date-key"] === "2026-11-28")[0].props.onKeyDown({ key: "Enter", preventDefault() {} });
    formWith(ui, "status").props.action(formDefaults(formWith(ui, "status")));
    selectModalEvent(ui, "2件目");
    assert.equal(formDefaults(formWith(ui, "status")).get("event_id"), "one");
    release(); await Promise.all(ui.jobs);
    assert.ok(nodes(ui.render(), node => node.props?.children === "この予定の保存に失敗").length);
    selectModalEvent(ui, "2件目");
    assert.equal(nodes(ui.render(), node => node.props?.children === "この予定の保存に失敗").length, 0);
    assert.equal(formDefaults(formWith(ui, "status")).get("event_id"), "two");
  });

  test(`${area}: 日表示の詳細から「日表示で開く」を押すと詳細を閉じる`, () => {
    const ui = mount(area, { view: "day", anchorDate: "2026-11-28" });
    nodes(ui.render(), node => node.type?.name === "CalendarDayTimeline")[0].props.onSelect("one");
    const link = nodes(ui.render(), node => node.props?.children === "日表示で開く")[0];
    assert.equal(typeof link.props.onClick, "function");
    link.props.onClick();
    assert.equal(nodes(ui.render(), node => node.props?.className === "ui-modal-backdrop").length, 0);
  });

  test(`${area}: 日表示の時間軸から予定を選んで、その予定の出欠画面を開ける`, () => {
    const ui = mount(area, { view: "day", anchorDate: "2026-11-28" });
    const first = ui.props.events[0];
    ui.props.events.push({ ...first, id: "two", title: "午後合同練習", time_text: "14:00-17:00" }, { ...first, id: "period", display_type: "period", attendance_required: false });
    ui.props.responses.push({ event_id: "two", user_id: "coach", status: "pending" });
    const timeline = () => nodes(ui.render(), node => node.type?.name === "CalendarDayTimeline")[0];
    assert.deepEqual(timeline().props.events.map(event => event.id), ["two", "one"]);
    const Component = loadTs("src/components/ui/CalendarDayTimeline.tsx").default;
    const tree = Component(timeline().props);
    const afternoon = nodes(tree, node => node.type === "button" && node.props["data-event-id"] === "two")[0];
    assert.match(afternoon.props["aria-label"], /午後合同練習、14:00〜17:00/);
    assert.match(afternoon.props["aria-label"], /自分の出欠：未定/);
    afternoon.props.onClick();
    let modal = ui.render();
    const form = nodes(modal, node => node.type === "form" && nodes(node, child => child.props?.name === "status").length)[0];
    assert.equal(nodes(form, node => node.props?.name === "event_id")[0].props.value, "two");
    assert.equal(nodes(form, node => node.props?.name === "status")[0].props.defaultValue, "pending");
    nodes(modal, node => node.props?.baseHref === `/${area}/calendar`)[0].props.children.props.onClick();
    timeline().props.onSelect("two");
    modal = ui.render();
    assert.equal(nodes(modal, node => node.props?.["data-date-key"] === "2026-11-28")[0].props["aria-pressed"], true);
    assert.equal(nodes(modal, node => node.props?.className === "ui-modal-backdrop").length, 0);
    assert.equal(ui.saves.length, 0);
  });

  test(`${area}: 操作欄から複数日を選び、登録・回答画面を開いて選択解除できる`, () => {
    const ui = mount(area);
    const toolbar = () => nodes(ui.render(), node => node.props?.baseHref === `/${area}/calendar`)[0];
    assert.equal(toolbar().props.selectionActions, null);
    toolbar().props.children.props.onClick();
    assert.equal(toolbar().props.children.props["aria-pressed"], true);
    for (const date of ["2026-11-28", "2026-11-29"]) {
      nodes(ui.render(), node => node.props?.["data-date-key"] === date)[0].props.onKeyDown({ key: "Enter", preventDefault() {} });
    }
    const actions = () => nodes(toolbar().props.selectionActions, node => node.type === "button");
    assert.equal(actions()[0].props.children, area === "admin" ? "予定登録" : "出欠回答");
    actions()[0].props.onClick();
    assert.ok(nodes(ui.render(), node => node.type === "h2" && node.props.children === (area === "admin" ? "まとめて予定登録" : "まとめて出欠回答")).length);
    actions()[1].props.onClick();
    assert.equal(toolbar().props.selectionActions, null);
    assert.equal(toolbar().props.children.props["aria-pressed"], false);
    assert.equal(nodes(ui.render(), node => node.props?.className === "ui-modal-backdrop").length, 0);
    assert.equal(ui.saves.length, 0);
  });

  test(`${area}: 日・週・月のセル数と、同日の予定ごとの選択を維持する`, () => {
    for (const [view, count] of [["month", 42], ["week", 7], ["day", 1]]) {
      const ui = mount(area, { view, anchorDate: "2026-11-28" });
      assert.equal(nodes(ui.render(), node => node.props?.["data-date-key"]).length, count);
    }
    const ui = mount(area);
    ui.props.events.push({ ...ui.props.events[0], id: "two", title: "午後の練習" });
    let tree = ui.render();
    const day = nodes(tree, node => node.props?.["data-date-key"] === "2026-11-28")[0];
    day.props.onPointerDown({ pointerType: "mouse", button: 0, target: { closest: () => ({ dataset: { eventId: "two" } }) }, clientX: 0, clientY: 0 });
    nodes(tree, node => node.props?.onPointerUp)[0].props.onPointerUp();
    tree = ui.render();
    assert.ok(nodes(tree, node => node.type === "h3" && node.props.children === "午後の練習").length);
    assert.equal(nodes(tree, node => node.props?.name === "event_id")[0].props.value, "two");
  });

  test(`${area}: 日付右の自分の出欠と、複数予定ごとの出欠・人数を表示する`, () => {
    const ui = mount(area, { responses: [{ event_id: "one", user_id: "coach", status: "attend", note: null }] });
    let tree = ui.render();
    assert.equal(nodes(tree, node => node.type?.name === "OwnAttendance")[0].props.status, "attend");
    let events = nodes(tree, node => node.type?.name === "CalendarEventPreview");
    assert.equal(events[0].props.summary.coachCount, 1);
    assert.equal(events[0].props.showOwnStatus, false);
    ui.props.events.push({ ...ui.props.events[0], id: "two" });
    tree = ui.render(); events = nodes(tree, node => node.type?.name === "CalendarEventPreview");
    assert.equal(events.length, 2); assert.ok(events.every(event => event.props.showOwnStatus));
    assert.equal(events[1].props.summary.coachCount, 0);
  });

  test(`${area}: キーボードで日付を開いて回答を保存し、表示期間を変えずに再取得する`, async () => {
    const ui = mount(area, { view: "week", anchorDate: "2026-11-28" });
    const day = nodes(ui.render(), node => node.props?.["data-date-key"] === "2026-11-28")[0];
    day.props.onKeyDown({ key: "Enter", preventDefault() {} });
    const form = nodes(ui.render(), node => node.type === "form" && nodes(node, child => child.props?.name === "status").length)[0];
    const data = new FormData(); data.set("event_id", "one"); data.set("status", "attend"); data.set("note", "検証");
    form.props.action(data); await Promise.all(ui.jobs);
    assert.equal(ui.saves.length, 1); assert.equal(ui.refreshes, 1);
    assert.equal(nodes(ui.render(), node => node.props?.["data-date-key"]).length, 7);
    assert.equal(nodes(ui.render(), node => node.props?.className === "ui-modal-backdrop").length, 0);
  });
}

let db;
before(async () => { db = await createTestDatabase(); });
after(async () => { await db?.close(); });

test("両カレンダーはチームと日付を限定し、1,000件を超える回答も全件集計する", async () => {
  const team = await createTeam(db), other = await createTeam(db);
  const event = (await db.query("insert into calendar_events(group_id,title,start_at) values($1,'週の先頭','2026-11-29T15:00:00Z'),($1,'週の末尾','2026-12-06T14:59:59Z'),($1,'翌週','2026-12-06T15:00:00Z'),($2,'他チーム','2026-12-01T00:00:00Z') returning id", [team.groupId, other.groupId])).rows;
  await db.query("insert into profiles(group_id,name,role) select $1,'集計選手'||i,'user' from generate_series(1,1005) as i", [team.groupId]);
  await db.query("insert into event_responses(event_id,user_id,status) select $1,id,'attend' from profiles where group_id=$2", [event[0].id, team.groupId]);
  const actor = { id: team.adminId, group_id: team.groupId, name: "検証" };
  for (const area of ["admin", "user"]) {
    const page = loadTs(`src/app/${area}/calendar/page.tsx`, { "@/lib/auth": { requireAdmin: async () => actor, requireUser: async () => actor }, "@/lib/supabase": { supabase: postgresClient(db) }, "./AdminCalendarClient": () => null, "./UserCalendarClient": () => null }).default;
    const tree = await page({ searchParams: Promise.resolve({ view: "week", date: "2026-12-01" }) });
    assert.deepEqual(tree.props.events.map(item => item.id), [event[0].id, event[1].id]);
    assert.equal(tree.props.responses.length, 1006);
    assert.equal(tree.props.profiles.length, 1006);
    const summary = calendar.summarizeAttendance(tree.props.responses, new Map(tree.props.profiles.map(profile => [profile.id, profile])));
    assert.equal(summary.coachCount, 1); assert.equal(summary.playerCount, 1005);
    const day = await page({ searchParams: Promise.resolve({ view: "day", date: "2026-12-06" }) });
    assert.deepEqual(day.props.events.map(item => item.id), [event[1].id]);
  }
});

test("同日2予定の2件目を編集・回答・削除しても、1件目と他チームの予定・回答を変更しない", async () => {
  const team = await createTeam(db), other = await createTeam(db);
  const player = (await db.query("insert into profiles(group_id,name,role) values($1,'検証選手','user') returning id", [team.groupId])).rows[0];
  const mocks = { "@/lib/auth": { requireAdmin: async () => ({ id: team.adminId, group_id: team.groupId }), requireUser: async () => ({ id: player.id, group_id: team.groupId }) }, "@/lib/supabase": { supabase: postgresClient(db) }, "next/cache": { revalidatePath() {} } };
  const admin = loadTs("src/app/admin/calendar/actions.ts", mocks), user = loadTs("src/app/user/calendar/actions.ts", mocks);
  const events = (await db.query("insert into calendar_events(group_id,title,start_at,time_text) values($1,'午前','2026-11-27T15:00:00Z','09:00-12:00'),($1,'午後','2026-11-27T15:00:00Z','14:00-17:00'),($2,'他チーム','2026-11-27T15:00:00Z','09:00-12:00') returning id", [team.groupId, other.groupId])).rows;
  await db.query("insert into event_responses(event_id,user_id,status,note) values($1,$3,'absent','午前のみ欠席'),($2,$3,'pending','午後は未定'),($1,$4,'attend','午前参加')", [events[0].id, events[1].id, team.adminId, player.id]);
  const snapshot = async () => ({ events: (await db.query("select * from calendar_events where id=any($1) order by id", [[events[0].id, events[2].id]])).rows, responses: (await db.query("select * from event_responses where event_id=$1 order by id", [events[0].id])).rows });
  const before = await snapshot();
  await admin.updateAdminCalendarEventFromModal({ eventId: events[1].id, dateKey: "2026-12-01", title: "午後を変更", location: "第二体育館", timeText: "15:00-18:00", description: "午後の備考", titleColor: "#abcdef", isHoliday: false, attendanceRequired: true });
  await admin.updateAdminCalendarAttendance(events[1].id, "attend", "午後のみ出席");
  await user.updateUserCalendarAttendance({ eventId: events[1].id, status: "pending", note: "選手は調整中" });
  const changed = (await db.query("select title,location,time_text,description,title_color,is_holiday,to_char(start_at at time zone 'Asia/Tokyo','YYYY-MM-DD') as date from calendar_events where id=$1", [events[1].id])).rows[0];
  assert.deepEqual(changed, { title: "午後を変更", location: "第二体育館", time_text: "15:00-18:00", description: "午後の備考", title_color: "#abcdef", is_holiday: false, date: "2026-12-01" });
  const responses = (await db.query("select user_id,status,note from event_responses where event_id=$1 order by user_id", [events[1].id])).rows;
  assert.deepEqual(responses, [{ user_id: team.adminId, status: "attend", note: "午後のみ出席" }, { user_id: player.id, status: "pending", note: "選手は調整中" }].sort((a, b) => a.user_id.localeCompare(b.user_id)));
  assert.deepEqual(await snapshot(), before);
  await admin.deleteAdminCalendarEventFromModal({ eventId: events[1].id });
  assert.deepEqual(await snapshot(), before);
  assert.equal((await db.query("select count(*)::int n from event_responses where event_id=$1", [events[1].id])).rows[0].n, 0);
});

test("予定の変更・出欠は他チーム、出欠不要、期間予定、不正なID・回答を拒否する", async () => {
  const team = await createTeam(db), other = await createTeam(db);
  const events = (await db.query("insert into calendar_events(group_id,title,start_at,attendance_required,display_type) values($1,'通常','2026-11-28',true,'normal'),($1,'不要','2026-11-28',false,'normal'),($1,'期間','2026-11-28',false,'period'),($2,'他チーム','2026-11-28',true,'normal') returning id", [team.groupId, other.groupId])).rows;
  const mocks = { "@/lib/auth": { requireAdmin: async () => ({ id: team.adminId, group_id: team.groupId }), requireUser: async () => ({ id: team.adminId, group_id: team.groupId }) }, "@/lib/supabase": { supabase: postgresClient(db) }, "next/cache": { revalidatePath() {} } };
  const admin = loadTs("src/app/admin/calendar/actions.ts", mocks), user = loadTs("src/app/user/calendar/actions.ts", mocks);
  for (const id of ["", events[1].id, events[2].id, events[3].id]) {
    await assert.rejects(admin.updateAdminCalendarAttendance(id, "attend", ""));
    await assert.rejects(user.updateUserCalendarAttendance({ eventId: id, status: "attend" }));
  }
  await assert.rejects(admin.updateAdminCalendarAttendance(events[0].id, "bad", ""));
  await assert.rejects(user.updateUserCalendarAttendance({ eventId: events[0].id, status: "bad" }));
  await assert.rejects(admin.updateAdminCalendarEventFromModal({ eventId: events[3].id, dateKey: "2026-11-28", title: "変更禁止" }), /権限/);
  assert.equal((await db.query("select count(*)::int n from event_responses where event_id=any($1)", [events.map(event => event.id)])).rows[0].n, 0);
  assert.equal((await db.query("select title from calendar_events where id=$1", [events[3].id])).rows[0].title, "他チーム");
});

test("予定詳細ページのフォームと管理者の出欠欄も、予定ごとに入力状態を分離する", async () => {
  const team = await createTeam(db);
  const events = (await db.query("insert into calendar_events(group_id,title,start_at) values($1,'1件目','2026-11-28'),($1,'2件目','2026-11-28') returning id", [team.groupId])).rows;
  const actor = { id: team.adminId, group_id: team.groupId, name: "確認" };
  const mocks = { "@/lib/auth": { requireAdmin: async () => actor, requireUser: async () => actor }, "@/lib/supabase": { supabase: postgresClient(db) }, "./AdminAttendanceSelect": () => null, "./actions": {}, "@/components/SubmitButton": () => null };
  for (const area of ["admin", "user"]) {
    const Page = loadTs(`src/app/${area}/calendar/[id]/page.tsx`, mocks).default;
    const forms = [];
    for (const event of events) {
      const tree = await Page({ params: Promise.resolve({ id: event.id }) });
      const form = nodes(tree, node => node.type === "form" && nodes(node, child => child.props?.name === (area === "admin" ? "title" : "status")).length)[0];
      assert.ok(form.key); forms.push(form);
      if (area === "admin") assert.equal(nodes(tree, node => node.props?.eventId === event.id && node.props?.userId === actor.id)[0].key, `${event.id}:${actor.id}`);
    }
    assert.notEqual(forms[0].key, forms[1].key);
  }
});

function period(id, date, extra = {}) {
  return { id, title: "冬季遠征期間", start_at: `${date}T00:00:00+09:00`, display_type: "period", attendance_required: false, ...extra };
}

test("同じ内容で連続する期間予定をまとめ、元のID・入力配列・通常予定を保持する", () => {
  const source = [period("b", "2026-11-29"), period("a", "2026-11-28"), period("c", "2026-12-01"), period("normal", "2026-11-30", { display_type: "normal", attendance_required: true }), period("different", "2026-11-30", { location: "別の会場" })];
  const before = structuredClone(source);
  const groups = calendar.groupCalendarPeriods(source);
  assert.deepEqual(source, before);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].events.map(event => event.id), ["a", "b"]);
  assert.equal(groups[0].startDate, "2026-11-28"); assert.equal(groups[0].endDate, "2026-11-29");
  assert.ok(groups.every(group => group.events.every(event => event.display_type === "period")));
  assert.equal(calendar.groupCalendarPeriods([period("max", "9999-12-31"), period("duplicate", "9999-12-31")]).length, 1);
});

test("期間の帯は週・月の境界で分割し、重なる予定を別の行に置く", () => {
  const dates = ["2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"];
  const groups = calendar.groupCalendarPeriods([...dates.map((date, index) => period(`p${index}`, date)), period("overlap", "2026-11-29", { title: "体育館休館" })]);
  const firstWeek = calendar.getCalendarDays("2026-11", "week", "2026-11-28").map(day => day.dateKey);
  const secondWeek = calendar.getCalendarDays("2026-12", "week", "2026-12-01").map(day => day.dateKey);
  const first = calendar.layoutCalendarPeriods(groups, firstWeek);
  assert.equal(first[0].column, 6); assert.equal(first[0].span, 2); assert.equal(first[0].continuesAfter, true); assert.equal(first[0].continuesBefore, false);
  assert.equal(first[1].lane, 2);
  const second = calendar.layoutCalendarPeriods(groups, secondWeek);
  assert.equal(second[0].column, 1); assert.equal(second[0].span, 3); assert.equal(second[0].continuesBefore, true); assert.equal(second[0].continuesAfter, false);
  assert.deepEqual(calendar.layoutCalendarPeriods(groups, ["0000-12-31"]), []);
});

test("帯のタップ・キーボード操作は、その週の元の予定IDを開く", () => {
  const groups = calendar.groupCalendarPeriods([period("sunday", "2026-11-29"), period("monday", "2026-11-30"), period("tuesday", "2026-12-01")]);
  const Component = loadTs("src/components/ui/CalendarPeriodBands.tsx").default;
  const calls = [];
  const tree = Component({ groups, dateKeys: calendar.getCalendarDays("2026-12", "week", "2026-12-01").map(day => day.dateKey), disabled: false, onSelect: (...args) => calls.push(args) });
  const button = nodes(tree, node => node.type === "button")[0];
  assert.equal(button.props["data-period-start"], "2026-11-29"); assert.equal(button.props["data-period-end"], "2026-12-01");
  assert.match(button.props["aria-label"], /前の週から継続/);
  button.props.onClick(); assert.deepEqual(calls, [["2026-11-30", "monday"]]);
  const selecting = Component({ groups, dateKeys: ["2026-11-30"], disabled: true, onSelect() {} });
  assert.ok(nodes(selecting, node => node.type === "button")[0].props.disabled);
});

for (const area of ["admin", "user"]) test(`${area}: 連結した帯から各日の元の予定を切り替え、日ごとの出欠を混同しない`, () => {
  const ui = mount(area, { events: [period("day-one", "2026-11-28"), period("day-two", "2026-11-29")] });
  const bands = nodes(ui.render(), node => node.type?.name === "CalendarPeriodBands");
  assert.equal(bands[0].props.groups[0].events.length, 2);
  bands[0].props.onSelect("2026-11-28", "day-one");
  let tree = ui.render();
  assert.ok(nodes(tree, node => node.props?.["aria-label"] === "期間予定の日付").length);
  nodes(tree, node => node.type === "button" && [].concat(node.props.children).join("") === "11/29")[0].props.onClick();
  tree = ui.render();
  assert.ok(nodes(tree, node => node.type === "h2" && node.props.children === "2026年11月29日日曜日").length);
  assert.equal(nodes(tree, node => node.type === "form" && nodes(node, child => child.props?.name === "status").length).length, 0);
  assert.equal(nodes(tree, node => node.props?.name === "event_id")[0]?.props.value, area === "admin" ? "day-two" : undefined);
});


test("通常形式でも出欠不要で同内容の連日予定を帯にまとめ、単発の連絡事項は残す", () => {
  const groups = calendar.groupCalendarPeriods([
    period("r1", "2026-11-04", { display_type: "normal" }), period("r2", "2026-11-05", { display_type: "normal" }),
    period("notice", "2026-11-07", { title: "連絡事項", display_type: "normal" }),
    period("practice", "2026-11-06", { display_type: "normal", attendance_required: true }),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].events.map(event => event.id), ["r1", "r2"]);
});

test("帯の取得範囲は前後1週間を含み、最小・最大年の外へ出ない", () => {
  assert.deepEqual(calendar.getCalendarPeriodUtcRange("2026-11", "week", "2026-11-28"), { startIso: "2026-11-15T15:00:00.000Z", endIso: "2026-12-06T15:00:00.000Z" });
  assert.equal(calendar.getCalendarPeriodUtcRange("0001-01", "day", "0001-01-01").startIso, "0000-12-31T15:00:00.000Z");
  assert.equal(calendar.getCalendarPeriodUtcRange("9999-12", "day", "9999-12-31").endIso, "9999-12-31T15:00:00.000Z");
});

test("両権限で隣の週の出欠不要予定を取得し、重複・他チーム・範囲外の通常予定を除外する", async () => {
  const team = await createTeam(db), other = await createTeam(db);
  const records = (await db.query("insert into calendar_events(group_id,title,start_at,attendance_required) values($1,'休館','2026-11-21T15:00:00Z',false),($1,'休館','2026-11-22T15:00:00Z',false),($1,'休館','2026-11-23T15:00:00Z',false),($1,'範囲外の練習','2026-11-21T15:00:00Z',true),($2,'他チーム','2026-11-21T15:00:00Z',false) returning id", [team.groupId, other.groupId])).rows;
  const actor = { id: team.adminId, group_id: team.groupId, name: "検証" };
  for (const area of ["admin", "user"]) {
    const page = loadTs(`src/app/${area}/calendar/page.tsx`, { "@/lib/auth": { requireAdmin: async () => actor, requireUser: async () => actor }, "@/lib/supabase": { supabase: postgresClient(db) }, "./AdminCalendarClient": () => null, "./UserCalendarClient": () => null }).default;
    const tree = await page({ searchParams: Promise.resolve({ view: "week", date: "2026-11-28" }) });
    assert.deepEqual(new Set(tree.props.events.map(event => event.id)), new Set(records.slice(0, 3).map(event => event.id)));
    assert.equal(tree.props.events.length, 3);
    const bands = calendar.layoutCalendarPeriods(calendar.groupCalendarPeriods(tree.props.events), calendar.getCalendarDays("2026-11", "week", "2026-11-28").map(day => day.dateKey));
    assert.equal(bands[0].continuesBefore, true); assert.equal(bands[0].span, 2);
  }
});

for (const area of ["admin", "user"]) test(`${area}: 月表示の日付右に2件分の出欠を予定順で表示し、2件目の記号から対象を開く`, () => {
  const first = { id: "morning", title: "午前練習予定", location: "総合運動公園", time_text: "09:00-12:00", start_at: "2026-11-27T15:00:00Z", attendance_required: true, display_type: "normal" };
  const second = { ...first, id: "afternoon", title: "午後合同練習", time_text: "14:00-17:00" };
  const ui = mount(area, { events: [second, first], responses: [{ event_id: first.id, user_id: "coach", status: "attend", note: null }, { event_id: second.id, user_id: "coach", status: "pending", note: null }] });
  const tree = ui.render();
  const header = nodes(tree, node => node.props?.["aria-label"] === "予定順の自分の出欠")[0];
  const states = nodes(header, node => node.type?.name === "OwnAttendance");
  assert.deepEqual(states.map(node => node.props.status), ["attend", "pending"]);
  assert.deepEqual(states.map(node => node.props.eventTitle), [first.title, second.title]);
  assert.deepEqual(nodes(header, node => node.props?.["data-event-id"]).map(node => node.props["data-event-id"]), [first.id, second.id]);
  const day = nodes(tree, node => node.props?.["data-date-key"] === "2026-11-28")[0];
  day.props.onPointerDown({ pointerType: "touch", target: { closest: () => ({ dataset: { eventId: second.id } }) }, clientX: 0, clientY: 0 });
  nodes(tree, node => node.props?.onPointerUp)[0].props.onPointerUp();
  const form = nodes(ui.render(), node => node.type === "form" && nodes(node, child => child.props?.name === "status").length)[0];
  assert.equal(nodes(form, node => node.props?.name === "event_id")[0].props.value, second.id);
  assert.equal(nodes(form, node => node.props?.name === "status")[0].props.defaultValue, "pending");
  const week = mount(area, { view: "week", events: [first, second] }).render();
  assert.equal(nodes(week, node => node.props?.["aria-label"] === "予定順の自分の出欠").length, 0);
});
