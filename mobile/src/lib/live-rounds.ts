import type { RealtimeChannel } from "@supabase/supabase-js";

import { postToSite } from "./api";
import type { CardHole, FoursomesScoring, LiveFormat, LivePlayer, MatchFormat, ScoreSheet, ScrambleSize, StartLetter } from "./live-scoring";
import type { ClubCardRow } from "./scorecards";
import { signalMyRound } from "./my-round-signal";
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
  createdBy: string | null;
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
  /** Set when this round is a match in a match day (0104). */
  matchDayId: number | null;
  matchNumber: number | null;
  /** The match's format for the engine: "matchplay" is singles. */
  matchFormat: MatchFormat | null;
  teeTime: string | null;
  /** Shotgun start (0173): the hole this group starts on, and A/B. Null = from the 1st. */
  start: { hole: number; letter: StartLetter | null } | null;
  /** Set when this round is one scramble team (0113). */
  scramble: ScrambleInfo | null;
};

export type ScrambleInfo = {
  size: ScrambleSize;
  teamName: string | null;
  teamNumber: number | null;
  /** The team's playing handicap (WHS allowances, summed then rounded). */
  teamHandicap: number;
  driveMinimum: number | null;
  /** Set when the team is a foursomes (Scotch foursomes) pair, 0136: how
   *  it's ranked. The round's format is then this too, not "scramble". */
  foursomes: FoursomesScoring | null;
  /** A greensomes pair (0173): both drive, play the better one. Only with `foursomes`. */
  greensomes: boolean;
};

export type LiveRoundPlayer = LivePlayer & {
  memberId: string | null;
  handicapIndex: number;
  courseHandicap: number;
  estimated: boolean;
  position: number;
  /** Mixed tees (0176): their own tees, when not the round's; null otherwise. */
  teeName: string | null;
  /** Mixed tees (0176): shots for the difference in par, already in playingHandicap. */
  teeExtra: number;
};

export type LiveRoundData = {
  round: LiveRound;
  players: LiveRoundPlayer[];
  card: CardHole[];
  scores: ScoreSheet;
  /** Scramble: hole → position of the player whose drive was used. */
  drives: Map<number, number>;
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
  match_day_id: number | null;
  match_number: number | null;
  match_type: "singles" | "fourball" | "foursomes" | "greensomes" | null;
  tee_time: string | null;
  scramble_size: number | null;
  team_name: string | null;
  team_number: number | null;
  team_handicap: number | null;
  drive_minimum: number | null;
  foursomes_scoring: FoursomesScoring | null;
  greensomes: boolean | null;
  start_hole: number | null;
  start_letter: StartLetter | null;
};

type PlayerRow = {
  id: number;
  round_id: number;
  member_id: string | null;
  display_name: string;
  handicap_index: number;
  course_handicap: number;
  playing_handicap: number;
  handicap_estimated: boolean;
  position: number;
  side: number | null;
  tee_name?: string | null;
  tee_extra?: number | null;
};

export const ROUND_SELECT =
  "id, created_by, club_id, course_name, tee_name, format, holes, course_rating, slope, par_total, allowance, status, played_on, match_day_id, match_number, match_type, tee_time, scramble_size, team_name, team_number, team_handicap, drive_minimum, foursomes_scoring, greensomes, start_hole, start_letter";

export const toMatchFormat = (t: RoundRow["match_type"]): MatchFormat | null =>
  t == null ? null : t === "singles" ? "matchplay" : t;

export const toRound = (r: RoundRow): LiveRound => ({
  id: r.id,
  createdBy: r.created_by,
  clubId: r.club_id,
  courseName: r.course_name,
  teeName: r.tee_name,
  // A scramble team is stored as stroke play (0113); the app knows it apart.
  // A foursomes pair (0136) is stored the same way and scored by its own
  // Stableford or stroke play.
  format: r.scramble_size != null ? (r.foursomes_scoring ?? "scramble") : r.format,
  holes: r.holes === 9 ? 9 : 18,
  // numeric columns arrive as strings from PostgREST when they carry a scale.
  courseRating: r.course_rating == null ? null : Number(r.course_rating),
  slope: r.slope,
  parTotal: r.par_total,
  allowance: Number(r.allowance),
  status: r.status,
  playedOn: r.played_on,
  matchDayId: r.match_day_id,
  matchNumber: r.match_number,
  matchFormat: toMatchFormat(r.match_type) ?? (r.format === "matchplay" ? "matchplay" : null),
  teeTime: r.tee_time ? r.tee_time.slice(0, 5) : null,
  start: r.start_hole != null ? { hole: r.start_hole, letter: r.start_letter ?? null } : null,
  scramble:
    r.scramble_size != null
      ? {
          size: r.scramble_size === 2 ? 2 : 4,
          teamName: r.team_name,
          teamNumber: r.team_number,
          teamHandicap: r.team_handicap ?? 0,
          driveMinimum: r.drive_minimum,
          foursomes: r.foursomes_scoring ?? null,
          greensomes: !!r.greensomes && r.foursomes_scoring != null,
        }
      : null,
});

export type { RoundRow };

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
    .select(`id, created_by, course_name, format, scramble_size, foursomes_scoring, status, played_on, created_at, live_round_players (count)`)
    .is("match_day_id", null) // matches are listed under their match day
    .order("created_at", { ascending: false })
    .limit(30);
  query = ids.length > 0 ? query.or(`created_by.eq.${userId},id.in.(${ids.join(",")})`) : query.eq("created_by", userId);

  const { data, error } = await query.overrideTypes<
    {
      id: number;
      created_by: string | null;
      course_name: string;
      format: LiveFormat;
      scramble_size: number | null;
      foursomes_scoring: FoursomesScoring | null;
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
      format: r.foursomes_scoring ? ("foursomes" as const) : r.scramble_size != null ? ("scramble" as const) : r.format,
      status: r.status,
      playedOn: r.played_on,
      playerCount: r.live_round_players?.[0]?.count ?? 0,
      createdBy: r.created_by,
    }))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "live" ? -1 : 1));
}

/** Everything a scoring screen draws, in four parallel reads. Null if the
 *  round doesn't exist or isn't mine to see — RLS makes those the same. */
export const PLAYER_SELECT =
  "id, round_id, member_id, display_name, handicap_index, course_handicap, playing_handicap, handicap_estimated, position, side, tee_name, tee_extra";

export const toPlayer = (p: PlayerRow): LiveRoundPlayer => ({
  id: p.id,
  name: p.display_name,
  memberId: p.member_id,
  handicapIndex: Number(p.handicap_index),
  courseHandicap: p.course_handicap,
  playingHandicap: p.playing_handicap,
  estimated: p.handicap_estimated,
  position: p.position,
  side: p.side,
  teeName: p.tee_name ?? null,
  teeExtra: p.tee_extra ?? 0,
});

export type { PlayerRow };

export async function loadLiveRound(id: number): Promise<LiveRoundData | null> {
  const [round, players, holes, scores, drives] = await Promise.all([
    supabase.from("live_rounds").select(ROUND_SELECT).eq("id", id).maybeSingle<RoundRow>(),
    supabase
      .from("live_round_players")
      .select(PLAYER_SELECT)
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
    supabase
      .from("live_round_drives")
      .select("hole, position")
      .eq("round_id", id)
      .overrideTypes<{ hole: number; position: number }[]>(),
  ]);

  for (const r of [round, players, holes, scores]) if (r.error) throw r.error;
  // Drives are a nicety: an older database without the table (before 0113
  // reaches it) must not stop the round loading.
  if (!round.data) return null;

  const sheet = new Map<number, Map<number, number | null>>();
  for (const s of scores.data ?? []) {
    if (!sheet.has(s.player_id)) sheet.set(s.player_id, new Map());
    sheet.get(s.player_id)!.set(s.hole, s.strokes);
  }

  return {
    round: toRound(round.data),
    players: (players.data ?? []).map(toPlayer),
    card: (holes.data ?? []).map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index })),
    scores: sheet,
    drives: new Map((drives.error ? [] : (drives.data ?? [])).map((d) => [d.hole, d.position])),
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
  /** A scramble team (0113). */
  scramble?: { size: ScrambleSize; teamName: string | null; teamHandicap: number; driveMinimum: number | null };
  /** A foursomes pair (0136): format "foursomes", two players. */
  foursomes?: { scoring: FoursomesScoring; teamName: string | null; teamHandicap: number };
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
      ...(round.scramble
        ? {
            scramble_size: round.scramble.size,
            team_name: round.scramble.teamName,
            team_handicap: round.scramble.teamHandicap,
            drive_minimum: round.scramble.driveMinimum,
          }
        : {}),
      ...(round.foursomes
        ? {
            scoring: round.foursomes.scoring,
            team_name: round.foursomes.teamName,
            team_handicap: round.foursomes.teamHandicap,
          }
        : {}),
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
  const id = data as number;
  signalMyRound(); // the MY ROUND pill appears
  // Tell the PinPals in it. Best effort: the round exists either way.
  void postToSite(`/api/app/live/rounds/${id}/notify`, {}).catch(() => undefined);
  return id;
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
  // The MY ROUND pill shows the hole in play; a new score can move it on.
  signalMyRound(15_000);
}

/**
 * A birdie or better just went in (Oct 2026): after a short pause — so a
 * mis-tap corrected straight away never alerts anyone — ask the website to
 * tell everyone in the game. It re-reads the score itself and sends only to
 * the PinPals app (Inbox + phone push), never email.
 */
const HIGHLIGHT_DELAY_MS = 12_000;
const pendingHighlights = new Map<string, ReturnType<typeof setTimeout>>();

export function queueHighlight(roundId: number, playerId: number, hole: number, strokes: number | null, par: number): void {
  const key = `${roundId}:${playerId}:${hole}`;
  const existing = pendingHighlights.get(key);
  if (existing) clearTimeout(existing);
  pendingHighlights.delete(key);
  const great = strokes != null && strokes >= 1 && (strokes === 1 || strokes < par);
  if (!great) return;
  pendingHighlights.set(
    key,
    setTimeout(() => {
      pendingHighlights.delete(key);
      void postToSite(`/api/app/live/rounds/${roundId}/highlight`, { playerId, hole }).catch(() => undefined);
    }, HIGHLIGHT_DELAY_MS)
  );
}

/** "Match notifications" (0119): are birdie alerts on for me in this game?
 *  One switch per round, or per match day / scramble for a day's matches. */
export async function loadHighlightAlertsOn(roundId: number, matchDayId: number | null): Promise<boolean> {
  const key = matchDayId != null ? `day:${matchDayId}` : `round:${roundId}`;
  const { data } = await supabase.from("live_highlight_mutes").select("muted").eq("game_key", key).maybeSingle<{ muted: boolean }>();
  return !data?.muted;
}

export async function setHighlightAlertsOn(roundId: number, on: boolean): Promise<void> {
  const { error } = await supabase.rpc("live_highlight_set_muted", { p_round_id: roundId, p_muted: !on });
  if (error) throw error;
}

/** Scramble: whose drive the team used on a hole. Null clears it. */
export async function setLiveDrive(roundId: number, hole: number, position: number | null): Promise<void> {
  const { error } = await supabase.rpc("live_round_set_drive", { p_round_id: roundId, p_hole: hole, p_position: position });
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
  signalMyRound(); // the MY ROUND pill goes
  // A match in a match day: everyone in the day hears the result. The site
  // sends nothing for an ordinary round. Best effort.
  void postToSite(`/api/app/live/rounds/${roundId}/finished`, {}).catch(() => undefined);
}

/** Deletes a round, live or finished, with its card and scores (0105).
 *  Only whoever started it — or its match day's organiser — may. */
export async function deleteLiveRound(roundId: number): Promise<void> {
  const { error } = await supabase.rpc("live_round_delete", { p_round_id: roundId });
  if (error) throw error;
  signalMyRound();
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
  // One club per call (0149); the tables are closed to members (0150).
  const { data, error } = await supabase.rpc("course_cards_for_club", { p_club_id: clubId });
  if (error) throw error;
  return ((data ?? []) as ClubCardRow[]).map((c) => ({
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
