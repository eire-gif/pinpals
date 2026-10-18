import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ScoreSheet } from "@/lib/live-scoring";
import { buildTvPayload, type TvDay, type TvEntry, type TvGame, type TvPayload, type TvRound } from "@/lib/tv-board";
import type { TvTarget } from "@/lib/tv-token";

/**
 * Loads one match day or round for a clubhouse TV (Oct 2026) and hands it to
 * tv-board.ts. Runs with the service client: the signed TV token already
 * proved the organiser chose to put this game on a screen, and it opens
 * nothing else. Players' home clubs come from their profiles (as shown on
 * PinPals to other members); guests have none.
 */

type RoundRow = {
  id: number;
  course_name: string;
  format: string;
  status: "live" | "finished";
  match_day_id: number | null;
  match_number: number | null;
  match_type: "singles" | "fourball" | "foursomes" | "greensomes" | null;
  tee_time: string | null;
  scramble_size: number | null;
  team_name: string | null;
  team_number: number | null;
  team_handicap: number | null;
  foursomes_scoring: "stableford" | "stroke" | null;
  greensomes: boolean | null;
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

const ROUND_COLS =
  "id, course_name, format, status, match_day_id, match_number, match_type, tee_time, scramble_size, team_name, team_number, team_handicap, foursomes_scoring, greensomes";

const toRound = (r: RoundRow): TvRound => ({
  id: r.id,
  matchNumber: r.match_number,
  format: r.format,
  matchFormat: r.scramble_size != null ? null : r.match_type === "singles" ? "matchplay" : r.match_type ?? (r.format === "matchplay" ? "matchplay" : null),
  status: r.status,
  courseName: r.course_name,
  teeTime: r.tee_time ? r.tee_time.slice(0, 5) : null,
  scramble:
    r.scramble_size != null
      ? { teamName: r.team_name, teamNumber: r.team_number, teamHandicap: r.team_handicap ?? 0, foursomes: r.foursomes_scoring ?? null, greensomes: !!r.greensomes }
      : null,
});

/** The TV's board, or null when the game no longer exists (deleted). */
export async function tvPayloadFor(db: SupabaseClient, target: TvTarget, now = new Date()): Promise<TvPayload | null> {
  let day: TvDay | null = null;
  let rounds: RoundRow[] = [];
  let published = false;

  if (target.kind === "day") {
    const [d, rs, res] = await Promise.all([
      db.from("live_match_days").select("id, title, team_names, kind").eq("id", target.id).maybeSingle(),
      db.from("live_rounds").select(ROUND_COLS).eq("match_day_id", target.id).order("match_number"),
      db.from("competition_results").select("status").eq("match_day_id", target.id).maybeSingle(),
    ]);
    if (d.error) throw d.error;
    if (rs.error) throw rs.error;
    const dd = d.data as { id: number; title: string; team_names: string[] | null; kind: string | null } | null;
    if (!dd) return null;
    day = {
      id: dd.id,
      title: dd.title,
      teamNames: dd.team_names && dd.team_names.length === 2 ? [dd.team_names[0], dd.team_names[1]] : null,
      kind: dd.kind === "scramble" ? "scramble" : dd.kind === "fourballs" ? "fourballs" : "match",
    };
    rounds = (rs.data ?? []) as RoundRow[];
    published = (res.data as { status: string } | null)?.status === "published";
  } else {
    const r = await db.from("live_rounds").select(ROUND_COLS).eq("id", target.id).maybeSingle();
    if (r.error) throw r.error;
    if (!r.data) return null;
    rounds = [r.data as RoundRow];
  }
  if (!rounds.length) return null;

  const ids = rounds.map((r) => r.id);
  const [players, holes, scores] = await Promise.all([
    db.from("live_round_players").select("id, round_id, member_id, display_name, course_handicap, playing_handicap, position, side").in("round_id", ids).order("position"),
    db.from("live_round_holes").select("round_id, hole, par, stroke_index").in("round_id", ids).order("hole"),
    db.from("live_round_scores").select("round_id, player_id, hole, strokes, updated_at").in("round_id", ids),
  ]);
  for (const r of [players, holes, scores]) if (r.error) throw r.error;

  const playerRows = (players.data ?? []) as PlayerRow[];
  const memberIds = [...new Set(playerRows.map((p) => p.member_id).filter((m): m is string => !!m))];
  const clubs = new Map<string, string>();
  if (memberIds.length) {
    const { data, error } = await db.from("profiles").select("id, home_club").in("id", memberIds);
    if (error) throw error;
    for (const p of (data ?? []) as { id: string; home_club: string | null }[]) if (p.home_club?.trim()) clubs.set(p.id, p.home_club.trim());
  }

  const scoreRows = (scores.data ?? []) as { round_id: number; player_id: number; hole: number; strokes: number | null; updated_at: string }[];
  const holeRows = (holes.data ?? []) as { round_id: number; hole: number; par: number; stroke_index: number | null }[];

  const games: TvGame[] = rounds.map((row) => {
    const sheet = new Map<number, Map<number, number | null>>();
    const entries: TvEntry[] = [];
    for (const s of scoreRows) {
      if (s.round_id !== row.id) continue;
      if (!sheet.has(s.player_id)) sheet.set(s.player_id, new Map());
      sheet.get(s.player_id)!.set(s.hole, s.strokes);
      entries.push({ playerId: s.player_id, hole: s.hole, strokes: s.strokes, at: s.updated_at });
    }
    return {
      round: toRound(row),
      players: playerRows
        .filter((p) => p.round_id === row.id)
        .map((p) => ({
          id: p.id,
          memberId: p.member_id,
          name: p.display_name,
          club: p.member_id ? clubs.get(p.member_id) ?? null : null,
          playingHandicap: p.playing_handicap,
          courseHandicap: p.course_handicap,
          side: p.side,
          position: p.position,
        })),
      card: holeRows.filter((h) => h.round_id === row.id).map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index })),
      scores: sheet as ScoreSheet,
      entries,
    };
  });

  return buildTvPayload({ day, games, published, now });
}
