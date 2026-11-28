import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { loadTs } from "./helpers.mjs";

const { bindPullToRefresh, isPullRefreshGestureActive, pullRefreshThreshold } = loadTs("src/lib/pull-to-refresh.ts");

function events() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener, options) { if (!listeners.has(type)) listeners.set(type, new Map()); listeners.get(type).set(listener, options); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, event) { for (const fn of listeners.get(type)?.keys() ?? []) fn(event); },
  };
}

class ElementStub {
  constructor(kind = "div", parent = null) { this.kind = kind; this.parentElement = parent; this.scrollHeight = 100; this.clientHeight = 100; this.overflowY = "visible"; }
  matches(selector) { return selector.split(",").some(value => value.trim() === this.kind || (value.includes("contenteditable") && this.kind === "editable") || (value.trim() === "[data-date-key]" && this.kind === "calendar") || (value.trim() === ".ui-calendar-timeline-event" && this.kind === "timeline")); }
  closest(selector) {
    if (this.matches(selector) || (selector.includes("button") && ["calendar", "timeline"].includes(this.kind))) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
}

function mount({ height = 568 } = {}) {
  const attributes = new Map(), classes = new Set(), progress = [];
  let busy = false, refreshes = 0, blocked = false;
  const root = { setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key), hasAttribute: key => attributes.has(key), classList: { add: value => classes.add(value), remove: value => classes.delete(value) } };
  const doc = { ...events(), documentElement: root, body: new ElementStub("body"), activeElement: null, querySelector: () => blocked ? {} : null };
  const win = { ...events(), scrollY: 0, innerHeight: height, getComputedStyle: element => ({ overflowY: element.overflowY }) };
  function run(fn) {
    const previous = [globalThis.window, globalThis.document, globalThis.Element];
    globalThis.window = win; globalThis.document = doc; globalThis.Element = ElementStub;
    try { return fn(); } finally {
      for (const [index, key] of ["window", "document", "Element"].entries()) {
        if (previous[index] === undefined) delete globalThis[key]; else globalThis[key] = previous[index];
      }
    }
  }
  const cleanup = run(() => bindPullToRefresh({ onPull: (distance, threshold) => progress.push({ distance, threshold }), isRefreshing: () => busy, onRefresh: () => { refreshes++; busy = true; } }));
  const target = new ElementStub("div", doc.body);
  function emit(type, { x = 100, y = 100, touches = type === "touchend" ? 0 : 1, cancelable = true, element = target, identifier = 1 } = {}) {
    const event = { target: element, touches: Array.from({ length: touches }, () => ({ clientX: x, clientY: y, identifier })), cancelable, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    run(() => doc.emit(type, event)); return event;
  }
  return { emit, progress, doc, win, root, classes, target, run, get refreshes() { return refreshes; }, set busy(value) { busy = value; }, set blocked(value) { blocked = value; }, cleanup: () => run(cleanup) };
}

test("最上部から十分に引いて離したときだけ更新し、更新中の連続操作を止める", () => {
  const ui = mount();
  try {
    ui.emit("touchstart"); ui.emit("touchmove", { y: 300 });
    assert.equal(ui.refreshes, 0); assert.ok(ui.progress.at(-1).distance >= ui.progress.at(-1).threshold);
    assert.equal(ui.run(isPullRefreshGestureActive), true);
    ui.emit("touchend"); assert.equal(ui.refreshes, 1); assert.equal(ui.progress.at(-1).distance, 0);
    ui.emit("touchstart"); ui.emit("touchmove", { y: 300 }); ui.emit("touchend"); assert.equal(ui.refreshes, 1);
    ui.busy = false;
    ui.emit("touchstart"); ui.emit("touchmove", { y: 300 }); ui.emit("touchend"); assert.equal(ui.refreshes, 2);
  } finally { ui.cleanup(); }
});

test("短い引張りは更新せず、引いた分を戻すと解除し、短いタップは通常どおり扱う", () => {
  const ui = mount();
  try {
    ui.emit("touchstart"); ui.emit("touchmove", { y: 150 }); ui.emit("touchend");
    assert.equal(ui.refreshes, 0);
    ui.emit("touchstart"); ui.emit("touchmove", { y: 300 }); ui.emit("touchmove", { y: 100 }); ui.emit("touchend");
    assert.equal(ui.refreshes, 0); assert.equal(ui.progress.at(-1).distance, 0);
  } finally { ui.cleanup(); }
  const tap = mount();
  try {
    tap.emit("touchstart"); tap.emit("touchmove", { y: 103 }); tap.emit("touchend");
    assert.equal(tap.run(isPullRefreshGestureActive), false); assert.equal(tap.emit("click").prevented, false);
  } finally { tap.cleanup(); }
});

test("ページ途中のスクロール、上方向、横方向、多指、キャンセルでは更新もスクロール阻止もしない", () => {
  for (const scenario of ["scrolled", "up", "sideways", "multitouch", "cancel", "uncancelable"]) {
    const ui = mount();
    try {
      if (scenario === "scrolled") ui.win.scrollY = 100;
      ui.emit("touchstart", { touches: scenario === "multitouch" ? 2 : 1 });
      const move = ui.emit("touchmove", { x: scenario === "sideways" ? 300 : 100, y: scenario === "up" ? 20 : scenario === "sideways" ? 120 : 300, cancelable: scenario !== "uncancelable" });
      if (scenario === "cancel") ui.emit("touchcancel");
      ui.emit("touchend"); assert.equal(ui.refreshes, 0, scenario);
      if (scenario !== "cancel") assert.equal(move.prevented, false, scenario);
    } finally { ui.cleanup(); }
  }
});

test("入力・操作ボタン・内部スクロール・開いたモーダル・複数選択・保存中は対象外にする", () => {
  for (const kind of ["input", "textarea", "select", "a", "button", "editable", "nested", "blocked", "focused"]) {
    const ui = mount();
    try {
      const element = new ElementStub(kind, ui.doc.body);
      if (kind === "nested") { element.scrollHeight = 300; element.overflowY = "auto"; }
      if (kind === "blocked") ui.blocked = true;
      if (kind === "focused") ui.doc.activeElement = new ElementStub("input");
      ui.emit("touchstart", { element });
      const move = ui.emit("touchmove", { y: 300, element }); ui.emit("touchend", { element });
      assert.equal(move.prevented, false, kind); assert.equal(ui.refreshes, 0, kind);
    } finally { ui.cleanup(); }
  }
});

test("カレンダーのセル・予定枠から引けるが、指を離した後のクリックは予定を開かない", () => {
  for (const kind of ["calendar", "timeline"]) {
    const ui = mount();
    try {
      const element = new ElementStub(kind, ui.doc.body);
      ui.emit("touchstart", { element }); assert.equal(ui.emit("touchmove", { element, y: 300 }).prevented, true);
      ui.emit("touchend", { element }); assert.equal(ui.refreshes, 1);
      const click = ui.emit("click", { element }); assert.equal(click.prevented, true); assert.equal(click.stopped, true);
    } finally { ui.cleanup(); }
  }
});

test("画面高に合わせて閾値を調整し、遷移・終了時には監視とジェスチャーを解除する", () => {
  assert.equal(pullRefreshThreshold(400), 56); assert.equal(pullRefreshThreshold(700), 70); assert.equal(pullRefreshThreshold(1200), 80);
  const ui = mount();
  ui.emit("touchstart"); ui.emit("touchmove", { y: 300 });
  ui.run(() => ui.win.emit("popstate")); ui.emit("touchend"); assert.equal(ui.refreshes, 0);
  assert.equal(ui.doc.listeners.get("touchmove").values().next().value.passive, false);
  ui.cleanup();
  assert.equal(ui.classes.size, 0); assert.equal(ui.root.hasAttribute("data-pull-refresh-gesture"), false);
  assert.equal([...ui.doc.listeners.values()].reduce((sum, value) => sum + value.size, 0), 0);
  assert.equal(ui.progress.at(-1).distance, 0);
});

test("すべての画面に更新操作を付け、Routerの再取得完了まで更新中を表示する", () => {
  const pathnames = readdirSync("src/app", { recursive: true })
    .filter(filename => /(^|\/)page\.tsx$/.test(filename))
    .map(filename => `/${filename.replace(/(^|\/)page\.tsx$/, "").replace(/\[[^\]]+\]/g, "test-event")}`);
  for (const pathname of pathnames) {
    const slots = [], effects = []; let cursor = 0, binding, pending = false, refreshes = 0;
    const router = { refresh() { refreshes++; } };
    const startTransition = fn => { pending = true; fn(); };
    const Component = loadTs("src/components/PullToRefresh.tsx", {
      react: {
        useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value; }]; },
        useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
        useTransition: () => [pending, startTransition], useEffect: fn => effects.push(fn),
      },
      "next/navigation": { usePathname: () => pathname, useRouter: () => router },
      "@/lib/pull-to-refresh": { bindPullToRefresh(callbacks) { binding = callbacks; return () => {}; } },
    }).default;
    const render = () => { cursor = 0; effects.length = 0; const tree = Component({ children: "ページ内容" }); for (const fn of effects) fn(); return tree; };
    assert.match(JSON.stringify(render()), /ページ内容/);
    assert.ok(binding, `${pathname} でも更新操作を有効にする`);
    binding.onPull(80, 56); assert.match(JSON.stringify(render()), /離すと更新/);
    binding.onPull(0, 56); binding.onRefresh(); assert.equal(refreshes, 1);
    assert.match(JSON.stringify(render()), /更新中/); assert.equal(binding.isRefreshing(), true);
    pending = false; assert.doesNotMatch(JSON.stringify(render()), /更新中/); assert.equal(binding.isRefreshing(), false);
  }
});
