import { postToSite } from "./api";
import type { ScorecardHole, ScorecardMeta } from "./scorecard-math";
import { supabase } from "./supabase";
import { asRoundWeather, type RoundWeather } from "./weather-rules";

/**
 * Scorecards — reads and writes (0110, claude/scorecards.md).
 *
 * Reads go to the tables under RLS (a card is seen by its owner and, by its
 * visibility, their PinPals or every member). Writes go through
 * scorecard_save / scorecard_from_live_round; deleting is a plain delete,
 * which RLS allows only on your own card.
 */

export type Visibility = "private" | "pinpals" | "members";

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: "Only me",
  pinpals: "My PinPals",
  members: "All members",
};

export type Scorecard = ScorecardMeta & {
  id: number;
  memberId: string;
  clubId: number | null;
  parTotal: number | null;
  courseRating: number | null;
  slope: number | null;
  source: "live" | "manual";
  liveRoundId: number | null;
  visibility: Visibility;
  holeList: ScorecardHole[];
  /** A pair's or team's card (0138): one ball, the side's handicap; never
   *  used for the handicap indicator. */
  teamCard: "foursomes" | "greensomes" | "scramble" | null;
  /** What the round was played in (0182); null until looked up, or none. */
  weather: RoundWeather | null;
};

type Row = {
  id: number;
  member_id: string;
  club_id: number | null;
  course_name: string;
  tee_name: string | null;
  holes: number;
  played_on: string;
  par_total: number | null;
  course_rating: number | string | null;
  slope: number | null;
  handicap_index: number | string | null;
  playing_handicap: number | null;
  source: "live" | "manual";
  live_round_id: number | null;
  visibility: Visibility;
  team_card: "foursomes" | "greensomes" | "scramble" | null;
  weather?: unknown;
  scorecard_holes: { hole: number; par: number; stroke_index: number | null; yards: number | null; strokes: number | null; putts: number | null }[];
};

const BASE_SELECT =
  "id, member_id, club_id, course_name, tee_name, holes, played_on, par_total, course_rating, slope, handicap_index, playing_handicap, source, live_round_id, visibility, team_card, scorecard_holes (hole, par, stroke_index, yards, strokes, putts)";
// 0182's weather; a database without it still loads the cards.
const SELECT = `${BASE_SELECT}, weather`;
const missingWeather = (e: { message?: string } | null) => !!e?.message && /weather/.test(e.message);

const toScorecard = (r: Row): Scorecard => ({
  id: r.id,
  memberId: r.member_id,
  clubId: r.club_id,
  courseName: r.course_name,
  teeName: r.tee_name,
  holes: r.holes === 9 ? 9 : 18,
  playedOn: r.played_on,
  parTotal: r.par_total,
  // numeric columns with a scale arrive as strings.
  courseRating: r.course_rating == null ? null : Number(r.course_rating),
  slope: r.slope,
  handicapIndex: r.handicap_index == null ? null : Number(r.handicap_index),
  playingHandicap: r.playing_handicap,
  source: r.source,
  liveRoundId: r.live_round_id,
  visibility: r.visibility,
  teamCard: r.team_card ?? null,
  weather: asRoundWeather(r.weather),
  holeList: [...r.scorecard_holes]
    .sort((a, b) => a.hole - b.hole)
    .map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index, yards: h.yards, strokes: h.strokes, putts: h.putts })),
});

/** A member's cards that the viewer may see, newest round first. */
export async function listScorecards(memberId: string, limit = 50): Promise<Scorecard[]> {
  const query = (select: string) =>
    supabase
      .from("scorecards")
      .select(select)
      .eq("member_id", memberId)
      .order("played_on", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit)
      .overrideTypes<Row[]>();
  let { data, error } = await query(SELECT);
  if (missingWeather(error)) ({ data, error } = await query(BASE_SELECT));
  if (error) throw error;
  return (data ?? []).map(toScorecard);
}

export async function loadScorecard(id: number): Promise<Scorecard | null> {
  const query = (select: string) => supabase.from("scorecards").select(select).eq("id", id).maybeSingle<Row>();
  let { data, error } = await query(SELECT);
  if (missingWeather(error)) ({ data, error } = await query(BASE_SELECT));
  if (error) throw error;
  return data ? toScorecard(data) : null;
}

export type ScorecardInput = {
  clubId: number | null;
  courseName: string;
  teeName: string | null;
  holes: 9 | 18;
  playedOn: string;
  parTotal: number | null;
  courseRating: number | null;
  slope: number | null;
  handicapIndex: number | null;
  playingHandicap: number | null;
  visibility: Visibility;
};

/** New card (id null) or an edit of your own. Returns its id. */
export async function saveScorecard(id: number | null, card: ScorecardInput, holes: ScorecardHole[]): Promise<number> {
  const { data, error } = await supabase.rpc("scorecard_save", {
    p_id: id,
    p_card: {
      club_id: card.clubId,
      course_name: card.courseName,
      tee_name: card.teeName,
      holes: card.holes,
      played_on: card.playedOn,
      par_total: card.parTotal,
      course_rating: card.courseRating,
      slope: card.slope,
      handicap_index: card.handicapIndex,
      playing_handicap: card.playingHandicap,
      visibility: card.visibility,
    },
    p_holes: holes.map((h) => ({
      hole: h.hole,
      par: h.par,
      stroke_index: h.strokeIndex,
      yards: h.yards,
      strokes: h.strokes,
      putts: h.putts,
    })),
  });
  if (error) throw error;
  return Number(data);
}

export const toInput = (s: Scorecard): ScorecardInput => ({
  clubId: s.clubId,
  courseName: s.courseName,
  teeName: s.teeName,
  holes: s.holes,
  playedOn: s.playedOn,
  parTotal: s.parTotal,
  courseRating: s.courseRating,
  slope: s.slope,
  handicapIndex: s.handicapIndex,
  playingHandicap: s.playingHandicap,
  visibility: s.visibility,
});

/** Your own line of a live round as a scorecard (again = refresh). */
export async function scorecardFromLiveRound(roundId: number): Promise<number> {
  const { data, error } = await supabase.rpc("scorecard_from_live_round", { p_round_id: roundId });
  if (error) throw error;
  return Number(data);
}

export async function deleteScorecard(id: number): Promise<void> {
  const { error } = await supabase.from("scorecards").delete().eq("id", id);
  if (error) throw error;
}

/** A public link for a card of yours: the page to send, and its preview image. */
export const createScorecardShareLink = (id: number): Promise<{ url: string; imageUrl: string }> =>
  postToSite(`/api/app/scorecards/${id}/share`, {});

// ---------------------------------------------------------------------------
// Course cards with yards, for starting a card from a course
// ---------------------------------------------------------------------------

export type TeeCard = {
  teeName: string;
  holes: 9 | 18;
  parTotal: number | null;
  courseRating: number | null;
  slope: number | null;
  verified: boolean;
  holeList: ScorecardHole[];
};

export async function loadTeeCards(clubId: number): Promise<TeeCard[]> {
  // One club per call, through 0149's function: the tables themselves are
  // closed (0150, golfapi terms — no copying the whole set out).
  const { data, error } = await supabase.rpc("course_cards_for_club", { p_club_id: clubId });
  if (error) throw error;
  return ((data ?? []) as ClubCardRow[]).map((c) => ({
    teeName: c.tee_name,
    holes: c.holes === 9 ? 9 : 18,
    parTotal: c.par_total,
    courseRating: c.course_rating == null ? null : Number(c.course_rating),
    slope: c.slope,
    verified: c.verified_at != null,
    holeList: [...c.course_card_holes]
      .sort((a, b) => a.hole - b.hole)
      .map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index, yards: h.yards ?? null, strokes: null, putts: null })),
  }));
}

/** A card as course_cards_for_club (0149) returns it. */
export type ClubCardRow = {
  id: number;
  tee_name: string;
  holes: number;
  par_total: number | null;
  course_rating: number | string | null;
  slope: number | null;
  verified_at: string | null;
  course_card_holes: { hole: number; par: number; stroke_index: number; yards: number | null }[];
};

// ---------------------------------------------------------------------------
// The handicap indicator (0122): your own, from your last 20 scorecards
// ---------------------------------------------------------------------------

export type HandicapIndicator = {
  /** Null with fewer than three eligible cards. */
  indicator: number | null;
  /** Eligible cards found (at most 20). */
  rounds: number;
  /** How many of them make the indicator. */
  counting: number;
};

export type IndicatorCard = {
  scorecardId: number;
  playedOn: string;
  courseName: string;
  teeName: string | null;
  adjustedGross: number;
  differential: number;
  /** One of the best N that make the indicator. */
  counts: boolean;
};

export async function loadMyHandicapIndicator(): Promise<HandicapIndicator> {
  const { data, error } = await supabase.rpc("my_handicap_indicator");
  if (error) throw new Error(error.message || "Couldn't work out your indicator.");
  const row = (data as { indicator: number | null; rounds: number | null; counting: number | null }[] | null)?.[0];
  return {
    indicator: row?.indicator != null ? Number(row.indicator) : null,
    rounds: row?.rounds ?? 0,
    counting: row?.counting ?? 0,
  };
}

/** The cards behind it, newest first. */
export async function loadMyIndicatorCards(): Promise<IndicatorCard[]> {
  const { data, error } = await supabase.rpc("my_handicap_differentials");
  if (error) throw new Error(error.message || "Couldn't load the cards.");
  return (
    (data ?? []) as {
      scorecard_id: number;
      played_on: string;
      course_name: string;
      tee_name: string | null;
      adjusted_gross: number;
      differential: number;
      counts: boolean;
    }[]
  ).map((r) => ({
    scorecardId: r.scorecard_id,
    playedOn: r.played_on,
    courseName: r.course_name,
    teeName: r.tee_name,
    adjustedGross: r.adjusted_gross,
    differential: Number(r.differential),
    counts: r.counts,
  }));
}
