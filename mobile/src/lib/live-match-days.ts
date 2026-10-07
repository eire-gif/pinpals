import type { RealtimeChannel } from "@supabase/supabase-js";

import { postToSite } from "./api";
import {
  ROUND_SELECT,
  PLAYER_SELECT,
  toPlayer,
  toRound,
  type LiveRound,
  type LiveRoundPlayer,
  type PlayerRow,
  type RoundRow,
} from "./live-rounds";
import {
  matchPoints,
  teamMatchState,
  type CardHole,
  type MatchFormat,
  type MatchPlayer,
  type ScoreSheet,
  type TeamMatchState,
} from "./live-scoring";
import { supabase } from "./supabase";

/**
 * Match days (0104): several matches at one course on one day, often
 * between two teams. Each match is a live round; this file loads them
 * together for the board and starts a day.
 *
 * As with single rounds, nothing scored is stored: each match's status and
 * the team totals come from live-scoring.ts on every render.
 */

export type MatchDay = {
  id: number;
  createdBy: string | null;
  title: string;
  clubId: number | null;
  courseName: string;
  teeName: string | null;
  holes: 9 | 18;
  playedOn: string;
  /** [side 1, side 2], or null when there are no team totals. */
  teamNames: [string, string] | null;
};

export type Match = {
  round: LiveRound;
  players: LiveRoundPlayer[];
  card: CardHole[];
  scores: ScoreSheet;
  format: MatchFormat;
  state: TeamMatchState | null;
};

export type MatchDayData = {
  day: MatchDay;
  matches: Match[];
  /** Points from finished matches, and if every match ended as it stands. */
  totals: { final: [number, number]; projected: [number, number]; finishedCount: number };
};

export type MatchDaySummary = {
  id: number;
  title: string;
  courseName: string;
  playedOn: string;
  matchCount: number;
  live: boolean;
};

type DayRow = {
  id: number;
  created_by: string | null;
  title: string;
  club_id: number | null;
  course_name: string;
  tee_name: string | null;
  holes: number;
  played_on: string;
  team_names: string[] | null;
};

const DAY_SELECT = "id, created_by, title, club_id, course_name, tee_name, holes, played_on, team_names";

const toDay = (d: DayRow): MatchDay => ({
  id: d.id,
  createdBy: d.created_by,
  title: d.title,
  clubId: d.club_id,
  courseName: d.course_name,
  teeName: d.tee_name,
  holes: d.holes === 9 ? 9 : 18,
  playedOn: d.played_on,
  teamNames: d.team_names && d.team_names.length === 2 ? [d.team_names[0], d.team_names[1]] : null,
});

export const asMatchPlayers = (players: LiveRoundPlayer[]): MatchPlayer[] =>
  players.map((p) => ({
    id: p.id,
    name: p.name,
    playingHandicap: p.playingHandicap,
    courseHandicap: p.courseHandicap,
    side: p.side ?? 1,
    position: p.position,
  }));

/** Match days I organised or play in, newest first. RLS does the filtering. */
export async function loadMyMatchDays(): Promise<MatchDaySummary[]> {
  const { data, error } = await supabase
    .from("live_match_days")
    .select("id, title, course_name, played_on, live_rounds (status)")
    .order("created_at", { ascending: false })
    .limit(20)
    .overrideTypes<{ id: number; title: string; course_name: string; played_on: string; live_rounds: { status: string }[] }[]>();
  if (error) throw error;
  return (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    courseName: d.course_name,
    playedOn: d.played_on,
    matchCount: d.live_rounds?.length ?? 0,
    live: (d.live_rounds ?? []).some((r) => r.status === "live"),
  }));
}

export async function loadMatchDay(id: number): Promise<MatchDayData | null> {
  const [{ data: day, error: e1 }, { data: rounds, error: e2 }] = await Promise.all([
    supabase.from("live_match_days").select(DAY_SELECT).eq("id", id).maybeSingle<DayRow>(),
    supabase.from("live_rounds").select(ROUND_SELECT).eq("match_day_id", id).order("match_number").overrideTypes<RoundRow[]>(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (!day) return null;

  const ids = (rounds ?? []).map((r) => r.id);
  const [players, holes, scores] = ids.length
    ? await Promise.all([
        supabase.from("live_round_players").select(PLAYER_SELECT).in("round_id", ids).order("position").overrideTypes<PlayerRow[]>(),
        supabase
          .from("live_round_holes")
          .select("round_id, hole, par, stroke_index")
          .in("round_id", ids)
          .order("hole")
          .overrideTypes<{ round_id: number; hole: number; par: number; stroke_index: number | null }[]>(),
        supabase
          .from("live_round_scores")
          .select("round_id, player_id, hole, strokes")
          .in("round_id", ids)
          .overrideTypes<{ round_id: number; player_id: number; hole: number; strokes: number | null }[]>(),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  for (const r of [players, holes, scores]) if (r.error) throw r.error;

  const matches: Match[] = (rounds ?? []).map((row) => {
    const round = toRound(row);
    const ps = (players.data ?? []).filter((p) => p.round_id === row.id).map(toPlayer);
    const card = (holes.data ?? []).filter((h) => h.round_id === row.id).map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index }));
    const sheet = new Map<number, Map<number, number | null>>();
    for (const s of (scores.data ?? []).filter((x) => x.round_id === row.id)) {
      if (!sheet.has(s.player_id)) sheet.set(s.player_id, new Map());
      sheet.get(s.player_id)!.set(s.hole, s.strokes);
    }
    const format = round.matchFormat ?? "matchplay";
    return { round, players: ps, card, scores: sheet, format, state: teamMatchState(format, card, asMatchPlayers(ps), sheet) };
  });

  const final: [number, number] = [0, 0];
  const projected: [number, number] = [0, 0];
  let finishedCount = 0;
  for (const m of matches) {
    // A match counts as over when its card says so (won 3&2 on the 16th),
    // or when its players pressed Finish.
    const done = m.round.status === "finished" || !!m.state?.finished;
    const [a, b] = matchPoints(m.state, true);
    if (done) {
      finishedCount += 1;
      final[0] += a;
      final[1] += b;
    }
    projected[0] += a;
    projected[1] += b;
  }

  return { day: toDay(day), matches, totals: { final, projected, finishedCount } };
}

// ---------------------------------------------------------------------------
// Starting a day
// ---------------------------------------------------------------------------

export type NewMatchPlayer = {
  memberId: string | null;
  name: string;
  handicapIndex: number;
  courseHandicap: number;
  playingHandicap: number;
  estimated: boolean;
  side: 1 | 2;
};

export type NewMatch = {
  format: MatchFormat;
  teeTime: string | null;
  players: NewMatchPlayer[];
};

export type NewMatchDay = {
  title: string;
  courseName: string;
  clubId: number | null;
  teeName: string | null;
  holes: 9 | 18;
  courseRating: number | null;
  slope: number | null;
  parTotal: number | null;
  teamNames: [string, string] | null;
};

const matchType = (f: MatchFormat) => (f === "matchplay" ? "singles" : f);

export async function createMatchDay(day: NewMatchDay, matches: NewMatch[], card: CardHole[]): Promise<number> {
  const { data, error } = await supabase.rpc("live_match_day_create", {
    p_day: {
      title: day.title,
      course_name: day.courseName,
      club_id: day.clubId,
      tee_name: day.teeName,
      holes: day.holes,
      course_rating: day.courseRating,
      slope: day.slope,
      par_total: day.parTotal,
      team_names: day.teamNames,
    },
    p_matches: matches.map((m) => ({
      match_type: matchType(m.format),
      tee_time: m.teeTime,
      players: m.players.map((p) => ({
        member_id: p.memberId,
        name: p.name,
        handicap_index: p.handicapIndex,
        course_handicap: p.courseHandicap,
        playing_handicap: p.playingHandicap,
        handicap_estimated: p.estimated,
        side: p.side,
      })),
    })),
    p_card: card.map((h) => ({ hole: h.hole, par: h.par, stroke_index: h.strokeIndex })),
  });
  if (error) throw error;
  const id = data as number;
  // Every PinPal on the card hears which match they're in. Best effort.
  void postToSite(`/api/app/live/match-days/${id}/notify`, {}).catch(() => undefined);
  return id;
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

/** "Something changed somewhere in this match day": re-fetch the board.
 *  Private channel, authorised by can_view_match_day (0104). */
export function subscribeToMatchDay(dayId: number, onChange: () => void): () => void {
  let channel: RealtimeChannel | null = null;
  let closed = false;
  void (async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) await supabase.realtime.setAuth(token);
    if (closed) return;
    channel = supabase
      .channel(`live-day-${dayId}`, { config: { private: true } })
      .on("broadcast", { event: "changed" }, () => onChange())
      .subscribe();
  })();
  return () => {
    closed = true;
    if (channel) void supabase.removeChannel(channel);
  };
}

/** The little a match's own screen needs to know about its day: whose it is,
 *  what it's called and the team names. Null for an ordinary round. */
export async function loadMatchDayHeader(dayId: number): Promise<Pick<MatchDay, "id" | "createdBy" | "title" | "teamNames"> | null> {
  const { data } = await supabase.from("live_match_days").select(DAY_SELECT).eq("id", dayId).maybeSingle<DayRow>();
  if (!data) return null;
  const d = toDay(data);
  return { id: d.id, createdBy: d.createdBy, title: d.title, teamNames: d.teamNames };
}

/** Team colours: side 1 blue, side 2 gold. Different in lightness as well as
 *  hue, so they read apart for colour-blind players too. */
export const SIDE_COLORS = ["#1e4e8c", "#d3a53f"] as const;
export const SIDE_TEXT = ["#ffffff", "#0e1520"] as const;
