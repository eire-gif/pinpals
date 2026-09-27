import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { inboxCounts, inboxTotal, type InboxCounts } from "./inbox";
import { subscribeToInbox } from "./realtime";

/**
 * The badge.
 *
 * One hook, one number, one source. It used to be two hooks reading two
 * different things — useUnreadCount() head-counted `notifications` for the
 * Alerts tab, useUnreadMessages() summed conversation_unread_counts() for a
 * dot on Home — and between them a member could have four replies waiting
 * with nothing on screen that said how many. Both now come from
 * inbox_unread_counts() (0083_unified_inbox.sql), so the tab badge, the
 * envelope and the list all agree by construction.
 *
 * Refreshed on foreground rather than on a timer. A badge that is a few
 * minutes stale while the phone is in a pocket costs nothing; a poll every
 * thirty seconds costs battery and a request per member per interval forever.
 * Push is what makes a genuinely new alert visible immediately, and the inbox
 * broadcast — one subscription per member, never one per conversation — moves
 * the number the moment a message arrives with the app open.
 */
export type InboxUnread = InboxCounts & {
  total: number;
  /** Re-reads both numbers now. Handed to screens that have just changed
   *  them, so the badge moves in the same gesture rather than on the next
   *  foreground. */
  refresh: () => void;
};

export function useInboxUnread(userId: string | null): InboxUnread {
  const [counts, setCounts] = useState<InboxCounts>({ messages: 0, alerts: 0 });

  const refresh = useCallback(async () => {
    if (!userId) {
      setCounts({ messages: 0, alerts: 0 });
      return;
    }
    setCounts(await inboxCounts());
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setCounts({ messages: 0, alerts: 0 });
      return;
    }

    void refresh();

    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    const unsubscribe = subscribeToInbox(userId, () => void refresh());

    return () => {
      appState.remove();
      unsubscribe();
    };
  }, [userId, refresh]);

  return {
    ...counts,
    total: inboxTotal(counts),
    refresh: () => void refresh(),
  };
}
