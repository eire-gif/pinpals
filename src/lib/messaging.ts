// Pure, framework-free messaging domain helpers — mirrors tee-times.ts /
// roles.ts (no Supabase, no Next.js) so pagination/eligibility-adjacent
// logic is trivial to unit test. The actual DB reads/writes live in
// src/app/conversations/actions.ts and the relevant Server/page components —
// see supabase/migrations/0025_messaging.sql for the full privacy model.
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
