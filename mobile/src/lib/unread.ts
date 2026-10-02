import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";

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
 *
 * It also owns the RED NUMBER ON THE APP ICON, for the same reason: the icon
 * badge and the tab badge are the same fact, and the way they drift apart is
 * by being set in two places. Setting it here means every screen that reads
 * this hook keeps the icon honest without knowing it is doing so, and opening
 * the inbox clears it because the count itself drops.
 *
 * The server sets the badge too, on the push payload, so the icon is right
 * while the app is closed — which is the only time anybody looks at it. The
 * two agree because both are inbox_unread_counts().
 */
export type InboxUnread = InboxCounts & {
  total: number;
  /** Re-reads both numbers now. Handed to screens that have just changed
   *  them, so the badge moves in the same gesture rather than on the next
   *  foreground. */
  refresh: () => void;
};

/**
 * Writes the number on the app icon.
 *
 * Never throws. iOS can refuse this if the member turned off badges for
 * PinPals in Settings, and a rejected badge must not take the inbox down with
 * it — the number on screen is the one that matters, the icon is a courtesy.
 */
async function setAppIconBadge(count: number): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    // Badges are off for this app, or the platform declined. Not worth a word.
  }
}

export function useInboxUnread(userId: string | null): InboxUnread {
  const [counts, setCounts] = useState<InboxCounts>({ messages: 0, alerts: 0 });

  const refresh = useCallback(async () => {
    if (!userId) {
      setCounts({ messages: 0, alerts: 0 });
      return;
    }
    const next = await inboxCounts();
    setCounts(next);
    await setAppIconBadge(inboxTotal(next));
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setCounts({ messages: 0, alerts: 0 });
      // Signed out: the icon must not keep showing somebody else's number.
      void setAppIconBadge(0);
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
