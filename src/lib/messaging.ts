// Pure, framework-free messaging domain helpers — mirrors tee-times.ts /
// roles.ts (no Supabase, no Next.js) so pagination/eligibility-adjacent
// logic is trivial to unit test. The actual DB reads/writes live in
// src/app/conversations/actions.ts and the relevant Server/page components —
// see supabase/migrations/0025_messaging.sql for the full privacy model, and
// 0049_marketplace_messaging.sql for the marketplace-context additions
// (listing/order link, read receipts, archiving, blocking) this file's own
// helpers below are for.
import type { Conversation, ConversationParticipant } from "./types";

export const MESSAGE_MAX_LENGTH = 4000; // matches messages.body's own check constraint
export const MESSAGES_PAGE_SIZE = 30;

/** The other person in a DIRECT conversation, from the current user's point
 * of view. Null if `userId` isn't a participant, and null for a group, which
 * has no "the other person" — use otherMemberIds() below for that.
 *
 * Reads the pair columns rather than the members list because every caller
 * that still wants a single other person already has the conversation row and
 * is, by definition, looking at a two-party thread. */
export function otherParticipantId(
  conversation: Pick<Conversation, "user_a_id" | "user_b_id">,
  userId: string
): string | null {
  if (conversation.user_a_id === userId) return conversation.user_b_id;
  if (conversation.user_b_id === userId) return conversation.user_a_id;
  return null;
}

export type MessagesCursor = { createdAt: string; id: number };

/**
 * Builds the PostgREST `.or()` filter for keyset-paginating a conversation's
 * messages "older than" a cursor — `created_at < cursor.createdAt`, or equal
 * with a strictly smaller `id` as the tie-breaker for messages sharing a
 * timestamp. Paired with `.order("created_at", {ascending: false}).order("id",
 * {ascending: false})` and messages_conversation_created_idx
 * (0025_messaging.sql) so "load older messages" is a single indexed range
 * scan, never an OFFSET into a conversation that can grow without bound.
 * Pure and DB-free, exported for unit testing — see messaging.test.ts.
 */
export function buildMessagesCursorFilter(cursor: MessagesCursor): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}

/** The cursor to request the next (older) page from the last message of the
 * current page, given messages ordered newest-first. Null once the page
 * came back short of a full page (nothing older left). */
export function nextMessagesCursor(pageMessages: { created_at: string; id: number }[], pageSize: number): MessagesCursor | null {
  if (pageMessages.length < pageSize) return null;
  const last = pageMessages[pageMessages.length - 1];
  return { createdAt: last.created_at, id: last.id };
}

// ============ Read state / archiving (0049, moved by 0087) ============
//
// These used to pick between four columns on the conversation depending on
// which side the caller was. Read state now lives on `conversation_members`,
// one row per member carrying their own cursor, so the question changed from
// "which of two columns is mine" to "which of these rows is mine" — and that
// one generalises to a group of nine without changing shape.

/** The subset of a member row these need. Written structurally rather than as
 *  Pick<ConversationMember> so a query that selected only these two columns
 *  still satisfies it. */
export type MemberState = {
  member_id: string;
  last_read_at?: string | null;
  archived_at?: string | null;
};

/**
 * The PostgREST embed for a conversation's members, written once.
 *
 * Three pages and the inbox loader all want the same thing — who is in this
 * conversation, their own read/archive state, and enough of their profile to
 * put a name and a colour on a row — and three copies of an embed string is
 * three places for one of them to quietly select a column the others don't.
 */
export const CONVERSATION_MEMBERS_EMBED =
  "members:conversation_members(member_id, role, last_read_at, archived_at, profile:profiles(id, first_name, last_name, avatar_color))";

export type ConversationMemberRow = {
  member_id: string;
  role: "owner" | "member";
  last_read_at: string | null;
  archived_at: string | null;
  profile: ConversationParticipant | null;
};

/** What a conversation is called, from one member's point of view: a group by
 *  the name its owner gave it, a direct thread by whoever is on the other
 *  end. One function so an inbox row, a thread header and a notification
 *  cannot disagree about it. */
export function conversationName(
  conversation: Pick<Conversation, "kind" | "title">,
  members: ConversationMemberRow[],
  userId: string
): string {
  if (conversation.kind === "group") return conversation.title ?? "Group";
  const other = members.find((m) => m.member_id !== userId);
  if (!other?.profile) return "Unknown member";
  return `${other.profile.first_name} ${other.profile.last_name}`.trim() || "Unknown member";
}

/** The caller's own membership row, out of a conversation's members. */
export function myMembership<T extends MemberState>(members: T[], userId: string): T | null {
  return members.find((m) => m.member_id === userId) ?? null;
}

/** The current user's own read cursor for this conversation — null if
 * they've never read it (or aren't actually a participant). */
export function myLastReadAt(members: MemberState[], userId: string): string | null {
  return myMembership(members, userId)?.last_read_at ?? null;
}

/** A conversation is unread for `userId` when it has ever had a message and
 * that message landed after their own last-read cursor (or they've never
 * read it at all). Used for the inbox's unread badge/sort — the actual
 * per-message unread COUNT (for a "3 new" style badge) is computed in one
 * aggregated query server-side, not by iterating messages in JS; see
 * conversation_unread_counts(). */
export function isConversationUnread(
  conversation: Pick<Conversation, "last_message_at">,
  members: MemberState[],
  userId: string
): boolean {
  if (!conversation.last_message_at) return false;
  const lastRead = myLastReadAt(members, userId);
  if (!lastRead) return true;
  return new Date(conversation.last_message_at).getTime() > new Date(lastRead).getTime();
}

/** Whether `userId`'s own copy of this conversation is archived — every other
 * member's view is entirely unaffected. */
export function isConversationArchived(members: MemberState[], userId: string): boolean {
  return myMembership(members, userId)?.archived_at != null;
}

/** Everyone in the conversation except the caller. The recipients of a
 *  notification, the faces on an inbox row, and — when there is exactly one —
 *  the person a direct thread is named after. */
export function otherMemberIds(members: MemberState[], userId: string): string[] {
  return members.filter((m) => m.member_id !== userId).map((m) => m.member_id);
}

// ============ Inbox filters: Buying / Selling / Archived ============

export const INBOX_FILTERS = ["all", "buying", "selling", "archived"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

/**
 * A marketplace conversation's role for the current viewer, given the
 * listing it's about — `null` for a non-marketplace conversation (no
 * listing_id at all, e.g. from a connection or tee-time interest), which is
 * exactly why "Buying"/"Selling" are a subset of "All", not the whole
 * inbox. Determined from `listingSellerId` (the listing's own seller_id, not
 * anything stored on the conversation) rather than "am I user_a or user_b" —
 * a conversation's two sides carry no buyer/seller meaning of their own
 * (same "just an unordered pair" note as 0025's own Conversation comment).
 */
export function conversationRole(params: {
  listingId: number | null;
  listingSellerId: string | null;
  userId: string;
}): "buying" | "selling" | null {
  if (params.listingId === null || params.listingSellerId === null) return null;
  return params.listingSellerId === params.userId ? "selling" : "buying";
}

/** Pure predicate the inbox list filters its already-fetched rows through —
 * one round-trip loads everything, this just decides what a given tab
 * shows. `archived` looks at the viewer's own archive state regardless of
 * role; `all` explicitly still hides a viewer's own archived threads (an
 * archived conversation only ever reappears under the Archived tab), same
 * "archiving is a real filed-away action, not a label" behaviour most inbox
 * apps use. */
export function matchesInboxFilter(
  filter: InboxFilter,
  row: { role: "buying" | "selling" | null; archived: boolean }
): boolean {
  if (filter === "archived") return row.archived;
  if (row.archived) return false;
  if (filter === "all") return true;
  return row.role === filter;
}

// ============ "Never send card/bank/ID data through messages" ============
// Mirrors validate_message_content() (0049_marketplace_messaging.sql) in JS
// for instant client-side feedback before the round-trip to the DB, which
// remains the actually-enforced copy of this rule — see that function's own
// comment for why this is a deliberately conservative heuristic (it can
// over-trigger on e.g. a long, unbroken tracking number) rather than a
// precise card/IBAN validator.
const CARD_LIKE_NUMBER = /[0-9](?:[ -]?[0-9]){12,18}/;
const IBAN_LIKE = /[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]{11,30}/;
const VERIFICATION_NUMBER =
  /(passport|pps\s*(no|number)?|social security|ssn|sort code|routing number|verification code|\botp\b)\D{0,15}(?:[0-9][ -]?){3,}[0-9]/i;

export type SensitiveDataCheck = { blocked: false } | { blocked: true; reason: string };

export function containsSensitiveData(body: string): SensitiveDataCheck {
  if (CARD_LIKE_NUMBER.test(body)) {
    return { blocked: true, reason: "That looks like a card number — payment happens through Pinpals checkout, never in chat." };
  }
  const compact = body.replace(/[ -]/g, "");
  if (IBAN_LIKE.test(compact)) {
    return { blocked: true, reason: "That looks like a bank account or IBAN number — please don't send it in a message." };
  }
  if (VERIFICATION_NUMBER.test(body)) {
    return { blocked: true, reason: "That looks like an identity-verification number or code — please don't send it in a message." };
  }
  return { blocked: false };
}
