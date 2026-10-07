import { useEffect, useRef } from "react";
import { AppState } from "react-native";

/**
 * Keeps a live screen current when the live ping can't.
 *
 * The ping (live-round-<id>, live-day-<id>) is the fast path, but a phone
 * that was locked in a pocket between shots has dropped its connection and
 * missed whatever was scored meanwhile. So:
 *   - coming back to the app reloads straight away, and
 *   - while the round is live and the app is open, it reloads every
 *     `everyMs` as a safety net. Cheap: a handful of rows, a few phones.
 *
 * `load` should be stable (useCallback); the latest one is used regardless.
 */
export function useLiveRefresh(load: () => unknown, live: boolean, everyMs = 20_000): void {
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void latest.current();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      if (AppState.currentState === "active") void latest.current();
    }, everyMs);
    return () => clearInterval(t);
  }, [live, everyMs]);
}
