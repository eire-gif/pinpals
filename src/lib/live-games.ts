import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MatchFormat, ScoreSheet } from "@/lib/live-scoring";
import type { WidgetGame, WidgetPlayer, WidgetRound } from "@/lib/widget-board";

/**
 * Loads live games (rounds with their players, card and scores) with the
 * service client, for the Home Screen widget (widget-data.ts) and Follow my
 * round (follow-data.ts). Callers prove access first.
 */

export type RoundRow = {
  id: number;
  course_name: string;
  format: string;
  status: "live" | "finished";
  played_on: string;
  created_at: string;
  match_day_id: number | null;
  match_number: number | null;
  match_type: "singles" | "fourball" | "foursomes" | "greensomes" | null;
  tee_time: string | null;
  scramble_size: number | null;
  team_name: string | null;
  team_number: number | null;
  team_handicap: number | null;
  foursomes_scoring: "stableford" | "stroke" | null;
};
type PlayerRow = {
  id: number;
  round_id: number;
  member_id: string | null;
  display_name: string;
  course_handicap: number;
  playing_handicap: number;
  position: number;
  side: number | null;
};

export const ROUND_COLS =
  "id, course_name, format, status, played_on, created_at, match_day_id, match_number, match_type, tee_time, scramble_size, team_name, team_number, team_handicap, foursomes_scoring";
const PLAYER_COLS = "id, round_id, member_id, display_name, course_handicap, playing_handicap, position, side";

const toMatchFormat = (r: RoundRow): MatchFormat | null =>
  r.match_type === "singles" ? "matchplay" : r.match_type ?? (r.format === "matchplay" ? "matchplay" : null);

const toRound = (r: RoundRow): WidgetRound => ({
  id: r.id,
  matchDayId: r.match_day_id,
  matchNumber: r.match_number,
  format: r.format,
  matchFormat: r.scramble_size != null ? null : toMatchFormat(r),
  status: r.status,
  courseName: r.course_name,
  teeTime: r.tee_time ? r.tee_time.slice(0, 5) : null,
  scramble:
    r.scramble_size != null
      ? { teamName: r.team_name, teamNumber: r.team_number, teamHandicap: r.team_handicap ?? 0, foursomes: r.foursomes_scoring ?? null }
      : null,
});

const toPlayer = (p: PlayerRow): WidgetPlayer => ({
  id: p.id,
  memberId: p.member_id,
  name: p.display_name,
  playingHandicap: p.playing_handicap,
  courseHandicap: p.course_handicap,
  side: p.side,
  position: p.position,
});

export async function loadGames(db: SupabaseClient, rounds: RoundRow[]): Promise<WidgetGame[]> {
  const ids = rounds.map((r) => r.id);
  if (!ids.length) return [];
  const [players, holes, scores] = await Promise.all([
    db.from("live_round_players").select(PLAYER_COLS).in("round_id", ids).order("position"),
    db.from("live_round_holes").select("round_id, hole, par, stroke_index").in("round_id", ids).order("hole"),
    db.from("live_round_scores").select("round_id, player_id, hole, strokes").in("round_id", ids),
  ]);
  for (const r of [players, holes, scores]) if (r.error) throw r.error;
  return rounds.map((row) => {
    const sheet = new Map<number, Map<number, number | null>>();
    for (const s of (scores.data ?? []) as { round_id: number; player_id: number; hole: number; strokes: number | null }[]) {
      if (s.round_id !== row.id) continue;
      if (!sheet.has(s.player_id)) sheet.set(s.player_id, new Map());
      sheet.get(s.player_id)!.set(s.hole, s.strokes);
    }
    return {
      round: toRound(row),
      players: ((players.data ?? []) as PlayerRow[]).filter((p) => p.round_id === row.id).map(toPlayer),
      card: ((holes.data ?? []) as { round_id: number; hole: number; par: number; stroke_index: number | null }[])
        .filter((h) => h.round_id === row.id)
        .map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index })),
      scores: sheet as ScoreSheet,
    };
  });
}

