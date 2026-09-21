import { postToSite } from "./api";
import { supabase } from "./supabase";

/**
 * Messages, read natively.
 *
 * Reads go straight to Supabase. `conversations` and `messages` are already
 * scoped to their two participants by RLS (0025, tightened by 0049), so a
 * route in front of them would add a hop and decide nothing.
 *
 * Sending is the exception and goes through the website — see sendMessage()
 * below and mobile/src/lib/api.ts. An insert from here would land in Postgres
 * and tell nobody: no live broadcast to the other phone, no notification, no
 * push. That is the failure that looks like the app working.
 */

/** matches messages.body's own check constraint, and the website's copy. */
export const MESSAGE_MAX_LENGTH = 4000;
/** matches MESSAGES_PAGE_SIZE on the website, so "older" means the same thing
 *  in both places. */
export const MESSAGES_PAGE_SIZE = 30;

export type Message = {
  id: number;
  conversation_id: number;
  sender_id: string;
  body: string;
  created_at: string;
  /** Moderation only. `body` is never rewritten when a message is hidden —
   *  the UI decides whether to render it. See hideMessage() on the site. */
  hidden_at: string | null;
};

export type InboxRow = {
  id: number;
  otherName: string;
  otherAvatarUrl: string | null;
  otherAvatarColor: string | null;
  lastMessageAt: string | null;
  listingTitle: string | null;
  unreadCount: number;
};

export type ConversationHeader = {
  id: number;
  otherName: string;
  otherAvatarUrl: string | null;
  otherAvatarColor: string | null;
  listingId: number | null;
  listingTitle: string | null;
};

type ParticipantRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  avatar_color: string | null;
};

type ConversationRow = {
  id: number;
  user_a_id: string;
  user_b_id: string;
  listing_id: number | null;
  last_message_at: string | null;
  created_at: string;
  user_a_archived_at: string | null;
  user_b_archived_at: string | null;
  user_a_last_read_at: string | null;
  user_b_last_read_at: string | null;
  user_a: ParticipantRow | null;
  user_b: ParticipantRow | null;
  listing: { id: number; title: string } | null;
};

const CONVERSATION_SELECT = `
  id, user_a_id, user_b_id, listing_id, last_message_at, created_at,
  user_a_archived_at, user_b_archived_at,
  user_a_last_read_at, user_b_last_read_at,
  user_a:profiles!conversations_user_a_id_fkey(id, first_name, last_name, avatar_url, avatar_color),
  user_b:profiles!conversations_user_b_id_fkey(id, first_name, last_name, avatar_url, avatar_color),
  listing:listings(id, title)
`;

/**
 * Bounded at 50, the same as the website's inbox, and for the same reason: a
 * member could in principle have a conversation with every other member, and
 * neither screen has a "load more" yet. Ordered by most recent activity, so
 * the cap only ever drops the threads nobody is looking for.
 */
const INBOX_LIMIT = 50;

const nameOf = (p: ParticipantRow | null): string =>
  p ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "A member" : "A member";

const otherOf = (
  row: Pick<ConversationRow, "user_a_id" | "user_a" | "user_b">,
  userId: string
): ParticipantRow | null => (row.user_a_id === userId ? row.user_b : row.user_a);

/** Whether the caller's own side of this thread is archived. The other
 *  participant's view is unaffected — 0049's per-side columns. */
const archivedForMe = (row: ConversationRow, userId: string): boolean =>
  row.user_a_id === userId
    ? row.user_a_archived_at !== null
    : row.user_b_archived_at !== null;

/**
 * The inbox.
 *
 * Two round trips for the whole list, never one per row: the conversations
 * themselves, and conversation_unread_counts() — one aggregated query that
 * returns every thread's unread count at once.
 *
 * Archived threads are filtered here rather than in the query, because
 * "archived" is whichever of two columns belongs to the caller and PostgREST
 * has no way to say that. Fifty rows is nothing to filter in JS.
 */
export async function listInbox(userId: string): Promise<InboxRow[]> {
  const [conversations, unread] = await Promise.all([
    supabase
      .from("conversations")
      .select(CONVERSATION_SELECT)
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(INBOX_LIMIT)
      .overrideTypes<ConversationRow[]>(),
    supabase.rpc("conversation_unread_counts"),
  ]);

  if (conversations.error) throw conversations.error;

  const counts = new Map<number, number>(
    ((unread.data as { conversation_id: number; unread_count: number }[] | null) ??
      []).map((row) => [row.conversation_id, Number(row.unread_count)])
  );

  return (conversations.data ?? [])
    .filter((row) => !archivedForMe(row, userId))
    .map((row) => {
      const other = otherOf(row, userId);
      return {
        id: row.id,
        otherName: nameOf(other),
        otherAvatarUrl: other?.avatar_url ?? null,
        otherAvatarColor: other?.avatar_color ?? null,
        lastMessageAt: row.last_message_at,
        listingTitle: row.listing?.title ?? null,
        unreadCount: counts.get(row.id) ?? 0,
      };
    });
}

/** Everything the thread screen needs above the messages. */
export async function conversationHeader(
  conversationId: number,
  userId: string
): Promise<ConversationHeader | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_SELECT)
    .eq("id", conversationId)
    .maybeSingle()
    .overrideTypes<ConversationRow>();

  if (error) throw error;
  if (!data) return null;

  const other = otherOf(data, userId);
  return {
    id: data.id,
    otherName: nameOf(other),
    otherAvatarUrl: other?.avatar_url ?? null,
    otherAvatarColor: other?.avatar_color ?? null,
    listingId: data.listing_id,
    listingTitle: data.listing?.title ?? null,
  };
}

export type Cursor = { createdAt: string; id: number };

/**
 * One page of a thread, newest first.
 *
 * Keyset pagination, not OFFSET: a long conversation grows without bound and
 * "page 40" of an offset scan gets slower every time somebody replies. The
 * tie-breaker on `id` matters because two messages really can share a
 * timestamp, and without it one of them is skipped at a page boundary. This
 * is the same filter the website builds in buildMessagesCursorFilter().
 */
export async function listMessages(
  conversationId: number,
  cursor: Cursor | null = null
): Promise<{ messages: Message[]; next: Cursor | null }> {
  let request = supabase
    .from("messages")
    .select("id, conversation_id, sender_id, body, created_at, hidden_at")
    .eq("conversation_id", conversationId);

  if (cursor) {
    request = request.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  const { data, error } = await request
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE)
    .overrideTypes<Message[]>();

  if (error) throw error;

  const messages = data ?? [];
  const last = messages[messages.length - 1];

  return {
    messages,
    // A short page means there is nothing older left.
    next:
      messages.length < MESSAGES_PAGE_SIZE || !last
        ? null
        : { createdAt: last.created_at, id: last.id },
  };
}

/**
 * Send.
 *
 * Through the website, not straight into Postgres — the rate limit, the
 * card-number rule, the block check, the two live broadcasts and the
 * notification all live in sendMessageTo() on the server. See
 * src/app/api/app/messages/route.ts.
 *
 * Throws ApiError, which already carries the server's own wording: "That
 * looks like a card number — payment happens through Pinpals checkout, never
 * in chat" is written for the member, and the screen shows it as-is.
 */
export async function sendMessage(
  conversationId: number,
  body: string
): Promise<Message> {
  const { message } = await postToSite<{ message: Message }>(
    "/api/app/messages",
    { conversation_id: conversationId, body }
  );
  return message;
}

/**
 * Mark this thread read, up to now, for the caller's own side only.
 *
 * Written directly rather than through a route: there is nothing to tell
 * anyone about, and prevent_conversation_tampering() (0049) is what actually
 * stops this touching the other participant's cursor or any other column —
 * this just picks which of the two columns is ours.
 *
 * Never throws. A read receipt that doesn't land means a badge stays up for a
 * few more minutes; it is not worth an error in front of someone who is
 * reading their messages.
 */
export async function markRead(
  conversationId: number,
  userId: string
): Promise<void> {
  const { data } = await supabase
    .from("conversations")
    .select("id, user_a_id")
    .eq("id", conversationId)
    .maybeSingle()
    .overrideTypes<{ id: number; user_a_id: string }>();

  if (!data) return;

  const column =
    data.user_a_id === userId ? "user_a_last_read_at" : "user_b_last_read_at";

  await supabase
    .from("conversations")
    .update({ [column]: new Date().toISOString() })
    .eq("id", conversationId);
}

/**
 * How many unread messages a member has across every thread — the envelope
 * badge on Home.
 *
 * conversation_unread_counts() is one indexed aggregate for the whole inbox,
 * so this stays a single round trip however many conversations someone has.
 */
export async function unreadMessageCount(): Promise<number> {
  const { data, error } = await supabase.rpc("conversation_unread_counts");
  if (error || !data) return 0;

  return (data as { unread_count: number }[]).reduce(
    (total, row) => total + Number(row.unread_count),
    0
  );
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** Whole days between two instants, by local calendar date rather than by
 *  hours — 11pm last night is "yesterday", not "2 hours ago". */
function daysAgo(iso: string, now = new Date()): number {
  const then = new Date(iso);
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** hour12 is explicit, and it matters: en-IE's default is the 24-hour clock,
 *  so leaving it out gives "21:25" while clockLabel() elsewhere in the app is
 *  saying "9:25pm" about the same thing. */
const clock = (then: Date): string =>
  then
    .toLocaleTimeString("en-IE", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase()
    .replace(/\s/g, "");

/** "9:41am", "Yesterday", "Sat", "12 Aug" — as much as is useful and no more,
 *  which is how every inbox anyone has used already behaves. */
export function inboxTime(iso: string | null): string {
  if (!iso) return "";

  const days = daysAgo(iso);
  if (days <= 0) return clock(new Date(iso));
  if (days === 1) return "Yesterday";
  if (days < 7)
    return new Date(iso).toLocaleDateString("en-IE", { weekday: "short" });
  return new Date(iso).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
  });
}

/** The separator above a run of messages from the same day. Computed from the
 *  date rather than sniffed from inboxTime()'s output — a heading reading
 *  "9:41am" is the bug that would cause. */
export function dayLabel(iso: string): string {
  const days = daysAgo(iso);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7)
    return new Date(iso).toLocaleDateString("en-IE", { weekday: "long" });
  return new Date(iso).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "long",
    year: days > 300 ? "numeric" : undefined,
  });
}
