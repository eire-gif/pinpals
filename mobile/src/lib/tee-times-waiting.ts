import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { countNeedsAnswer } from "./my-rounds";

/**
 * The gold number on the Tee Times tab (Oct 2026): how many answers this
 * member owes — requests to join their rounds, places offered to them. The
 * same rows My rounds puts under "Needs your answer", so the badge and the
 * page can't disagree.
 *
 * Re-counted when the app comes to the front, when `nudge` changes (the tab
 * layout passes the inbox's unread total, which moves the moment a tee-time
 * alert lands — so no second realtime channel), and whenever a screen calls
 * teeTimesChanged() after answering something.
 */
const listeners = new Set<() => void>();

/** Call after offering, declining, confirming or cancelling, so the badge
 *  moves in the same gesture. */
export function teeTimesChanged(): void {
  for (const listener of listeners) listener();
}

export function useTeeTimesWaiting(userId: string | null, nudge: number): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) {
      setCount(0);
      return;
    }
    try {
      setCount(await countNeedsAnswer(userId));
    } catch {
      // A badge that failed to load says nothing rather than something wrong.
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh, nudge]);

  useEffect(() => {
    const listener = () => void refresh();
    listeners.add(listener);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      listeners.delete(listener);
      appState.remove();
    };
  }, [refresh]);

  return count;
}
