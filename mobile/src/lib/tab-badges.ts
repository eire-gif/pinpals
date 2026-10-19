import { useSyncExternalStore } from "react";

/**
 * The two numbers on the bottom bar — unread messages and alerts, and tee
 * times waiting on you — shared between the tab group's own bar and the
 * copy of it drawn under every other screen (components/global-tab-bar.tsx).
 *
 * The tab group stays mounted underneath everything pushed on top of it, so
 * it keeps counting and publishes here. The second bar only reads. Counting
 * twice would mean a second `inbox-<user>` realtime channel with the same
 * name as the first, and closing one would close both.
 */
export type TabBadges = { inbox: number; teeTimes: number };

let current: TabBadges = { inbox: 0, teeTimes: 0 };
const listeners = new Set<() => void>();

export function publishTabBadges(next: TabBadges): void {
  if (next.inbox === current.inbox && next.teeTimes === current.teeTimes) return;
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTabBadges(): TabBadges {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
