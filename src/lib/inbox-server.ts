import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isDeliveryOnlyAlert,
  mergeInbox,
  type InboxAlert,
  type InboxConversation,
  type InboxCounts,
  type InboxItem,
} from "@/lib/inbox";
import { isConversationArchived, otherParticipantId } from "@/lib/messaging";
import { notificationHref } from "@/lib/notifications";
import type { Conversation, ConversationParticipant, Notification } from "@/lib/types";

/**
 * Loading the merged inbox.
 *
 * Three round trips for the whole page, not one per row: the conversations
 * with their participants and listings, the alerts, and one call to
 * inbox_unread_counts() for the two numbers. The per-conversation unread
 * counts come from conversation_unread_counts() (0049), which is a fourth —
 * and the reason the badge and the row pills cannot disagree is that they
 * are computed from the same two columns by two functions written in the
 * same file.
 *
 * Everything here is RLS-bound. `notifications` and `conversations` both
 * carry own-rows-only SELECT policies, so there is no service-role client
 * and no ownership filter to forget.
 */

/** Bounded for the same reason /conversations is: a member's inbox grows
 *  with their social graph, and both lists are a single indexed range scan
 *  only while they stay capped. Newest first, so the cap drops what someone
 *  is least likely to be looking for. */
export const INBOX_CONVERSATIONS_LIMIT = 50;
export const INBOX_ALERTS_LIMIT = 50;

type ConversationRow = Conversation & {
  user_a: ConversationParticipant | null;
  user_b: ConversationParticipant | null;
  listing: { id: number; title: string; image_url: string | null } | null;
};

export type LoadedInbox = {
  items: InboxItem[];
  counts: InboxCounts;
  /** True when either list hit its cap, so the page can say so rather than
   *  silently ending. */
  truncated: boolean;
};

export async function loadInbox(
  supabase: SupabaseClient,
  userId: string
): Promise<LoadedInbox> {
  const [conversationsResult, alertsResult, unreadResult, perConversationResult] =
    await Promise.all([
      supabase
        .from("conversations")
        .select(
          "*, user_a:profiles!conversations_user_a_id_fkey(id, first_name, last_name, avatar_color), user_b:profiles!conversations_user_b_id_fkey(id, first_name, last_name, avatar_color), listing:listings(id, title, image_url)"
        )
        .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(INBOX_CONVERSATIONS_LIMIT)
        .returns<ConversationRow[]>(),
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(INBOX_ALERTS_LIMIT)
        .returns<Notification[]>(),
      supabase.rpc("inbox_unread_counts"),
      supabase.rpc("conversation_unread_counts"),
    ]);

  const unreadByConversation = new Map(
    (
      (perConversationResult.data as
        | { conversation_id: number; unread_count: number }[]
        | null) ?? []
    ).map((row) => [row.conversation_id, Number(row.unread_count)])
  );

  const conversationRows = conversationsResult.data ?? [];
  const conversations: InboxConversation[] = conversationRows.map((c) => {
    const otherId = otherParticipantId(c, userId);
    const other = c.user_a_id === otherId ? c.user_a : c.user_b;
    return {
      kind: "conversation",
      id: c.id,
      at: c.last_message_at ?? c.created_at,
      otherName: other ? `${other.first_name} ${other.last_name}`.trim() : "Unknown member",
      otherAvatarColor: other?.avatar_color ?? null,
      listingTitle: c.listing?.title ?? null,
      listingImageUrl: c.listing?.image_url ?? null,
      unreadCount: unreadByConversation.get(c.id) ?? 0,
      archived: isConversationArchived(c, userId),
      href: `/conversations/${c.id}`,
    };
  });

  const alertRows = alertsResult.data ?? [];
  const alerts: InboxAlert[] = alertRows
    .filter((n) => !isDeliveryOnlyAlert(n.type))
    .map((n) => ({
      kind: "alert",
      id: n.id,
      at: n.created_at,
      type: n.type,
      title: n.title,
      body: n.body,
      href: notificationHref(n.data),
      unread: n.read_at === null,
    }));

  // `?? 0` rather than a throw: a member whose badge is briefly wrong is a
  // far better outcome than an inbox that refuses to render because one
  // aggregate query hiccuped.
  const countsRow = (unreadResult.data as
    | { message_count: number; alert_count: number }[]
    | null)?.[0];

  return {
    items: mergeInbox(conversations, alerts),
    counts: {
      messages: Number(countsRow?.message_count ?? 0),
      alerts: Number(countsRow?.alert_count ?? 0),
    },
    truncated:
      conversationRows.length >= INBOX_CONVERSATIONS_LIMIT ||
      alertRows.length >= INBOX_ALERTS_LIMIT,
  };
}

/**
 * Just the two numbers, for the header badge on every page.
 *
 * Its own function because the header runs on every single render of every
 * single page and must never pull a list it will not show. One RPC, two
 * integers.
 */
export async function loadInboxCounts(supabase: SupabaseClient): Promise<InboxCounts> {
  const { data } = await supabase.rpc("inbox_unread_counts");
  const row = (data as { message_count: number; alert_count: number }[] | null)?.[0];
  return {
    messages: Number(row?.message_count ?? 0),
    alerts: Number(row?.alert_count ?? 0),
  };
}
