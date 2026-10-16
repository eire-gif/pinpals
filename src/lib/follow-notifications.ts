import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { cardForFollow, isActive, type FollowRow } from "@/lib/follow-data";
import { highlightMessage, type HighlightKind } from "@/lib/live-highlight-rules";
import { notifyUser } from "@/lib/notifications-server";

/**
 * "Follow my round" alerts (0158), to PinPals following a card. Link
 * followers have no account, so they're never sent anything: the page they
 * have open flashes a birdie itself.
 *
 *   - you've been sent a card to follow       → live_follow_started
 *   - a birdie or better on it; and the finish → live_follow_update
 *
 * The app only (Inbox + push), under "Tee times & matches". Each has a
 * dedupe key, so a retry never buzzes twice. Text carries only the shared
 * player's name, the course and their score — what the follower can see.
 */

const FOLLOW_COLS = "id, round_id, player_id, shared_by, follower_id, created_at, expires_at, revoked_at";
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

async function firstNameOf(admin: SupabaseClient, memberId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("first_name").eq("id", memberId).maybeSingle<{ first_name: string | null }>();
  return data?.first_name?.trim() || "A PinPal";
}

/** After live_follow_share(): tell each PinPal who's just been sent a card. */
export async function notifyFollowStarted(admin: SupabaseClient, followIds: number[], sharedBy: string): Promise<number> {
  if (!followIds.length) return 0;
  const { data } = await admin.from("live_round_follows").select(FOLLOW_COLS).in("id", followIds).not("follower_id", "is", null);
  const rows = (data ?? []) as FollowRow[];
  const by = await firstNameOf(admin, sharedBy);
  const { data: owners } = await admin.from("live_round_players").select("id, member_id").in("id", [...new Set(rows.map((r) => r.player_id))]);
  const ownerOf = new Map(((owners ?? []) as { id: number; member_id: string | null }[]).map((o) => [o.id, o.member_id]));
  let sent = 0;
  for (const f of rows) {
    const got = await cardForFollow(admin, f);
    if (!got.ok || !f.follower_id) continue;
    // Their own card, or a guest's they're sharing (a junior, say).
    const own = ownerOf.get(f.player_id) === sharedBy;
    await notifyUser(admin, {
      userId: f.follower_id,
      type: "live_follow_started",
      title: own ? `${by} is sharing their round with you` : `${by} is sharing ${got.card.firstName}'s round with you`,
      body: `${got.card.course}, ${got.card.formatLabel}. Tap to follow the card live, hole by hole.`,
      href: `/live/follow/${f.id}`,
      appOnly: true,
      // Per share period: sent again if it was stopped and shared again.
      dedupeKey: `live_follow_started:${f.id}:${f.expires_at}`,
    });
    sent += 1;
  }
  return sent;
}

async function activeFollowers(admin: SupabaseClient, where: { roundId: number; playerIds?: number[] }): Promise<FollowRow[]> {
  let q = admin.from("live_round_follows").select(FOLLOW_COLS).eq("round_id", where.roundId).not("follower_id", "is", null).is("revoked_at", null);
  if (where.playerIds) q = q.in("player_id", where.playerIds);
  const { data } = await q;
  const now = new Date();
  return ((data ?? []) as FollowRow[]).filter((f) => isActive(f, now));
}

/** A birdie or better on a followed card. `playerIds`: whose ball it was
 *  (one player; a pair; a whole scramble team). Each follower's message
 *  names only the player they follow (or the team) — never a partner. */
export async function notifyFollowersOfHighlight(
  admin: SupabaseClient,
  input: {
    roundId: number;
    playerIds: number[];
    hole: number;
    kind: HighlightKind;
    par: number;
    strokes: number;
    course: string;
    /** Who a follower of this player is told about: their first name, or the team. */
    whoFor: (playerId: number) => string;
    skip: Set<string>;
  }
): Promise<number> {
  const follows = await activeFollowers(admin, { roundId: input.roundId, playerIds: input.playerIds });
  let sent = 0;
  for (const f of follows) {
    if (!f.follower_id || input.skip.has(f.follower_id)) continue;
    const msg = highlightMessage({ kind: input.kind, who: input.whoFor(f.player_id), hole: input.hole, par: input.par, strokes: input.strokes, course: input.course });
    await notifyUser(admin, {
      userId: f.follower_id,
      type: "live_follow_update",
      title: msg.title,
      body: msg.body.replace("Tap for the leaderboard.", "Tap to follow the card."),
      href: `/live/follow/${f.id}`,
      appOnly: true,
      dedupeKey: `live_follow_update:${f.id}:${input.hole}:${input.kind}`,
    });
    sent += 1;
  }
  return sent;
}

/** The round's over: each PinPal following a card on it hears the score. */
export async function notifyFollowersFinished(admin: SupabaseClient, roundId: number): Promise<number> {
  const follows = await activeFollowers(admin, { roundId });
  let sent = 0;
  for (const f of follows) {
    const got = await cardForFollow(admin, f);
    if (!got.ok || got.card.state !== "final" || !f.follower_id) continue;
    const c = got.card;
    const score = c.summary.big === "–" ? "" : ` — ${c.summary.big}${c.summary.unit ? ` ${c.summary.unit}` : ""}`;
    await notifyUser(admin, {
      userId: f.follower_id,
      type: "live_follow_update",
      title: `${first(c.name)} has finished${score}`,
      body: `${c.course}${c.summary.place ? `, ${c.summary.place}` : ""}. Tap to see the whole card.`,
      href: `/live/follow/${f.id}`,
      appOnly: true,
      dedupeKey: `live_follow_update:${f.id}:finished`,
    });
    sent += 1;
  }
  return sent;
}
