/**
 * Live scoring — the arithmetic (Oct 2026).
 *
 * Pure, no imports, and byte-identical in mobile/src/lib/live-scoring.ts:
 * live-scoring.test.ts fails if the two copies drift. The app scores the
 * round; the website will draw the shared leaderboard link from the same
 * numbers, and two implementations of "who gets a shot on the 7th" would
 * disagree the first time a plus handicapper played.
 *
 * WHAT A MEMBER ENTERS: their handicap index, once. Everything else is
 * worked out here from the card of the course they're playing:
 *
 *   course handicap  = index × slope ÷ 113 + (course rating − par)   (WHS)
 *   playing handicap = course handicap × the format's allowance
 *   shots on a hole  = handed out by stroke index, hardest hole first
 *
 * When a course has no rating or slope on file the course handicap falls
 * back to the index itself (slope 113, rating = par) and the result says
 * so (`estimated`), so a screen can label it rather than pretend.
 *
 * Shots are allocated by RANK of stroke index among the holes actually
 * played, not by the stroke index number. On 18 holes that is the same
 * thing; on 9 it means a 9-hole card numbered 1, 3, 5… still hands out
 * shots correctly without a separate rule.
 */

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

export type LiveFormat = "stableford" | "stroke" | "matchplay" | "fourball" | "foursomes" | "scramble";

export type FormatInfo = {
  id: LiveFormat;
  label: string;
  /** One line under the label on the format picker. */
  blurb: string;
  /** Share of the course handicap that is played off (WHS recommendations). */
  allowance: number;
  /** Scored by this file today. The others are listed, and shown as
   *  "coming soon", so the picker reads as the whole plan. */
  available: boolean;
};

export const LIVE_FORMATS: readonly FormatInfo[] = [
  { id: "stableford", label: "Stableford", blurb: "Points per hole", allowance: 0.95, available: true },
  { id: "stroke", label: "Stroke play", blurb: "Gross and net", allowance: 0.95, available: true },
  { id: "matchplay", label: "Matchplay", blurb: "Singles, hole by hole", allowance: 1, available: true },
  { id: "fourball", label: "Fourball", blurb: "Better-ball pairs", allowance: 0.85, available: false },
  { id: "foursomes", label: "Foursomes", blurb: "Scotch, alternate shot", allowance: 0.5, available: false },
  { id: "scramble", label: "Scramble", blurb: "Texas, 2 or 4", allowance: 0.25, available: false },
];

export function formatInfo(id: LiveFormat): FormatInfo {
  return LIVE_FORMATS.find((f) => f.id === id) ?? LIVE_FORMATS[0];
}

// ---------------------------------------------------------------------------
// Handicaps
// ---------------------------------------------------------------------------

export const MIN_INDEX = -10;
export const MAX_INDEX = 54;

/** WHS rounds to the nearest whole number, halves up. */
const roundHalfUp = (n: number): number => Math.floor(n + 0.5);

export type CourseHandicap = {
  courseHandicap: number;
  /** True when the course had no rating or slope and the index was used as is. */
  estimated: boolean;
};

export function courseHandicap(
  index: number,
  card: { slope?: number | null; courseRating?: number | null; par?: number | null }
): CourseHandicap {
  const { slope, courseRating, par } = card;
  if (!slope || courseRating == null || par == null) {
    return { courseHandicap: roundHalfUp(index), estimated: true };
  }
  return { courseHandicap: roundHalfUp((index * slope) / 113 + (courseRating - par)), estimated: false };
}

export function playingHandicap(courseHcp: number, allowance: number): number {
  return roundHalfUp(courseHcp * allowance);
}

/** What a member typed → an index. "14.2" → 14.2, "+1.5" → -1.5 (a plus
 *  handicap, as written on a card), "14,2" too. Null if it isn't one. */
export function parseIndex(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\+?\d{1,2}(\.\d)?$/.test(t)) return null;
  const n = t.startsWith("+") ? -Number(t.slice(1)) : Number(t);
  return n >= MIN_INDEX && n <= MAX_INDEX ? n : null;
}

/** "14.2", "+1.5", "0". Plus handicaps are written with a plus, as on a card. */
export function indexLabel(index: number): string {
  if (index < 0) return `+${Math.abs(index).toFixed(1)}`;
  return Number.isInteger(index) ? String(index) : index.toFixed(1);
}

// ---------------------------------------------------------------------------
// The card and shots per hole
// ---------------------------------------------------------------------------

export type CardHole = {
  hole: number;
  par: number;
  /** Null until someone enters it from the card. */
  strokeIndex: number | null;
};

/**
 * Shots received on each hole, keyed by hole number.
 *
 * Null when any hole is missing its stroke index: handing shots out on a
 * partial card would give a wrong answer that looks right. A plus
 * handicapper gives shots back, easiest holes first.
 */
export function shotsByHole(playingHcp: number, card: readonly CardHole[]): Map<number, number> | null {
  if (card.length === 0 || card.some((h) => h.strokeIndex == null)) return null;
  const n = card.length;
  // Hardest first. Ties (a mistyped card) fall back to hole order so the
  // answer is at least stable.
  const ranked = [...card].sort((a, b) => a.strokeIndex! - b.strokeIndex! || a.hole - b.hole);
  const shots = new Map<number, number>();
  const whole = Math.trunc(playingHcp / n) || 0; // never -0
  const rest = Math.abs(playingHcp % n);
  ranked.forEach((h, i) => {
    let s = whole;
    if (playingHcp >= 0) {
      if (i < rest) s += 1;
    } else if (i >= n - rest) {
      s -= 1;
    }
    shots.set(h.hole, s);
  });
  return shots;
}

// ---------------------------------------------------------------------------
// Per hole
// ---------------------------------------------------------------------------

/** Stableford points: two for a net par, one more per shot better, never below 0.
 *  A null score (picked up) is 0 points. */
export function stablefordPoints(strokes: number | null, par: number, shots: number): number {
  if (strokes == null) return 0;
  return Math.max(0, par + 2 + shots - strokes);
}

/** What a net score is called. Null when there's nothing kind or useful to say. */
export function netScoreName(strokes: number, par: number, shots: number): string | null {
  const diff = strokes - shots - par;
  switch (diff) {
    case -3:
      return "Net albatross";
    case -2:
      return "Net eagle";
    case -1:
      return "Net birdie";
    case 0:
      return "Net par";
    case 1:
      return "Net bogey";
    case 2:
      return "Net double";
    default:
      return diff < -3 ? "Net miracle" : null;
  }
}

// ---------------------------------------------------------------------------
// The leaderboard
// ---------------------------------------------------------------------------

export type LivePlayer = {
  id: number;
  name: string;
  playingHandicap: number;
  /** Matchplay only: 1 or 2. */
  side?: number | null;
};

/** player id → hole → strokes. A hole that is present with null was picked up. */
export type ScoreSheet = ReadonlyMap<number, ReadonlyMap<number, number | null>>;

export type BoardRow = {
  playerId: number;
  name: string;
  /** "1", "T2"… Empty for someone who hasn't started. */
  position: string;
  thru: number;
  /** Stableford points so far. */
  points: number;
  /** Strokes so far (picked-up holes count par + 2 + shots, the most that
   *  can still score 0 points, as on a Stableford card). */
  gross: number;
  /** Net strokes against par for the holes played: -2, 0, +3. */
  netToPar: number;
  /** Stableford points against two a hole: who is ahead of the pace. */
  pace: number;
};

export type Board = {
  rows: BoardRow[];
  /** True when the card is missing stroke indexes, so nets and points are
   *  only gross until it is filled in. */
  cardIncomplete: boolean;
};

export function buildBoard(
  format: LiveFormat,
  card: readonly CardHole[],
  players: readonly LivePlayer[],
  scores: ScoreSheet
): Board {
  const parOf = new Map(card.map((h) => [h.hole, h.par]));
  let cardIncomplete = false;

  const rows: BoardRow[] = players.map((p) => {
    const shots = shotsByHole(p.playingHandicap, card);
    if (!shots) cardIncomplete = true;
    const mine = scores.get(p.id) ?? new Map<number, number | null>();
    let thru = 0;
    let points = 0;
    let gross = 0;
    let netToPar = 0;
    for (const [hole, strokes] of mine) {
      const par = parOf.get(hole);
      if (par == null) continue;
      const s = shots?.get(hole) ?? 0;
      thru += 1;
      points += stablefordPoints(strokes, par, s);
      const counted = strokes ?? par + 2 + s;
      gross += counted;
      netToPar += counted - s - par;
    }
    return { playerId: p.id, name: p.name, position: "", thru, points, gross, netToPar, pace: points - thru * 2 };
  });

  const started = rows.filter((r) => r.thru > 0);
  const key = (r: BoardRow) => (format === "stroke" ? r.netToPar : -r.points);
  started.sort((a, b) => key(a) - key(b) || b.thru - a.thru || a.name.localeCompare(b.name));
  // Standard competition ranking: two tied for first are T1, the next is 3.
  for (const r of started) {
    const first = started.findIndex((o) => key(o) === key(r));
    const tied = started.filter((o) => key(o) === key(r)).length > 1;
    r.position = `${tied ? "T" : ""}${first + 1}`;
  }
  const notStarted = rows.filter((r) => r.thru === 0).sort((a, b) => a.name.localeCompare(b.name));
  return { rows: [...started, ...notStarted], cardIncomplete };
}

/** "+3", "E", "-1" for a net-to-par figure. */
export function toParLabel(n: number): string {
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : String(n);
}

// ---------------------------------------------------------------------------
// Singles matchplay
// ---------------------------------------------------------------------------

export type HoleResult = "won" | "lost" | "halved";

export type MatchState = {
  /** From side 1's point of view, hole by hole, for holes both have finished. */
  results: { hole: number; result: HoleResult }[];
  /** Holes up for side 1 (negative: down). */
  up: number;
  holesLeft: number;
  finished: boolean;
  /** "2 UP", "All square", "Dormie 2", "Won 3&2", "Lost 1 down". Side 1's view. */
  label: string;
  /** Shots side 1 / side 2 receive in the match (the lower handicap plays off 0). */
  shots: [number, number];
};

/**
 * Singles: the higher handicap receives the difference in playing
 * handicaps, allocated by stroke index; the lower plays off scratch.
 * A picked-up hole (null) loses to any score, and halves with another pick-up.
 */
export function matchState(card: readonly CardHole[], a: LivePlayer, b: LivePlayer, scores: ScoreSheet): MatchState | null {
  const diff = a.playingHandicap - b.playingHandicap;
  const aShots = shotsByHole(Math.max(0, diff), card);
  const bShots = shotsByHole(Math.max(0, -diff), card);
  if (!aShots || !bShots) return null;

  const sa = scores.get(a.id) ?? new Map<number, number | null>();
  const sb = scores.get(b.id) ?? new Map<number, number | null>();
  const ordered = [...card].sort((x, y) => x.hole - y.hole);
  const results: MatchState["results"] = [];
  let up = 0;

  for (const h of ordered) {
    if (!sa.has(h.hole) || !sb.has(h.hole)) continue;
    const ga = sa.get(h.hole) ?? null;
    const gb = sb.get(h.hole) ?? null;
    let result: HoleResult;
    if (ga == null && gb == null) result = "halved";
    else if (ga == null) result = "lost";
    else if (gb == null) result = "won";
    else {
      const na = ga - (aShots.get(h.hole) ?? 0);
      const nb = gb - (bShots.get(h.hole) ?? 0);
      result = na < nb ? "won" : na > nb ? "lost" : "halved";
    }
    results.push({ hole: h.hole, result });
    if (result === "won") up += 1;
    if (result === "lost") up -= 1;
  }

  const holesLeft = ordered.length - results.length;
  const finished = holesLeft === 0 || Math.abs(up) > holesLeft;
  let label: string;
  if (finished) {
    if (up === 0) label = "Halved";
    else if (holesLeft === 0) label = up > 0 ? `Won ${up} up` : `Lost ${-up} down`;
    else label = up > 0 ? `Won ${up}&${holesLeft}` : `Lost ${-up}&${holesLeft}`;
  } else if (up === 0) {
    label = "All square";
  } else if (Math.abs(up) === holesLeft) {
    label = up > 0 ? `Dormie ${up}` : `${-up} DOWN`;
  } else {
    label = up > 0 ? `${up} UP` : `${-up} DOWN`;
  }
  return { results, up, holesLeft, finished, label, shots: [Math.max(0, diff), Math.max(0, -diff)] };
}

// ---------------------------------------------------------------------------
// A blank card
// ---------------------------------------------------------------------------

/** Par 4 everywhere and no stroke indexes: what a round starts with on a
 *  course whose card isn't on file yet. The scorer corrects it as they go. */
export function blankCard(holes: 9 | 18): CardHole[] {
  return Array.from({ length: holes }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: null }));
}
