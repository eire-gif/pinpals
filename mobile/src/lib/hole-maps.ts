import type { LayoutPoint, PointKind, Shot } from "./hole-geo";
import { supabase } from "./supabase";

/**
 * Hole maps — reads and writes (0108, claude/hole-maps.md).
 *
 * Course geometry comes one club at a time from course_layout_get(): the
 * tables are closed to direct reads (golfapi.io's terms require reasonable
 * measures against scraping their data out of PinPals). Shots are a live
 * round's, read under the round's RLS and written through
 * live_round_shot_add / _undo like its scores.
 *
 * Nothing here measures anything: that is hole-geo.ts, on every render.
 */

export type CourseLayout = {
  id: number;
  name: string;
  holes: 9 | 18;
  source: "provider" | "admin";
  verified: boolean;
  points: LayoutPoint[];
};

type LayoutJson = {
  id: number;
  name: string;
  holes: number;
  source: "provider" | "admin";
  verified: boolean;
  points: Array<{ hole: number; kind: PointKind; lat: number; lng: number; label: string | null }>;
};

/** A club's courses with hole geometry. Empty until the club is imported. */
export async function loadCourseLayouts(clubId: number): Promise<CourseLayout[]> {
  const { data, error } = await supabase.rpc("course_layout_get", { p_club_id: clubId });
  if (error) throw error;
  return ((data ?? []) as LayoutJson[]).map((l) => ({
    id: l.id,
    name: l.name,
    holes: l.holes === 9 ? 9 : 18,
    source: l.source,
    verified: l.verified,
    points: l.points.map((p) => ({ hole: p.hole, kind: p.kind, lat: Number(p.lat), lng: Number(p.lng), label: p.label })),
  }));
}

/** Every shot marked in a round, by player. */
export async function loadRoundShots(roundId: number): Promise<Map<number, Shot[]>> {
  const { data, error } = await supabase
    .from("live_round_shots")
    .select("player_id, hole, shot_no, lat, lng, accuracy_m")
    .eq("round_id", roundId)
    .order("shot_no")
    .overrideTypes<{ player_id: number; hole: number; shot_no: number; lat: number; lng: number; accuracy_m: number | string | null }[]>();
  if (error) throw error;
  const byPlayerHole = new Map<number, Shot[]>();
  for (const s of data ?? []) {
    const key = shotKey(s.player_id, s.hole);
    if (!byPlayerHole.has(key)) byPlayerHole.set(key, []);
    byPlayerHole.get(key)!.push({
      shotNo: s.shot_no,
      lat: s.lat,
      lng: s.lng,
      accuracyM: s.accuracy_m == null ? null : Number(s.accuracy_m),
    });
  }
  return byPlayerHole;
}

/** Shots are grouped by player and hole; one number keeps the Map simple. */
export const shotKey = (playerId: number, hole: number): number => playerId * 100 + hole;

export async function addShot(
  roundId: number,
  playerId: number,
  hole: number,
  at: { lat: number; lng: number; accuracyM: number | null }
): Promise<void> {
  const { error } = await supabase.rpc("live_round_shot_add", {
    p_round_id: roundId,
    p_player_id: playerId,
    p_hole: hole,
    p_lat: at.lat,
    p_lng: at.lng,
    p_accuracy_m: at.accuracyM,
  });
  if (error) throw error;
}

export async function undoShot(roundId: number, playerId: number, hole: number): Promise<void> {
  const { error } = await supabase.rpc("live_round_shot_undo", { p_round_id: roundId, p_player_id: playerId, p_hole: hole });
  if (error) throw error;
}
