"use client";

import { useEffect } from "react";

export default function SessionSync({ cookieName, version }: { cookieName: string; version: string }) {
  useEffect(() => {
    const tabWindow = window;
    const tabDocument = document;
    const storageKey = `nsct.session-change.${cookieName}`;
    let reloading = false;

    function changed() {
      const current = tabDocument.cookie.split(";").map(value => value.trim())
        .find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || "";
      return current !== version;
    }

    function sync() {
      if (!changed()) return false;
      if (!reloading) {
        reloading = true;
        tabWindow.location.reload();
      }
      return true;
    }

    function beforeSubmit(event: Event) {
      if (sync()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) sync();
    }

    function onVisibility() {
      if (tabDocument.visibilityState === "visible") sync();
    }

    tabWindow.addEventListener("storage", onStorage);
    tabWindow.addEventListener("focus", sync);
    tabWindow.addEventListener("pageshow", sync);
    tabDocument.addEventListener("visibilitychange", onVisibility);
    tabDocument.addEventListener("submit", beforeSubmit, true);

    if (!sync()) {
      try {
        if (tabWindow.localStorage.getItem(storageKey) !== version) {
          tabWindow.localStorage.setItem(storageKey, version);
        }
      } catch { /* Cookie checks on focus and submit also work without storage. */ }
    }

    return () => {
      tabWindow.removeEventListener("storage", onStorage);
      tabWindow.removeEventListener("focus", sync);
      tabWindow.removeEventListener("pageshow", sync);
      tabDocument.removeEventListener("visibilitychange", onVisibility);
      tabDocument.removeEventListener("submit", beforeSubmit, true);
    };
  }, [cookieName, version]);

  return null;
}
