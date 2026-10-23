import { getFromSite } from "./api";
import type { BagClub } from "./bag";
import type { LatLng } from "./hole-geo";
import { supabase } from "./supabase";
import type { Wind } from "./wind";

/**
 * The hole map's extras (Oct 2026): wind, My bag, the club for a shot, and
 * local knowledge. Reads and writes; the sums are in wind.ts and bag.ts.
 */

// ---- Wind (website: /api/app/wind, src/lib/wind.ts) ----

const windCache = new Map<string, { at: number; wind: Wind | null }>();

/** The wind at a course; null when the service has none. Kept 10 minutes. */
export async function loadWind(at: LatLng): Promise<Wind | null> {
  const key = `${at.lat.toFixed(2)},${at.lng.toFixed(2)}`;
  const hit = windCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.wind;
  const { wind } = await getFromSite<{ wind: Wind | null }>(`/api/app/wind?lat=${at.lat.toFixed(4)}&lng=${at.lng.toFixed(4)}`);
  windCache.set(key, { at: Date.now(), wind });
  return wind;
}

// ---- My bag (0153) ----

type BagRow = { club: string; in_bag: boolean; yards: number | null; shots: number; median_m: number | string | null; low_m: number | string | null; high_m: number | string | null };
const num = (v: number | string | null) => (v == null ? null : Number(v));

export async function loadMyBag(): Promise<BagClub[]> {
  const { data, error } = await supabase.rpc("my_bag");
  if (error) throw error;
  return ((data ?? []) as BagRow[]).map((r) => ({
    club: r.club,
    inBag: r.in_bag,
    yards: r.yards,
    shots: r.shots,
    medianM: num(r.median_m),
    lowM: num(r.low_m),
    highM: num(r.high_m),
  }));
}

/** Add a club to the bag, take it out, or set what the member hits it. */
export async function saveBagClub(club: string, change: { yards?: number | null; inBag?: boolean }): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const me = session.session?.user.id;
  if (!me) throw new Error("Sign in first");
  const row: Record<string, unknown> = { member_id: me, club, updated_at: new Date().toISOString() };
  if (change.yards !== undefined) row.yards = change.yards;
  if (change.inBag !== undefined) row.in_bag = change.inBag;
  const { error } = await supabase.from("member_bag").upsert(row, { onConflict: "member_id,club" });
  if (error) throw error;
}

/** Say which club a marked shot was hit with (or null to clear it). */
export async function tagShotClub(roundId: number, playerId: number, hole: number, shotNo: number, club: string | null, distanceM: number | null): Promise<void> {
  const { error } = await supabase.rpc("live_round_shot_club", {
    p_round_id: roundId,
    p_player_id: playerId,
    p_hole: hole,
    p_shot_no: shotNo,
    p_club: club,
    p_distance_m: distanceM == null ? null : Math.round(distanceM * 10) / 10,
  });
  if (error) throw error;
}

/** A club can be kept with a shot of up to this many metres (0153 checks it too). */
export const TAG_MAX_M = 450;

/** Whether a marked shot's distance is one a club can be kept with. */
export const taggable = (distanceM: number | null | undefined): distanceM is number => distanceM != null && distanceM >= 1 && distanceM <= TAG_MAX_M;

/** The member's longest tagged shot with each club: in one round, or ever (0154). */
export type LongestShot = {
  club: string;
  distanceM: number;
  roundId: number;
  hole: number;
  shotNo: number;
  playedOn: string | null;
  courseName: string | null;
  /** The round's club, so the shot can be opened on its hole map (Oct 2026). */
  clubId: number | null;
};

export async function loadLongestShots(roundId: number | null = null): Promise<LongestShot[]> {
  const { data, error } = await supabase.rpc("my_longest_shots", roundId == null ? {} : { p_round_id: roundId });
  if (error) throw error;
  const rows = (data ?? []) as Array<{ club: string; distance_m: number | string; round_id: number; hole: number; shot_no: number; played_on: string | null; course_name: string | null }>;
  // Which club each round was at — read with the round (the player can see
  // their own rounds), so 0154 needn't change. Without it the row still
  // shows, it just doesn't open the map.
  const roundIds = [...new Set(rows.map((r) => r.round_id))];
  const clubOf = new Map<number, number | null>();
  if (roundIds.length) {
    const { data: rounds } = await supabase.from("live_rounds").select("id, club_id").in("id", roundIds);
    for (const r of (rounds ?? []) as { id: number; club_id: number | null }[]) clubOf.set(r.id, r.club_id);
  }
  return rows.map((r) => ({
    club: r.club,
    distanceM: Number(r.distance_m),
    roundId: r.round_id,
    hole: r.hole,
    shotNo: r.shot_no,
    playedOn: r.played_on,
    courseName: r.course_name,
    clubId: clubOf.get(r.round_id) ?? null,
  }));
}

/** The clubs already tagged on this round's shots, by player and hole. */
export async function loadShotClubs(roundId: number): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("live_round_shots").select("player_id, hole, shot_no, club").eq("round_id", roundId).not("club", "is", null);
  if (error) throw error;
  return new Map(((data ?? []) as { player_id: number; hole: number; shot_no: number; club: string }[]).map((r) => [`${r.player_id}-${r.hole}-${r.shot_no}`, r.club]));
}

// ---- Local knowledge (0153) ----

export type HoleTip = {
  id: number;
  body: string;
  createdAt: string;
  author: string;
  handicap: number | null;
  useful: number;
  iFoundUseful: boolean;
  mine: boolean;
  hidden: boolean;
};

export async function loadHoleTips(clubId: number, hole: number): Promise<HoleTip[]> {
  const { data, error } = await supabase.rpc("hole_tips_for", { p_club_id: clubId, p_hole: hole });
  if (error) throw error;
  return (
    (data ?? []) as Array<{ id: number; body: string; created_at: string; author_first_name: string | null; author_handicap: number | string | null; useful: number; i_found_useful: boolean; mine: boolean; hidden: boolean }>
  ).map((t) => ({
    id: t.id,
    body: t.body,
    createdAt: t.created_at,
    author: t.author_first_name ?? "A member",
    handicap: num(t.author_handicap),
    useful: t.useful,
    iFoundUseful: t.i_found_useful,
    mine: t.mine,
    hidden: t.hidden,
  }));
}

export async function addHoleTip(clubId: number, hole: number, body: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const me = session.session?.user.id;
  if (!me) throw new Error("Sign in first");
  const { error } = await supabase.from("hole_tips").insert({ club_id: clubId, hole, member_id: me, body: body.trim() });
  if (error) {
    if (error.code === "23505") throw new Error("You've already left a tip for this hole. Delete it to write a new one.");
    throw error;
  }
}

export async function deleteHoleTip(id: number): Promise<void> {
  const { error } = await supabase.from("hole_tips").delete().eq("id", id);
  if (error) throw error;
}

export async function setTipUseful(tipId: number, on: boolean): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const me = session.session?.user.id;
  if (!me) throw new Error("Sign in first");
  const { error } = on
    ? await supabase.from("hole_tip_votes").insert({ tip_id: tipId, member_id: me })
    : await supabase.from("hole_tip_votes").delete().eq("tip_id", tipId).eq("member_id", me);
  if (error && error.code !== "23505") throw error;
}
