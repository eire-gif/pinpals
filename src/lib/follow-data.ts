import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildFollowCard, type FollowCard } from "@/lib/follow-card";
import type { WidgetPayload } from "@/lib/widget-board";
import { loadGames, ROUND_COLS, type RoundRow } from "@/lib/live-games";

/**
 * "Follow my round" (0158), server side. Everything here runs with the
 * service client AFTER the caller has proved access: a link's secret (its
 * hash is looked up here), or — for a PinPal — the follow row read under RLS
 * with the member's own client.
 *
 * A share is live while it isn't stopped and hasn't lapsed (18 hours).
 */

export type FollowRow = {
  id: number;
  round_id: number;
  player_id: number;
  shared_by: string;
  follower_id: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

const FOLLOW_COLS = "id, round_id, player_id, shared_by, follower_id, created_at, expires_at, revoked_at";

/** A link's secret: 32 random bytes, base64url. Only its SHA-256 is stored. */
export function newFollowSecret(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashFollowToken(token)! };
}

export function hashFollowToken(token: unknown): string | null {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

export const isActive = (f: Pick<FollowRow, "revoked_at" | "expires_at">, now: Date) => !f.revoked_at && new Date(f.expires_at) > now;

export type FollowLookup = { ok: true; follow: FollowRow; card: FollowCard } | { ok: false; reason: "not_found" | "stopped" | "expired" | "gone" };

/** The card behind one share, or why there isn't one. */
export async function cardForFollow(db: SupabaseClient, follow: FollowRow, now = new Date()): Promise<FollowLookup> {
  if (follow.revoked_at) return { ok: false, reason: "stopped" };
  if (new Date(follow.expires_at) <= now) return { ok: false, reason: "expired" };
  if (follow.follower_id && !(await pinpalStillAllowed(db, follow))) return { ok: false, reason: "stopped" };

  const { data: round, error } = await db.from("live_rounds").select(ROUND_COLS).eq("id", follow.round_id).maybeSingle<RoundRow>();
  if (error) throw error;
  if (!round) return { ok: false, reason: "gone" };

  // A scramble / foursomes team's place is among the day's teams.
  let rows: RoundRow[] = [round];
  if (round.match_day_id != null && round.scramble_size != null) {
    const { data: dayRounds, error: e2 } = await db.from("live_rounds").select(ROUND_COLS).eq("match_day_id", round.match_day_id);
    if (e2) throw e2;
    rows = (dayRounds ?? []) as RoundRow[];
  }
  const games = await loadGames(db, rows);
  const game = games.find((g) => g.round.id === round.id);
  if (!game) return { ok: false, reason: "gone" };
  const card = buildFollowCard({ game, playerId: follow.player_id, dayGames: games, playedOn: round.played_on, now });
  if (!card) return { ok: false, reason: "gone" };
  return { ok: true, follow, card };
}

/**
 * A PinPal share holds only while it would still be allowed today: checked
 * on every read, so a block (either way, with the sharer or the golfer whose
 * card it is), an unfriending or a deleted account ends it at once rather
 * than when it lapses.
 */
async function pinpalStillAllowed(db: SupabaseClient, follow: FollowRow): Promise<boolean> {
  const follower = follow.follower_id!;
  const { data: owner } = await db.from("live_round_players").select("member_id").eq("id", follow.player_id).maybeSingle<{ member_id: string | null }>();
  const people = [...new Set([follow.shared_by, owner?.member_id].filter((x): x is string => !!x && x !== follower))];
  const [profile, blocks, link] = await Promise.all([
    db.from("profiles").select("id").eq("id", follower).is("deleted_at", null).maybeSingle(),
    db
      .from("blocked_users")
      .select("blocker_id")
      .or(people.map((m) => `and(blocker_id.eq.${m},blocked_id.eq.${follower}),and(blocker_id.eq.${follower},blocked_id.eq.${m})`).join(","))
      .limit(1),
    db
      .from("connections")
      .select("status")
      .eq("status", "accepted")
      .or(`and(requester_id.eq.${follow.shared_by},recipient_id.eq.${follower}),and(requester_id.eq.${follower},recipient_id.eq.${follow.shared_by})`)
      .limit(1),
  ]);
  if (profile.error || blocks.error || link.error) throw profile.error ?? blocks.error ?? link.error;
  return !!profile.data && (blocks.data ?? []).length === 0 && (link.data ?? []).length > 0;
}

/** For the public page: the link's secret → its card. */
export async function cardForLink(db: SupabaseClient, token: unknown, now = new Date()): Promise<FollowLookup> {
  const hash = hashFollowToken(token);
  if (!hash) return { ok: false, reason: "not_found" };
  const { data, error } = await db.from("live_round_follows").select(FOLLOW_COLS).eq("token_hash", hash).maybeSingle<FollowRow>();
  if (error) throw error;
  if (!data) return { ok: false, reason: "not_found" };
  return cardForFollow(db, data, now);
}

export type FollowingItem = {
  followId: number;
  sharedBy: string;
  card: FollowCard;
};

/** Cards a member follows right now, live ones first, newest first. */
export async function followingFor(db: SupabaseClient, memberId: string, now = new Date()): Promise<FollowingItem[]> {
  const { data, error } = await db
    .from("live_round_follows")
    .select(FOLLOW_COLS)
    .eq("follower_id", memberId)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const rows = (data ?? []) as FollowRow[];
  const sharers = [...new Set(rows.map((r) => r.shared_by))];
  const names = new Map<string, string>();
  if (sharers.length) {
    const { data: profs } = await db.from("profiles").select("id, first_name").in("id", sharers);
    for (const p of (profs ?? []) as { id: string; first_name: string | null }[]) names.set(p.id, p.first_name?.trim() || "A PinPal");
  }
  const items: FollowingItem[] = [];
  for (const row of rows) {
    const got = await cardForFollow(db, row, now);
    if (got.ok) items.push({ followId: row.id, sharedBy: names.get(row.shared_by) ?? "A PinPal", card: got.card });
  }
  return items.sort((a, b) => (a.card.state === b.card.state ? 0 : a.card.state === "live" ? -1 : 1));
}

/**
 * The Home Screen widget, for a member who isn't playing but follows
 * someone: the followed card, as a one-row board. Null when there's nothing
 * live to follow (the widget then shows its usual "No game in play").
 */
export async function widgetFollowFor(db: SupabaseClient, memberId: string, now = new Date()): Promise<WidgetPayload | null> {
  const items = await followingFor(db, memberId, now);
  const pick = items[0];
  if (!pick) return null;
  const c = pick.card;
  const value = c.summary.big;
  const thru = c.summary.progress === "Finished" ? "F" : c.summary.progress === "Not started" ? "–" : c.summary.progress.replace("Thru ", "");
  return {
    v: 1,
    state: c.state,
    updatedAt: now.toISOString(),
    url: `pinpals://live/follow/${pick.followId}`,
    eyebrow: `PINPALS · FOLLOWING ${c.firstName.toUpperCase()}`,
    title: `${c.course} · ${c.formatLabel}`,
    teams: [],
    matches: [],
    board: {
      heading: c.valueHeading,
      rows: [{ pos: c.summary.place ? c.summary.place.split(" ")[0].replace(/(st|nd|rd|th)$/, "") : "–", name: c.name, thru, score: value, mine: true, good: false }],
    },
    mine: {
      eyebrow: "FOLLOWING",
      title: c.name,
      big: value,
      line1: [c.summary.unit === "pts" ? "pts" : c.summary.unit === "net" ? "net" : "", c.summary.progress.toLowerCase()].filter(Boolean).join(" · "),
      line2: c.summary.place ?? (c.nowPlaying ? `Playing the ${ordinalHole(c.nowPlaying)}` : c.course),
    },
  };
}

function ordinalHole(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}
