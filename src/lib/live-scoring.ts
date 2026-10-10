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

export type LiveFormat = "stableford" | "stroke" | "matchplay" | "fourball" | "foursomes" | "greensomes" | "scramble";

/** The formats a match in a match day can be played in. */
export type MatchFormat = "matchplay" | "fourball" | "foursomes" | "greensomes";

export type FormatInfo = {
  id: LiveFormat;
  label: string;
  /** One line under the label on the format picker. */
  blurb: string;
  /** Share of the course handicap that is played off (WHS recommendations). */
  allowance: number;
  /** Can be picked when setting up a single round. */
  available: boolean;
  /** Can be picked for a match in a match day. */
  matchDay: boolean;
  /** Players per side in a match (match formats only). */
  perSide?: 1 | 2;
};

export const LIVE_FORMATS: readonly FormatInfo[] = [
  { id: "stableford", label: "Stableford", blurb: "Points per hole", allowance: 0.95, available: true, matchDay: false },
  { id: "stroke", label: "Stroke play", blurb: "Gross and net", allowance: 0.95, available: true, matchDay: false },
  { id: "matchplay", label: "Singles", blurb: "One v one, hole by hole", allowance: 1, available: true, matchDay: true, perSide: 1 },
  // WHS: four-ball MATCH play is 90% (85% is the stroke-play figure).
  { id: "fourball", label: "Fourball", blurb: "Better ball of each pair", allowance: 0.9, available: false, matchDay: true, perSide: 2 },
  // Foursomes: 50% of the pair's combined course handicaps.
  { id: "foursomes", label: "Foursomes", blurb: "Scotch, alternate shot", allowance: 0.5, available: false, matchDay: true, perSide: 2 },
  // Greensomes: 60% of the lower plus 40% of the higher course handicap.
  { id: "greensomes", label: "Greensomes", blurb: "Both drive, pick one", allowance: 0.6, available: false, matchDay: true, perSide: 2 },
  // Scramble (0113): the allowance is per player and worked out by
  // scrambleHandicap below; 0.25 is the lowest player's share in a four.
  { id: "scramble", label: "Scramble", blurb: "Teams of 2 or 4, one ball", allowance: 0.25, available: true, matchDay: false },
];

export const MATCH_FORMATS = LIVE_FORMATS.filter((f) => f.matchDay);

export const isMatchFormat = (id: LiveFormat): id is MatchFormat =>
  id === "matchplay" || id === "fourball" || id === "foursomes" || id === "greensomes";

/** Foursomes and greensomes: one ball per pair, so one score per side. */
export const isOneBallPerSide = (id: LiveFormat): boolean => id === "foursomes" || id === "greensomes";

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

/**
 * Shots on the holes whose share can be known so far, for a card that is
 * still being filled in hole by hole on the course.
 *
 * With every index in, it is shotsByHole. Before that, a hole's index is
 * its rank on a full-length card (SI 1 is the hardest of n), so a player
 * off 10 on 18 holes gets a shot wherever SI ≤ 10 — exactly what a golfer
 * reads off the card. That only holds when the index fits the round
 * (≤ n holes); a 9-hole round marked from an 18-hole card has to wait for
 * the full card to rank its holes. Holes that can't be known yet are
 * missing from the map.
 */
export function shotsSoFar(playingHcp: number, card: readonly CardHole[]): Map<number, number> {
  const full = shotsByHole(playingHcp, card);
  if (full) return full;
  const n = card.length;
  const shots = new Map<number, number>();
  if (n === 0) return shots;
  const whole = Math.trunc(playingHcp / n) || 0;
  const rest = Math.abs(playingHcp % n);
  for (const h of card) {
    const si = h.strokeIndex;
    // Off scratch (or a whole multiple of the holes) every hole gets the
    // same, so the index doesn't matter.
    if (rest === 0) {
      shots.set(h.hole, whole);
      continue;
    }
    if (si == null || si < 1 || si > n) continue;
    let s = whole;
    if (playingHcp >= 0) {
      if (si <= rest) s += 1;
    } else if (si > n - rest) {
      s -= 1;
    }
    shots.set(h.hole, s);
  }
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

  if (card.some((h) => h.strokeIndex == null)) cardIncomplete = true;
  const rows: BoardRow[] = players.map((p) => {
    const shots = shotsSoFar(p.playingHandicap, card);
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
// Matches between sides: singles, fourball, foursomes, greensomes
// ---------------------------------------------------------------------------

export type MatchPlayer = LivePlayer & {
  /** Course handicap: the team formats work from it, not the stored
   *  playing handicap (a fourball player's allowance depends on the format). */
  courseHandicap: number;
  /** 1 or 2. */
  side: number;
  /** Playing order within the round; for one-ball formats the side's score
   *  lives on its first player. */
  position: number;
};

/** Who gets shots in a match, and how many. A "competitor" is a player in
 *  singles and fourball, and a pair in foursomes and greensomes. */
export type MatchCompetitor = {
  key: string;
  side: 1 | 2;
  playerIds: number[];
  /** Handicap for this match before taking off the lowest. */
  matchHandicap: number;
  /** Shots received in the match: matchHandicap minus the lowest. */
  shots: number;
};

export function matchCompetitors(format: MatchFormat, players: readonly MatchPlayer[]): MatchCompetitor[] {
  const bySide = (n: number) => [...players].filter((p) => p.side === n).sort((a, b) => a.position - b.position);
  let list: Omit<MatchCompetitor, "shots">[];
  if (format === "foursomes" || format === "greensomes") {
    list = [1, 2].map((n) => {
      const pair = bySide(n);
      const chs = pair.map((p) => p.courseHandicap).sort((a, b) => a - b);
      const hcp =
        format === "foursomes"
          ? roundHalfUp(0.5 * chs.reduce((t, c) => t + c, 0))
          : roundHalfUp(0.6 * (chs[0] ?? 0) + 0.4 * (chs[chs.length - 1] ?? 0));
      return { key: `side${n}`, side: n as 1 | 2, playerIds: pair.map((p) => p.id), matchHandicap: hcp };
    });
  } else {
    const allowance = format === "fourball" ? 0.9 : 1;
    list = players.map((p) => ({
      key: `p${p.id}`,
      side: (p.side === 2 ? 2 : 1) as 1 | 2,
      playerIds: [p.id],
      matchHandicap: playingHandicap(p.courseHandicap, allowance),
    }));
  }
  const low = Math.min(...list.map((c) => c.matchHandicap));
  return list.map((c) => ({ ...c, shots: c.matchHandicap - low }));
}

export type TeamHole = {
  hole: number;
  result: HoleResult;
  /** Best net of each side on the hole; null = the side picked up. */
  net: [number | null, number | null];
  /** The players whose score counted (fourball's better ball). */
  counting: number[];
};

export type TeamMatchState = {
  /** From side 1's point of view, for every hole both sides have finished. */
  holes: TeamHole[];
  up: number;
  holesLeft: number;
  finished: boolean;
  /** 1 or 2 when a side is ahead (or won), 0 when level (or halved). */
  leader: 0 | 1 | 2;
  /** "2 UP", "All square", "3&2", "1 up", "Halved". Who leads is `leader`. */
  margin: string;
  dormie: boolean;
  competitors: MatchCompetitor[];
  /** The next hole the match can't be played past until its stroke index
   *  is entered (someone gets or gives a shot there), or null. */
  waitingForIndex: number | null;
};

/**
 * Plays a match hole by hole.
 *
 * Singles and fourball: every player plays their own ball; a side's score on
 * a hole is its best net. Foursomes and greensomes: one ball per pair, whose
 * score is entered against the pair's first player. A hole counts once
 * every player who plays a ball has an entry; a null entry is a pick-up.
 * Holes are taken in order and the first unfinished one stops the count, so
 * a hole scored out of order doesn't make the match look further on than it is.
 *
 * The card can still be filling in: the match is played as far as the
 * first hole whose shots can't be known yet (see shotsSoFar), and
 * `waitingForIndex` names it. Never null; the null in the type is kept so
 * older callers' checks still compile.
 */
export function teamMatchState(
  format: MatchFormat,
  card: readonly CardHole[],
  players: readonly MatchPlayer[],
  scores: ScoreSheet
): TeamMatchState | null {
  const competitors = matchCompetitors(format, players);
  const shotMaps = new Map<string, Map<number, number>>();
  for (const c of competitors) shotMaps.set(c.key, shotsSoFar(c.shots, card));
  const oneBall = isOneBallPerSide(format);
  const ordered = [...card].sort((a, b) => a.hole - b.hole);
  const holes: TeamHole[] = [];
  let up = 0;
  let waitingForIndex: number | null = null;

  for (const h of ordered) {
    if (competitors.some((c) => !shotMaps.get(c.key)!.has(h.hole))) {
      waitingForIndex = h.hole;
      break;
    }
    const sideNet: (number | null)[] = [null, null];
    const counting: number[] = [];
    let complete = true;
    for (const n of [1, 2]) {
      const comps = competitors.filter((c) => c.side === n);
      let best: number | null = null;
      let bestIds: number[] = [];
      for (const c of comps) {
        // The ball(s) this competitor plays: one per player, or the pair's one.
        const ballIds = oneBall ? c.playerIds.slice(0, 1) : c.playerIds;
        for (const id of ballIds) {
          const mine = scores.get(id);
          if (!mine || !mine.has(h.hole)) {
            complete = false;
            continue;
          }
          const gross = mine.get(h.hole) ?? null;
          if (gross == null) continue;
          const net = gross - (shotMaps.get(c.key)!.get(h.hole) ?? 0);
          if (best == null || net < best) {
            best = net;
            bestIds = oneBall ? [...c.playerIds] : [id];
          } else if (net === best && !oneBall) {
            bestIds.push(id);
          }
        }
      }
      sideNet[n - 1] = best;
      counting.push(...bestIds);
    }
    if (!complete) break;
    const [a, b] = sideNet;
    const result: HoleResult =
      a == null && b == null ? "halved" : a == null ? "lost" : b == null ? "won" : a < b ? "won" : a > b ? "lost" : "halved";
    holes.push({ hole: h.hole, result, net: [a, b], counting });
    if (result === "won") up += 1;
    if (result === "lost") up -= 1;
    if (Math.abs(up) > ordered.length - holes.length) break; // decided
  }

  const holesLeft = ordered.length - holes.length;
  const finished = holesLeft === 0 || Math.abs(up) > holesLeft;
  const leader: 0 | 1 | 2 = up > 0 ? 1 : up < 0 ? 2 : 0;
  const n = Math.abs(up);
  let margin: string;
  if (finished) margin = up === 0 ? "Halved" : holesLeft === 0 ? `${n} up` : `${n}&${holesLeft}`;
  else margin = up === 0 ? "All square" : `${n} UP`;
  return { holes, up, holesLeft, finished, leader, margin, dormie: !finished && n > 0 && n === holesLeft, competitors, waitingForIndex };
}

/** Points a match is worth to each side: 1 for a win, a half each for a
 *  halved match. `projected` scores an unfinished match as it stands. */
export function matchPoints(state: TeamMatchState | null, projected = false): [number, number] {
  if (!state || (!state.finished && !projected)) return [0, 0];
  if (state.leader === 1) return [1, 0];
  if (state.leader === 2) return [0, 1];
  return state.holes.length > 0 || state.finished ? [0.5, 0.5] : [0, 0];
}

/** "1½", "2", "½". */
export function pointsLabel(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (whole === 0 && half) return "½";
  return `${whole}${half ? "½" : ""}`;
}

// ---------------------------------------------------------------------------
// A blank card
// ---------------------------------------------------------------------------

/** Par 4 everywhere and no stroke indexes: what a round starts with on a
 *  course whose card isn't on file yet. The scorer corrects it as they go. */
export function blankCard(holes: 9 | 18): CardHole[] {
  return Array.from({ length: holes }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: null }));
}

// ---------------------------------------------------------------------------
// Scramble (0113)
// ---------------------------------------------------------------------------

export type ScrambleSize = 2 | 4;

/** WHS recommended allowances, lowest course handicap first. */
export const SCRAMBLE_WEIGHTS: Record<ScrambleSize, readonly number[]> = {
  4: [0.25, 0.2, 0.15, 0.1],
  2: [0.35, 0.15],
};

export type ScrambleHandicap = {
  /** The team's playing handicap: the shares summed, then rounded. */
  team: number;
  /** Each player's share, in the order given, to one decimal — for showing
   *  how the team figure was made. */
  shares: number[];
};

/**
 * A scramble team's handicap from its players' course handicaps.
 *
 * Lowest course handicap takes the biggest share (a plus handicap is the
 * lowest of all). WHS sums the unrounded shares and rounds once, so
 * 4, 10, 18, 25 → 1 + 2 + 2.7 + 2.5 = 8.2 → 8, not 1+2+3+3 = 9.
 */
export function scrambleHandicap(courseHandicaps: readonly number[]): ScrambleHandicap {
  const size = courseHandicaps.length as ScrambleSize;
  const weights = SCRAMBLE_WEIGHTS[size];
  if (!weights) throw new Error("A scramble team is 2 or 4 players");
  const order = courseHandicaps.map((ch, i) => ({ ch, i })).sort((a, b) => a.ch - b.ch || a.i - b.i);
  const shares = new Array<number>(size).fill(0);
  order.forEach(({ ch, i }, rank) => {
    shares[i] = ch * weights[rank];
  });
  const sum = shares.reduce((a, b) => a + b, 0);
  return { team: roundHalfUp(sum), shares: shares.map((x) => Math.round(x * 10) / 10) };
}

/** How many drives each player (by position) has had used. */
export function driveCounts(drives: ReadonlyMap<number, number>, positions: readonly number[]): Map<number, number> {
  const counts = new Map(positions.map((p) => [p, 0]));
  for (const pos of drives.values()) counts.set(pos, (counts.get(pos) ?? 0) + 1);
  return counts;
}

export type DriveNeed = { position: number; needed: number };

/**
 * Who still owes drives towards the minimum, and whether the team can still
 * get everyone there in the holes left (each hole gives one drive).
 */
export function driveShortfall(
  counts: ReadonlyMap<number, number>,
  minimum: number | null,
  holesLeft: number
): { needs: DriveNeed[]; impossible: boolean; tight: boolean } {
  if (!minimum) return { needs: [], impossible: false, tight: false };
  const needs = [...counts.entries()]
    .map(([position, n]) => ({ position, needed: Math.max(0, minimum - n) }))
    .filter((x) => x.needed > 0);
  const total = needs.reduce((a, b) => a + b.needed, 0);
  return { needs, impossible: total > holesLeft, tight: total > 0 && total === holesLeft };
}
