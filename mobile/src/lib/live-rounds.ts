import type { RealtimeChannel } from "@supabase/supabase-js";

import type { CardHole, LiveFormat, LivePlayer, ScoreSheet } from "./live-scoring";
import { supabase } from "./supabase";

/**
 * Live scoring — reads, writes and the live channel (Oct 2026).
 *
 * Reads go straight to the tables under RLS (0103: only the people in a
 * round can see it). Writes go through the live_round_* functions, which
 * check the caller is in the round; the tables take no direct writes.
 *
 * Nothing scored is computed here. Points, positions and match status come
 * from live-scoring.ts on every render, from the rows loaded here.
 */

export type LiveRoundSummary = {
  id: number;
  courseName: string;
  format: LiveFormat;
  status: "live" | "finished";
  playedOn: string;
  playerCount: number;
};

export type LiveRound = {
  id: number;
  createdBy: string | null;
  clubId: number | null;
  courseName: string;
  teeName: string | null;
  format: LiveFormat;
  holes: 9 | 18;
  courseRating: number | null;
  slope: number | null;
  parTotal: number | null;
  allowance: number;
  status: "live" | "finished";
  playedOn: string;
};

export type LiveRoundPlayer = LivePlayer & {
  memberId: string | null;
  handicapIndex: number;
  courseHandicap: number;
  estimated: boolean;
  position: number;
};

export type LiveRoundData = {
  round: LiveRound;
  players: LiveRoundPlayer[];
  card: CardHole[];
  scores: ScoreSheet;
};

type RoundRow = {
  id: number;
  created_by: string | null;
  club_id: number | null;
  course_name: string;
  tee_name: string | null;
  format: LiveFormat;
  holes: number;
  course_rating: number | null;
  slope: number | null;
  par_total: number | null;
  allowance: number;
  status: "live" | "finished";
  played_on: string;
};

type PlayerRow = {
  id: number;
  member_id: string | null;
  display_name: string;
  handicap_index: number;
  course_handicap: number;
  playing_handicap: number;
  handicap_estimated: boolean;
  position: number;
  side: number | null;
};

const ROUND_SELECT =
  "id, created_by, club_id, course_name, tee_name, format, holes, course_rating, slope, par_total, allowance, status, played_on";

const toRound = (r: RoundRow): LiveRound => ({
  id: r.id,
  createdBy: r.created_by,
  clubId: r.club_id,
  courseName: r.course_name,
  teeName: r.tee_name,
  format: r.format,
  holes: r.holes === 9 ? 9 : 18,
  // numeric columns arrive as strings from PostgREST when they carry a scale.
  courseRating: r.course_rating == null ? null : Number(r.course_rating),
  slope: r.slope,
  parTotal: r.par_total,
  allowance: Number(r.allowance),
  status: r.status,
  playedOn: r.played_on,
});

/** The rounds I started or am playing in, live ones first. */
export async function loadMyLiveRounds(userId: string): Promise<LiveRoundSummary[]> {
  // RLS already limits this to rounds I can see; the member filter keeps a
  // round someone else started, with me in it, on the list too.
  const { data: mine } = await supabase
    .from("live_round_players")
    .select("round_id")
    .eq("member_id", userId)
    .overrideTypes<{ round_id: number }[]>();
  const ids = [...new Set((mine ?? []).map((r) => r.round_id))];

  let query = supabase
    .from("live_rounds")
    .select(`id, course_name, format, status, played_on, created_at, live_round_players (count)`)
    .order("created_at", { ascending: false })
    .limit(30);
  query = ids.length > 0 ? query.or(`created_by.eq.${userId},id.in.(${ids.join(",")})`) : query.eq("created_by", userId);

  const { data, error } = await query.overrideTypes<
    {
      id: number;
      course_name: string;
      format: LiveFormat;
      status: "live" | "finished";
      played_on: string;
      live_round_players: { count: number }[];
    }[]
  >();
  if (error) throw error;

  return (data ?? [])
    .map((r) => ({
      id: r.id,
      courseName: r.course_name,
      format: r.format,
      status: r.status,
      playedOn: r.played_on,
      playerCount: r.live_round_players?.[0]?.count ?? 0,
    }))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "live" ? -1 : 1));
}

/** Everything a scoring screen draws, in four parallel reads. Null if the
 *  round doesn't exist or isn't mine to see — RLS makes those the same. */
export async function loadLiveRound(id: number): Promise<LiveRoundData | null> {
  const [round, players, holes, scores] = await Promise.all([
    supabase.from("live_rounds").select(ROUND_SELECT).eq("id", id).maybeSingle<RoundRow>(),
    supabase
      .from("live_round_players")
      .select("id, member_id, display_name, handicap_index, course_handicap, playing_handicap, handicap_estimated, position, side")
      .eq("round_id", id)
      .order("position")
      .overrideTypes<PlayerRow[]>(),
    supabase
      .from("live_round_holes")
      .select("hole, par, stroke_index")
      .eq("round_id", id)
      .order("hole")
      .overrideTypes<{ hole: number; par: number; stroke_index: number | null }[]>(),
    supabase
      .from("live_round_scores")
      .select("player_id, hole, strokes")
      .eq("round_id", id)
      .overrideTypes<{ player_id: number; hole: number; strokes: number | null }[]>(),
  ]);

  for (const r of [round, players, holes, scores]) if (r.error) throw r.error;
  if (!round.data) return null;

  const sheet = new Map<number, Map<number, number | null>>();
  for (const s of scores.data ?? []) {
    if (!sheet.has(s.player_id)) sheet.set(s.player_id, new Map());
    sheet.get(s.player_id)!.set(s.hole, s.strokes);
  }

  return {
    round: toRound(round.data),
    players: (players.data ?? []).map((p) => ({
      id: p.id,
      name: p.display_name,
      memberId: p.member_id,
      handicapIndex: Number(p.handicap_index),
      courseHandicap: p.course_handicap,
      playingHandicap: p.playing_handicap,
      estimated: p.handicap_estimated,
      position: p.position,
      side: p.side,
    })),
    card: (holes.data ?? []).map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index })),
    scores: sheet,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type NewPlayer = {
  memberId: string | null;
  name: string;
  handicapIndex: number;
  courseHandicap: number;
  playingHandicap: number;
  estimated: boolean;
};

export type NewRound = {
  courseName: string;
  clubId: number | null;
  teeName: string | null;
  format: LiveFormat;
  holes: 9 | 18;
  courseRating: number | null;
  slope: number | null;
  parTotal: number | null;
  allowance: number;
};

export async function createLiveRound(round: NewRound, players: NewPlayer[], card: CardHole[]): Promise<number> {
  const { data, error } = await supabase.rpc("live_round_create", {
    p_round: {
      course_name: round.courseName,
      club_id: round.clubId,
      tee_name: round.teeName,
      format: round.format,
      holes: round.holes,
      course_rating: round.courseRating,
      slope: round.slope,
      par_total: round.parTotal,
      allowance: round.allowance,
    },
    p_players: players.map((p) => ({
      member_id: p.memberId,
      name: p.name,
      handicap_index: p.handicapIndex,
      course_handicap: p.courseHandicap,
      playing_handicap: p.playingHandicap,
      handicap_estimated: p.estimated,
    })),
    p_card: card.map((h) => ({ hole: h.hole, par: h.par, stroke_index: h.strokeIndex })),
  });
  if (error) throw error;
  return data as number;
}

/** strokes null = picked up; clear removes the entry altogether. */
export async function setLiveScore(roundId: number, playerId: number, hole: number, strokes: number | null, clear = false): Promise<void> {
  const { error } = await supabase.rpc("live_round_set_score", {
    p_round_id: roundId,
    p_player_id: playerId,
    p_hole: hole,
    p_strokes: strokes,
    p_clear: clear,
  });
  if (error) throw error;
}

export async function setLiveHole(roundId: number, hole: number, par: number, strokeIndex: number | null): Promise<void> {
  const { error } = await supabase.rpc("live_round_set_hole", {
    p_round_id: roundId,
    p_hole: hole,
    p_par: par,
    p_stroke_index: strokeIndex,
  });
  if (error) throw error;
}

export async function finishLiveRound(roundId: number): Promise<void> {
  const { error } = await supabase.rpc("live_round_finish", { p_round_id: roundId });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Course cards
// ---------------------------------------------------------------------------

export type CourseCard = {
  id: number;
  teeName: string;
  holes: 9 | 18;
  parTotal: number | null;
  courseRating: number | null;
  slope: number | null;
  verified: boolean;
  card: CardHole[];
};

/** Every card on file for a club, each tee once. */
export async function loadCourseCards(clubId: number): Promise<CourseCard[]> {
  const { data, error } = await supabase
    .from("course_cards")
    .select("id, tee_name, holes, par_total, course_rating, slope, verified_at, course_card_holes (hole, par, stroke_index)")
    .eq("club_id", clubId)
    .order("tee_name")
    .overrideTypes<
      {
        id: number;
        tee_name: string;
        holes: number;
        par_total: number | null;
        course_rating: number | null;
        slope: number | null;
        verified_at: string | null;
        course_card_holes: { hole: number; par: number; stroke_index: number }[];
      }[]
    >();
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    teeName: c.tee_name,
    holes: c.holes === 9 ? 9 : 18,
    parTotal: c.par_total,
    courseRating: c.course_rating == null ? null : Number(c.course_rating),
    slope: c.slope,
    verified: c.verified_at != null,
    card: [...c.course_card_holes]
      .sort((a, b) => a.hole - b.hole)
      .map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index })),
  }));
}

/** Saves a round's card for its course, so the next round there starts filled in. */
export async function saveCourseCard(round: LiveRound, card: CardHole[]): Promise<void> {
  if (round.clubId == null) throw new Error("This round isn't linked to a course in the directory");
  const { error } = await supabase.rpc("course_card_save", {
    p_club_id: round.clubId,
    p_tee_name: round.teeName ?? "Standard",
    p_holes: round.holes,
    p_par_total: card.reduce((n, h) => n + h.par, 0),
    p_course_rating: round.courseRating,
    p_slope: round.slope,
    p_card: card.map((h) => ({ hole: h.hole, par: h.par, stroke_index: h.strokeIndex })),
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

/**
 * "Something changed in round <id>" — re-fetch, never render the payload.
 * The channel is private: Realtime checks can_view_live_round (0103) before
 * it sends anything. If it never fires, the screen still refreshes on focus
 * and after every write of its own, so nothing is lost but immediacy.
 */
export function subscribeToLiveRound(roundId: number, onChange: () => void): () => void {
  let channel: RealtimeChannel | null = null;
  let closed = false;
  void (async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) await supabase.realtime.setAuth(token);
    if (closed) return;
    channel = supabase
      .channel(`live-round-${roundId}`, { config: { private: true } })
      .on("broadcast", { event: "changed" }, () => onChange())
      .subscribe();
  })();
  return () => {
    closed = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
