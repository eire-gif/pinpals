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
  type FoursomesScoring,
  teamMatchState,
  type CardHole,
  type MatchFormat,
  type MatchPlayer,
  type ScoreSheet,
  type StartLetter,
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
  /** "scramble": one round per scramble team, one leaderboard (0113).
   *  "fourballs": a society day — one round per tee group, individual
   *  Stableford or stroke play on one leaderboard (0121). */
  kind: DayKind;
  /** A "scramble" day whose teams are foursomes pairs (0136), and how
   *  they're ranked. */
  foursomes: FoursomesScoring | null;
  /** Greensomes pairs (0173), with `foursomes` saying how they're ranked. */
  greensomes: boolean;
};

export type DayKind = "match" | "scramble" | "fourballs";

const asKind = (k: string | null): DayKind => (k === "scramble" || k === "fourballs" ? k : "match");

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
  createdBy: string | null;
  kind: DayKind;
  foursomes: FoursomesScoring | null;
  greensomes: boolean;
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
  kind: string | null;
  foursomes_scoring: FoursomesScoring | null;
  greensomes: boolean | null;
};

const DAY_SELECT = "id, created_by, title, club_id, course_name, tee_name, holes, played_on, team_names, kind, foursomes_scoring, greensomes";

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
  kind: asKind(d.kind),
  foursomes: d.foursomes_scoring ?? null,
  greensomes: !!d.greensomes && d.foursomes_scoring != null,
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
    .select("id, created_by, title, course_name, played_on, kind, foursomes_scoring, greensomes, live_rounds (status)")
    .order("created_at", { ascending: false })
    .limit(20)
    .overrideTypes<{ id: number; created_by: string | null; title: string; course_name: string; played_on: string; kind: string | null; foursomes_scoring: FoursomesScoring | null; greensomes: boolean | null; live_rounds: { status: string }[] }[]>();
  if (error) throw error;
  return (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    courseName: d.course_name,
    playedOn: d.played_on,
    matchCount: d.live_rounds?.length ?? 0,
    live: (d.live_rounds ?? []).some((r) => r.status === "live"),
    createdBy: d.created_by,
    kind: asKind(d.kind),
    foursomes: d.foursomes_scoring ?? null,
    greensomes: !!d.greensomes && d.foursomes_scoring != null,
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
    // A scramble team or a society-day group is not a match: no match state
    // (their boards rank teams and players instead).
    const state = round.scramble || round.format !== "matchplay" ? null : teamMatchState(format, card, asMatchPlayers(ps), sheet);
    return { round, players: ps, card, scores: sheet, format, state };
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
// Starting a scramble day (0113)
// ---------------------------------------------------------------------------

/** Shotgun start (0173): where a group or team starts. */
export type NewStart = { hole: number; letter: StartLetter } | null;

export type NewScrambleTeam = {
  name: string | null;
  teeTime: string | null;
  start?: NewStart;
  teamHandicap: number;
  players: Omit<NewMatchPlayer, "side">[];
};

export async function createScrambleDay(
  day: Omit<NewMatchDay, "teamNames"> & {
    size: 2 | 4;
    driveMinimum: number | null;
    /** A day of foursomes pairs (0136): size 2, no drives. */
    foursomes?: FoursomesScoring;
    /** Greensomes pairs (0173), with `foursomes` for how they're ranked. */
    greensomes?: boolean;
  },
  teams: NewScrambleTeam[],
  card: CardHole[]
): Promise<number> {
  const { data, error } = await supabase.rpc("live_scramble_day_create", {
    p_day: {
      title: day.title,
      course_name: day.courseName,
      club_id: day.clubId,
      tee_name: day.teeName,
      holes: day.holes,
      course_rating: day.courseRating,
      slope: day.slope,
      par_total: day.parTotal,
      scramble_size: day.size,
      drive_minimum: day.foursomes ? null : day.driveMinimum,
      ...(day.foursomes ? { foursomes_scoring: day.foursomes } : {}),
      ...(day.foursomes && day.greensomes ? { greensomes: true } : {}),
    },
    p_teams: teams.map((t) => ({
      name: t.name,
      tee_time: t.teeTime,
      ...(t.start ? { start_hole: t.start.hole, start_letter: t.start.letter } : {}),
      team_handicap: t.teamHandicap,
      players: t.players.map((p) => ({
        member_id: p.memberId,
        name: p.name,
        handicap_index: p.handicapIndex,
        course_handicap: p.courseHandicap,
        playing_handicap: p.playingHandicap,
        handicap_estimated: p.estimated,
      })),
    })),
    p_card: card.map((h) => ({ hole: h.hole, par: h.par, stroke_index: h.strokeIndex })),
  });
  if (error) throw error;
  const id = data as number;
  void postToSite(`/api/app/live/match-days/${id}/notify`, {}).catch(() => undefined);
  return id;
}

// ---------------------------------------------------------------------------
// Starting a society day (0121)
// ---------------------------------------------------------------------------

export type NewTeeGroup = {
  teeTime: string | null;
  start?: NewStart;
  players: Omit<NewMatchPlayer, "side">[];
};

/** One day, a round per tee group, everyone on one individual leaderboard. */
export async function createFourballDay(
  day: Omit<NewMatchDay, "teamNames"> & { format: "stableford" | "stroke"; allowance: number },
  groups: NewTeeGroup[],
  card: CardHole[]
): Promise<number> {
  const { data, error } = await supabase.rpc("live_fourball_day_create", {
    p_day: {
      title: day.title,
      course_name: day.courseName,
      club_id: day.clubId,
      tee_name: day.teeName,
      holes: day.holes,
      course_rating: day.courseRating,
      slope: day.slope,
      par_total: day.parTotal,
      format: day.format,
      allowance: day.allowance,
    },
    p_groups: groups.map((g) => ({
      tee_time: g.teeTime,
      ...(g.start ? { start_hole: g.start.hole, start_letter: g.start.letter } : {}),
      players: g.players.map((p) => ({
        member_id: p.memberId,
        name: p.name,
        handicap_index: p.handicapIndex,
        course_handicap: p.courseHandicap,
        playing_handicap: p.playingHandicap,
        handicap_estimated: p.estimated,
      })),
    })),
    p_card: card.map((h) => ({ hole: h.hole, par: h.par, stroke_index: h.strokeIndex })),
  });
  if (error) throw error;
  const id = data as number;
  void postToSite(`/api/app/live/match-days/${id}/notify`, {}).catch(() => undefined);
  return id;
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

/** Deletes a whole match day and every match in it (0105). Organiser only. */
export async function deleteMatchDay(dayId: number): Promise<void> {
  const { error } = await supabase.rpc("live_match_day_delete", { p_day_id: dayId });
  if (error) throw error;
}

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
