import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";

/**
 * Blocking a member, once, for every caller: the conversation screen's
 * block control, the feed's post and comment menus, a member's page on the
 * website, and the app's /api/app/blocks routes.
 *
 * WHAT A BLOCK DOES is decided entirely in the database, not here, and it
 * works in both directions whoever pressed the button:
 *   - messages: can_message() refuses (0049), and a group with both of
 *     them in it refuses posts from either (0087)
 *   - the feed: can_view_post() hides each one's posts from the other,
 *     and their comments disappear from each other's view on anyone's post
 *     (0088)
 * So the moment the row exists, the other member's posts and comments are
 * gone from the blocker's feed. Nothing to tidy up afterwards, and nothing
 * is deleted — unblocking restores everything.
 *
 * Nobody is told. A notification that you have been blocked is how a
 * block turns into a confrontation, which is the opposite of its purpose.
 *
 * Apple App Store Review Guideline 1.2 requires an app with user-generated
 * content to let members block abusive users; until this module the app
 * had no way to block anyone at all, and the website only from inside a
 * conversation.
 *
 * `supabase` is always the member's own client: blocked_users' INSERT and
 * DELETE policies (0049) only allow rows with the caller as blocker, so the
 * policy is what enforces "you can only block on your own behalf".
 */

export type BlockFailure = "invalid" | "rate_limited" | "not_found" | "failed";

export type BlockResult = { ok: true } | { ok: false; reason: BlockFailure; message: string };

// The same ceiling the conversation block control has always had: a real
// member blocks a handful of people in a lifetime, a script flaps.
export const BLOCK_MAX_ATTEMPTS = 20;
export const BLOCK_WINDOW_SECONDS = 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function statusForBlockFailure(reason: BlockFailure): number {
  switch (reason) {
    case "invalid":
      return 422;
    case "rate_limited":
      return 429;
    case "not_found":
      return 404;
    case "failed":
      return 500;
  }
}

export async function blockMember(
  supabase: SupabaseClient,
  userId: string,
  memberId: string
): Promise<BlockResult> {
  if (!UUID.test(memberId)) return { ok: false, reason: "invalid", message: "That member couldn't be found." };
  if (memberId === userId) return { ok: false, reason: "invalid", message: "You can't block yourself." };

  const limit = await checkRateLimit({
    action: "block-user",
    identifier: userId,
    maxHits: BLOCK_MAX_ATTEMPTS,
    windowSeconds: BLOCK_WINDOW_SECONDS,
  });
  if (!limit.allowed) return { ok: false, reason: "rate_limited", message: rateLimitMessage(limit.retryAfterSeconds) };

  const { error } = await supabase.from("blocked_users").insert({ blocker_id: userId, blocked_id: memberId });
  // 23505: already blocked — the member's intent is already true.
  if (!error || error.code === "23505") return { ok: true };
  // 23503: no such profile.
  if (error.code === "23503") return { ok: false, reason: "not_found", message: "That member couldn't be found." };
  return { ok: false, reason: "failed", message: "Couldn't block that member — please try again." };
}

export async function unblockMember(
  supabase: SupabaseClient,
  userId: string,
  memberId: string
): Promise<BlockResult> {
  if (!UUID.test(memberId)) return { ok: false, reason: "invalid", message: "That member couldn't be found." };

  const { error } = await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", memberId);
  if (error) return { ok: false, reason: "failed", message: "Couldn't unblock that member — please try again." };
  return { ok: true };
}

/** Has the viewer blocked this member? Only the viewer's own blocks are
 *  readable (0049), which is all a page needs to decide between Block and
 *  Unblock — whether the OTHER person has blocked you is deliberately not
 *  something any page can show. */
export async function hasBlocked(supabase: SupabaseClient, userId: string, memberId: string): Promise<boolean> {
  const { data } = await supabase
    .from("blocked_users")
    .select("blocked_id")
    .eq("blocker_id", userId)
    .eq("blocked_id", memberId)
    .maybeSingle();
  return !!data;
}
