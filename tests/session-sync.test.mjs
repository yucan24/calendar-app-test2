import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers.mjs';

const cookieName = 'nsct_session_version';
const storageKey = `nsct.session-change.${cookieName}`;

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, event = {}) { for (const listener of listeners.get(type) || []) listener(event); },
  };
}

function browser(version = 'first') {
  return { version, storage: new Map(), tabs: [] };
}

function mount(shared, renderedVersion, { blockedStorage = false } = {}) {
  let reloads = 0, cleanup;
  const tabWindow = {
    ...events(),
    location: { reload() { reloads++; } },
    localStorage: {
      getItem(key) { if (blockedStorage) throw Error('storage blocked'); return shared.storage.get(key) ?? null; },
      setItem(key, value) {
        if (blockedStorage) throw Error('storage blocked');
        shared.storage.set(key, value);
        for (const other of shared.tabs) if (other !== tabWindow) other.emit('storage', { key, newValue: value });
      },
    },
  };
  const tabDocument = { ...events(), visibilityState: 'visible', get cookie() { return `other=value; ${cookieName}=${shared.version}`; } };
  shared.tabs.push(tabWindow);
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = tabWindow; globalThis.document = tabDocument;
  try {
    const Component = loadTs('src/components/SessionSync.tsx', { react: { useEffect(effect) { cleanup = effect(); } } }).default;
    assert.equal(Component({ cookieName, version: renderedVersion }), null);
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
  return { window: tabWindow, document: tabDocument, cleanup, get reloads() { return reloads; } };
}

function submit(tab) {
  const event = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  tab.document.emit('submit', event);
  return event;
}

test('同じログイン状態の通常送信は妨げず、公開nonceだけを保存する', () => {
  const shared = browser(), tab = mount(shared, 'first');
  const attempt = submit(tab);
  assert.equal(attempt.prevented, false); assert.equal(attempt.stopped, false);
  assert.equal(tab.reloads, 0);
  assert.deepEqual([...shared.storage], [[storageKey, 'first']]);
  tab.cleanup();
});

test('別タブでログイン状態が変わると古い画面だけを更新し、削除等の送信を止める', () => {
  const shared = browser(), first = mount(shared, 'first'), other = mount(shared, 'first');
  first.cleanup(); shared.version = 'second';
  const current = mount(shared, 'second');
  assert.equal(current.reloads, 0);
  assert.equal(other.reloads, 1);
  const attempt = submit(other);
  assert.equal(attempt.prevented, true); assert.equal(attempt.stopped, true);
  assert.equal(other.reloads, 1);
  assert.equal(submit(current).prevented, false);
  other.cleanup(); current.cleanup();
});

test('ストレージが使えなくても古いフォームを送信せず更新する', () => {
  const shared = browser(), tab = mount(shared, 'first', { blockedStorage: true });
  shared.version = 'second';
  const attempt = submit(tab);
  assert.equal(attempt.prevented, true); assert.equal(attempt.stopped, true);
  assert.equal(tab.reloads, 1);
  tab.window.emit('focus'); assert.equal(tab.reloads, 1);
  tab.cleanup();
});

test('HTML取得後にログイン状態が変わった場合も古い状態を公開せず更新する', () => {
  const shared = browser('second'), tab = mount(shared, 'first');
  assert.equal(tab.reloads, 1);
  assert.equal(shared.storage.has(storageKey), false);
  assert.equal(submit(tab).prevented, true);
  tab.cleanup();
});

test('タブ復帰・ブラウザ履歴復帰・再表示でもCookieの変更を検知する', () => {
  for (const type of ['focus', 'pageshow', 'visibilitychange']) {
    const shared = browser(), tab = mount(shared, 'first');
    shared.version = 'second';
    (type === 'visibilitychange' ? tab.document : tab.window).emit(type);
    assert.equal(tab.reloads, 1, type);
    tab.cleanup();
  }
});

test('Cookieが変わらない無関係なストレージ通知では画面を更新しない', () => {
  const shared = browser(), tab = mount(shared, 'first');
  tab.window.emit('storage', { key: storageKey, newValue: 'forged' });
  tab.window.emit('storage', { key: 'other', newValue: 'second' });
  tab.window.emit('storage', { key: null });
  assert.equal(tab.reloads, 0);
  assert.equal(submit(tab).prevented, false);
  tab.cleanup();
});

test('画面更新後は古い監視を外して新しいログイン状態で操作できる', () => {
  const shared = browser(), old = mount(shared, 'first');
  old.cleanup(); shared.version = 'second';
  const current = mount(shared, 'second');
  old.window.emit('focus');
  assert.equal(old.reloads, 0);
  assert.equal(submit(current).prevented, false);
  current.cleanup();
});
