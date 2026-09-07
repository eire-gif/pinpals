// Pure, framework-free messaging domain helpers — mirrors tee-times.ts /
// roles.ts (no Supabase, no Next.js) so pagination/eligibility-adjacent
// logic is trivial to unit test. The actual DB reads/writes live in
// src/app/conversations/actions.ts and the relevant Server/page components —
// see supabase/migrations/0025_messaging.sql for the full privacy model, and
// 0049_marketplace_messaging.sql for the marketplace-context additions
// (listing/order link, read receipts, archiving, blocking) this file's own
// helpers below are for.
import type { Conversation } from "./types";

export const MESSAGE_MAX_LENGTH = 4000; // matches messages.body's own check constraint
export const MESSAGES_PAGE_SIZE = 30;

/** The other person in a two-party conversation, from the current user's
 * point of view. Returns null if `userId` isn't actually a participant
 * (shouldn't happen given RLS already scoped the row to them, but this is
 * cheap to check rather than assume). */
export function otherParticipantId(conversation: Pick<Conversation, "user_a_id" | "user_b_id">, userId: string): string | null {
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

// ============ Read state / archiving (0049) ============
// Same "which side is the caller on" shape as otherParticipantId() above —
// these are the read cursor/archive-state equivalents.

type ReadableConversation = Pick<
  Conversation,
  "user_a_id" | "user_b_id" | "user_a_last_read_at" | "user_b_last_read_at"
>;

/** The current user's own read cursor for this conversation — null if
 * they've never read it (or aren't actually a participant). */
export function myLastReadAt(conversation: ReadableConversation, userId: string): string | null {
  if (conversation.user_a_id === userId) return conversation.user_a_last_read_at;
  if (conversation.user_b_id === userId) return conversation.user_b_last_read_at;
  return null;
}

/** A conversation is unread for `userId` when it has ever had a message and
 * that message landed after their own last-read cursor (or they've never
 * read it at all). Used for the inbox's unread badge/sort — the actual
 * per-message unread COUNT (for a "3 new" style badge) is computed in one
 * aggregated query server-side, not by iterating messages in JS; see
 * listConversationsForInbox() in src/lib/conversations-server.ts. */
export function isConversationUnread(
  conversation: Pick<Conversation, "last_message_at">,
  readable: ReadableConversation,
  userId: string
): boolean {
  if (!conversation.last_message_at) return false;
  const lastRead = myLastReadAt(readable, userId);
  if (!lastRead) return true;
  return new Date(conversation.last_message_at).getTime() > new Date(lastRead).getTime();
}

type ArchivableConversation = Pick<Conversation, "user_a_id" | "user_b_id" | "user_a_archived_at" | "user_b_archived_at">;

/** Whether `userId`'s own side of this conversation is archived — the other
 * participant's view is entirely unaffected (0049's per-side columns). */
export function isConversationArchived(conversation: ArchivableConversation, userId: string): boolean {
  if (conversation.user_a_id === userId) return conversation.user_a_archived_at !== null;
  if (conversation.user_b_id === userId) return conversation.user_b_archived_at !== null;
  return false;
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
