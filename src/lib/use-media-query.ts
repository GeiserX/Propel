"use client";

import { useSyncExternalStore } from "react";

/**
 * SSR-safe media-query hook built on useSyncExternalStore — the idiomatic way to
 * subscribe to an external browser source. The server snapshot is `false`, so
 * SSR and the first client render both render the desktop baseline (hydration
 * matches); the client snapshot reflects the real match and updates on change.
 *
 * Defaulting to `false` keeps desktop as the baseline: tests (jsdom, where
 * matchMedia is absent / `matches:false`) and SSR render the desktop path, and
 * only real mobile viewports flip to `true`.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (onStoreChange: () => void): (() => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mql = window.matchMedia(query);
    // addEventListener is the modern API; guard for older Safari (addListener).
    if (mql.addEventListener) mql.addEventListener("change", onStoreChange);
    else mql.addListener(onStoreChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onStoreChange);
      else mql.removeListener(onStoreChange);
    };
  };

  const getSnapshot = (): boolean => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  };

  // Server snapshot: always false (desktop baseline; avoids hydration mismatch).
  const getServerSnapshot = (): boolean => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
