import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MatchFormat, ScoreSheet } from "@/lib/live-scoring";
import { buildWidgetPayload, emptyPayload, type WidgetDay, type WidgetGame, type WidgetPayload, type WidgetPlayer, type WidgetRound } from "@/lib/widget-board";

/**
 * Loads a member's current game for their widget (Oct 2026) and hands it to
 * widget-board.ts. Runs with the service client — the widget token already
 * proved who is asking — and reads only games that member is playing in.
 *
 * Which game: the newest one still live; failing that, one finished today
 * (so the final score stays up for the evening); otherwise "none".
 */

type RoundRow = {
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

const ROUND_COLS =
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

/** Today's date in Ireland, as played_on stores it. */
export function irishToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The game the widget should show: live first (newest), else finished today. */
export function pickFocus<T extends { status: string; played_on: string; created_at: string }>(rounds: T[], today: string): T | null {
  const byNewest = [...rounds].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return byNewest.find((r) => r.status === "live") ?? byNewest.find((r) => r.played_on === today) ?? null;
}

async function loadGames(db: SupabaseClient, rounds: RoundRow[]): Promise<WidgetGame[]> {
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

export async function widgetPayloadFor(db: SupabaseClient, memberId: string, now = new Date()): Promise<WidgetPayload> {
  const { data: mine, error: e1 } = await db.from("live_round_players").select("round_id").eq("member_id", memberId).order("round_id", { ascending: false }).limit(50);
  if (e1) throw e1;
  const ids = [...new Set(((mine ?? []) as { round_id: number }[]).map((r) => r.round_id))];
  if (!ids.length) return emptyPayload(now);

  const { data: rounds, error: e2 } = await db.from("live_rounds").select(ROUND_COLS).in("id", ids);
  if (e2) throw e2;
  const focusRow = pickFocus((rounds ?? []) as RoundRow[], irishToday(now));
  if (!focusRow) return emptyPayload(now);

  let day: WidgetDay | null = null;
  let dayRows: RoundRow[] = [focusRow];
  if (focusRow.match_day_id != null) {
    const [d, rs] = await Promise.all([
      db.from("live_match_days").select("id, title, team_names, kind").eq("id", focusRow.match_day_id).maybeSingle(),
      db.from("live_rounds").select(ROUND_COLS).eq("match_day_id", focusRow.match_day_id).order("match_number"),
    ]);
    if (d.error) throw d.error;
    if (rs.error) throw rs.error;
    const dd = d.data as { id: number; title: string; team_names: string[] | null; kind: string | null } | null;
    if (dd) {
      day = {
        id: dd.id,
        title: dd.title,
        teamNames: dd.team_names && dd.team_names.length === 2 ? [dd.team_names[0], dd.team_names[1]] : null,
        kind: dd.kind === "scramble" ? "scramble" : "match",
      };
      dayRows = (rs.data ?? []) as RoundRow[];
    }
  }

  const games = await loadGames(db, dayRows);
  const focus = games.find((g) => g.round.id === focusRow.id);
  if (!focus) return emptyPayload(now);
  return buildWidgetPayload({ me: memberId, focus, day, games, now });
}
