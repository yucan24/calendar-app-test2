const GESTURE_ATTRIBUTE = "data-pull-refresh-gesture";
const EXCLUDED = 'input, textarea, select, a, [contenteditable]:not([contenteditable="false"]), [role="slider"], [data-pull-refresh-ignore]';
const BLOCKED = '.ui-modal-backdrop, dialog[open], [role="dialog"], [data-pull-refresh-ignore], button[data-busy="true"]';

export function isPullRefreshGestureActive() {
  return typeof document !== "undefined" && Boolean(document.documentElement?.hasAttribute(GESTURE_ATTRIBUTE));
}

export function pullRefreshThreshold(height: number) {
  return Math.min(80, Math.max(56, height * .1));
}

function excludedTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  if (!element || element.closest(EXCLUDED)) return true;
  const button = element.closest('button, [role="button"]');
  if (button && !button.matches('[data-date-key], .ui-calendar-timeline-event')) return true;
  // モーダル等の独立したスクロール領域から、ページ全体を更新しない。
  for (let parent: Element | null = element; parent && parent !== document.body; parent = parent.parentElement) {
    if (parent.scrollHeight > parent.clientHeight + 1 && /auto|scroll/.test(window.getComputedStyle(parent).overflowY)) return true;
  }
  return false;
}

export function bindPullToRefresh({ onPull, onRefresh, isRefreshing }: {
  onPull: (distance: number, threshold: number) => void;
  onRefresh: () => void;
  isRefreshing: () => boolean;
}) {
  const root = document.documentElement;
  let start: { x: number; y: number; identifier: number } | null = null;
  let distance = 0, threshold = pullRefreshThreshold(window.innerHeight), claimed = false;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;

  function releaseGesture() {
    if (!claimed) return;
    clearTimeout(clickTimer);
    // touchend後のクリックと、カレンダーのpointerupによる予定選択を抑える。
    clickTimer = setTimeout(() => root.removeAttribute(GESTURE_ATTRIBUTE), 350);
  }

  function cancel() {
    releaseGesture();
    start = null; distance = 0; claimed = false;
    onPull(0, threshold);
  }

  function onStart(event: TouchEvent) {
    cancel();
    if (event.touches.length !== 1 || window.scrollY > 0 || isRefreshing() || document.querySelector(BLOCKED) || excludedTarget(event.target)) return;
    const active = document.activeElement;
    if (active?.matches('input, textarea, select, [contenteditable="true"]')) return;
    clearTimeout(clickTimer);
    root.removeAttribute(GESTURE_ATTRIBUTE);
    const touch = event.touches[0];
    threshold = pullRefreshThreshold(window.innerHeight);
    start = { x: touch.clientX, y: touch.clientY, identifier: touch.identifier };
  }

  function onMove(event: TouchEvent) {
    if (!start) return;
    if (event.touches.length !== 1 || isRefreshing() || document.querySelector(BLOCKED)) { cancel(); return; }
    const touch = event.touches[0];
    if (touch.identifier !== start.identifier) { cancel(); return; }
    const x = Math.abs(touch.clientX - start.x), y = touch.clientY - start.y;
    if (!claimed) {
      if (x > 10 && x >= Math.abs(y)) { cancel(); return; }
      if (y < -10 || window.scrollY > 0) { cancel(); return; }
      if (y <= 10 || y <= x) return;
    }
    if (!event.cancelable) { cancel(); return; }
    event.preventDefault();
    claimed = true;
    root.setAttribute(GESTURE_ATTRIBUTE, "");
    distance = Math.min(Math.max(y, 0) * .55, threshold + 24);
    onPull(distance, threshold);
  }

  function onEnd(event: TouchEvent) {
    if (!start) return;
    const ready = claimed && distance >= threshold && event.touches.length === 0 && !isRefreshing() && !document.querySelector(BLOCKED);
    cancel();
    if (ready) onRefresh();
  }

  function onClick(event: MouseEvent) {
    if (!root.hasAttribute(GESTURE_ATTRIBUTE)) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }

  root.classList.add("ui-pull-refresh-enabled");
  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("touchend", onEnd, { passive: true });
  document.addEventListener("touchcancel", cancel, { passive: true });
  document.addEventListener("click", onClick, true);
  window.addEventListener("pagehide", cancel);
  window.addEventListener("popstate", cancel);
  return () => {
    clearTimeout(clickTimer);
    root.classList.remove("ui-pull-refresh-enabled");
    root.removeAttribute(GESTURE_ATTRIBUTE);
    document.removeEventListener("touchstart", onStart);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", cancel);
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("pagehide", cancel);
    window.removeEventListener("popstate", cancel);
    onPull(0, threshold);
  };
}
