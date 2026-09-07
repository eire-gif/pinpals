import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { otherParticipantId, isConversationArchived, conversationRole } from "@/lib/messaging";
import type { Conversation, ConversationParticipant } from "@/lib/types";
import InboxClient, { type InboxRow } from "./inbox-client";

// Bounded — a member could in principle have started a conversation with
// every other member on the site, and this page has no "load more" of its
// own yet, so a hard cap keeps it a single indexed range scan (see
// conversations_user_a_idx/conversations_user_b_idx/conversations_last_message_at_idx
// in 0025_messaging.sql) instead of an unbounded fetch that grows with a
// member's own social graph. Most recently active conversation first, so
// the cap only ever drops the conversations someone is least likely to be
// looking for right now.
const CONVERSATIONS_LIST_LIMIT = 50;

type ConversationRow = Conversation & {
  user_a: ConversationParticipant | null;
  user_b: ConversationParticipant | null;
  listing: { id: number; title: string; status: string; seller_id: string; image_url: string | null } | null;
  order: { id: number; status: string; payment_status: string } | null;
};

export default async function ConversationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Two round-trips for the WHOLE inbox, not one per row: the conversation
  // list itself, and one aggregated unread-count query
  // (conversation_unread_counts(), 0049_marketplace_messaging.sql) — see
  // that function's own comment on why this is a single indexed query
  // rather than a correlated round-trip per conversation.
  const [{ data: rows }, { data: unreadRows }] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        "*, user_a:profiles!conversations_user_a_id_fkey(id, first_name, last_name, avatar_color), user_b:profiles!conversations_user_b_id_fkey(id, first_name, last_name, avatar_color), listing:listings(id, title, status, seller_id, image_url), order:orders(id, status, payment_status)"
      )
      .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(CONVERSATIONS_LIST_LIMIT)
      .returns<ConversationRow[]>(),
    supabase.rpc("conversation_unread_counts"),
  ]);

  const unreadByConversation = new Map(
    ((unreadRows as { conversation_id: number; unread_count: number }[] | null) ?? []).map((r) => [
      r.conversation_id,
      r.unread_count,
    ])
  );

  const inboxRows: InboxRow[] = (rows ?? []).map((c) => {
    const otherId = otherParticipantId(c, user.id);
    const other = c.user_a_id === otherId ? c.user_a : c.user_b;
    return {
      id: c.id,
      otherName: other ? `${other.first_name} ${other.last_name}`.trim() : "Unknown member",
      otherAvatarColor: other?.avatar_color ?? null,
      lastMessageAt: c.last_message_at,
      listing: c.listing,
      orderStatus: c.order?.status ?? null,
      role: conversationRole({ listingId: c.listing_id, listingSellerId: c.listing?.seller_id ?? null, userId: user.id }),
      archived: isConversationArchived(c, user.id),
      unreadCount: unreadByConversation.get(c.id) ?? 0,
    };
  });

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 md:py-14">
      <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
        <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Messages
      </span>
      <h1 className="font-display font-bold text-3xl md:text-4xl mt-2 mb-8">Your conversations</h1>

      <InboxClient rows={inboxRows} currentUserId={user.id} />
    </div>
  );
}
