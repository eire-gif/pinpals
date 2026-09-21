import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { unreadMessageCount } from "./messages";
import { subscribeToInbox } from "./realtime";
import { supabase } from "./supabase";

/**
 * The unread badge.
 *
 * Counted with `head: true`, so Postgres returns the count and no rows. The
 * partial index `notifications_user_id_read_at_idx on (user_id, read_at)
 * where read_at is null` already exists (migration 0042), which makes this an
 * index-only scan rather than a table scan — worth knowing before anyone is
 * tempted to cache it.
 *
 * Refreshed on foreground rather than on a timer. A tab badge that is a few
 * minutes stale while the phone is in a pocket costs nothing; a poll every
 * thirty seconds costs battery and a request per member per interval forever.
 * Push is what makes a genuinely new notification visible immediately.
 */
export function useUnreadCount(): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const { count: next, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);

    if (!error && typeof next === "number") setCount(next);
  }, []);

  useEffect(() => {
    void refresh();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });

    return () => sub.remove();
  }, [refresh]);

  return count;
}

/**
 * Unread MESSAGES, for the envelope on Home.
 *
 * Separate from useUnreadCount() above, which counts notifications — a member
 * with four alerts and no messages should not see a badge on the envelope.
 *
 * Refreshed on foreground like its neighbour, and additionally on the inbox
 * broadcast, so a message arriving while the app is open moves the badge
 * without a poll. The subscription is one per member for the whole inbox,
 * never one per conversation.
 */
export function useUnreadMessages(userId: string | null): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    setCount(await unreadMessageCount());
  }, []);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }

    void refresh();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    const unsubscribe = subscribeToInbox(userId, () => void refresh());

    return () => {
      sub.remove();
      unsubscribe();
    };
  }, [userId, refresh]);

  return count;
}
