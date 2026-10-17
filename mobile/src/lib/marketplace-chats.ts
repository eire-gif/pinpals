import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { listInbox, type InboxRow } from "./messages";

/**
 * Marketplace chats: the threads that are about a listing.
 *
 * A thread started from a listing carries its listing_id (0049, and from the
 * app since 0160), so this is the inbox filtered to those — the same rows,
 * read the same way, so the unread numbers here can never disagree with the
 * Inbox tab's.
 */
export async function listMarketplaceChats(userId: string): Promise<InboxRow[]> {
  const rows = await listInbox(userId);
  return rows.filter((row) => row.listingTitle !== null);
}

/** Unread messages across marketplace chats, for the Chats tab's badge.
 *  Re-read every minute and whenever the app comes back to the front — no
 *  second realtime channel; the Inbox tab already holds one. */
export function useMarketplaceUnread(userId: string | null): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) return setCount(0);
    try {
      const rows = await listMarketplaceChats(userId);
      setCount(rows.reduce((sum, row) => sum + row.unreadCount, 0));
    } catch {
      // Keep the last number; a badge that flickers to 0 is worse.
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh]);

  return count;
}
