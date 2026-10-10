import { scorecardTotals, type ScorecardHole } from "./scorecard-math";

/**
 * A member's numbers across their scorecards (Oct 2026), for the top of
 * My scorecards. Pure, so it's tested.
 *
 * "Rounds" are finished cards; a card still being filled in counts towards
 * birdies and pars (they happened) but not towards best or average (a
 * half-played round is not a score). Best and average are full eighteens,
 * because those are the numbers golfers compare.
 */
export type StatCard = {
  id: number;
  courseName: string;
  playedOn: string;
  holes: 9 | 18;
  playingHandicap: number | null;
  holeList: ScorecardHole[];
};

export type ScorecardStats = {
  cards: number;
  rounds: number;
  best: { id: number; strokes: number; vsPar: number | null; courseName: string; playedOn: string } | null;
  average: number | null;
  /** Best Stableford score on a finished card with a handicap. */
  bestPoints: { id: number; points: number; courseName: string } | null;
  holesPlayed: number;
  eagles: number;
  birdies: number;
  pars: number;
  /** Share of holes played at par or better, 0–100. */
  parOrBetterPct: number | null;
  /** Average putts on finished cards with every putt entered. */
  puttsPerRound: number | null;
};

export function scorecardStats(cards: readonly StatCard[]): ScorecardStats {
  let rounds = 0;
  let holesPlayed = 0;
  let eagles = 0;
  let birdies = 0;
  let pars = 0;
  let best: ScorecardStats["best"] = null;
  let bestPoints: ScorecardStats["bestPoints"] = null;
  const eighteens: number[] = [];
  const putts: number[] = [];

  for (const c of cards) {
    const t = scorecardTotals(c.holeList, c.playingHandicap);
    holesPlayed += t.played;
    eagles += t.counts.eagle + t.counts.albatross;
    birdies += t.counts.birdie;
    pars += t.counts.par;
    if (!t.complete || t.total.strokes == null) continue;
    rounds += 1;
    if (c.holeList.every((h) => h.putts != null) && t.total.putts != null) putts.push(t.total.putts);
    if (t.points != null && (!bestPoints || t.points > bestPoints.points)) bestPoints = { id: c.id, points: t.points, courseName: c.courseName };
    if (c.holes !== 18) continue;
    eighteens.push(t.total.strokes);
    if (!best || t.total.strokes < best.strokes) {
      best = { id: c.id, strokes: t.total.strokes, vsPar: t.vsPar, courseName: c.courseName, playedOn: c.playedOn };
    }
  }

  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return {
    cards: cards.length,
    rounds,
    best,
    average: eighteens.length >= 2 ? avg(eighteens) : null,
    bestPoints,
    holesPlayed,
    eagles,
    birdies,
    pars,
    parOrBetterPct: holesPlayed > 0 ? Math.round(((eagles + birdies + pars) / holesPlayed) * 100) : null,
    puttsPerRound: avg(putts),
  };
}
