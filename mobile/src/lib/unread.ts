import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

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
