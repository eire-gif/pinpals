import { indexLabel, shotsSoFar, stablefordPoints, type CardHole } from "./live-scoring";

/**
 * Scorecards — the arithmetic (0110, claude/scorecards.md).
 *
 * Pure, and byte-identical in src/lib/scorecard-math.ts (the website's public
 * scorecard page adds up the same way; a test fails if they drift). Tested
 * in mobile/src/lib/scorecard-math.test.ts. Nothing about
 * a scorecard is stored except par, index, yards and strokes per hole; every
 * total, point and label is worked out here, so an edited hole can never
 * leave a stale total behind.
 */

export type ScorecardHole = {
  hole: number;
  par: number;
  strokeIndex: number | null;
  yards: number | null;
  /** Null: not entered yet, or no return on the hole. */
  strokes: number | null;
  putts: number | null;
};

export type ScorecardMeta = {
  courseName: string;
  teeName: string | null;
  holes: 9 | 18;
  /** YYYY-MM-DD */
  playedOn: string;
  handicapIndex: number | null;
  playingHandicap: number | null;
};

export type HoleResult = "albatross" | "eagle" | "birdie" | "par" | "bogey" | "double" | "worse";

export function holeResult(strokes: number, par: number): HoleResult {
  const d = strokes - par;
  if (d <= -3) return "albatross";
  if (d === -2) return "eagle";
  if (d === -1) return "birdie";
  if (d === 0) return "par";
  if (d === 1) return "bogey";
  if (d === 2) return "double";
  return "worse";
}

export type NineTotals = { par: number; strokes: number | null; yards: number | null; putts: number | null };

export type ScorecardTotals = {
  out: NineTotals;
  /** Null on a 9-hole card. */
  in: NineTotals | null;
  total: NineTotals;
  /** Every hole has a score. */
  complete: boolean;
  /** Holes with a score. */
  played: number;
  /** Strokes against par over the holes played, so a card in progress reads
   *  "+3 thru 11" rather than nonsense. */
  vsPar: number | null;
  /** Stableford points with a playing handicap, over holes whose shots are
   *  known; null without a handicap. */
  points: number | null;
  /** Net strokes (gross − playing handicap), complete cards only. */
  net: number | null;
  counts: Record<HoleResult, number>;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function nine(holes: readonly ScorecardHole[]): NineTotals {
  const scored = holes.every((h) => h.strokes != null);
  const yards = holes.every((h) => h.yards != null);
  const putts = holes.some((h) => h.putts != null);
  return {
    par: sum(holes.map((h) => h.par)),
    strokes: holes.length > 0 && scored ? sum(holes.map((h) => h.strokes!)) : null,
    yards: holes.length > 0 && yards ? sum(holes.map((h) => h.yards!)) : null,
    putts: putts ? sum(holes.map((h) => h.putts ?? 0)) : null,
  };
}

export function scorecardTotals(holes: readonly ScorecardHole[], playingHandicap: number | null): ScorecardTotals {
  const sorted = [...holes].sort((a, b) => a.hole - b.hole);
  const front = sorted.filter((h) => h.hole <= 9);
  const back = sorted.filter((h) => h.hole > 9);
  const played = sorted.filter((h) => h.strokes != null);
  const complete = sorted.length > 0 && played.length === sorted.length;

  const counts: Record<HoleResult, number> = { albatross: 0, eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, worse: 0 };
  for (const h of played) counts[holeResult(h.strokes!, h.par)] += 1;

  let points: number | null = null;
  if (playingHandicap != null && played.length > 0) {
    const card: CardHole[] = sorted.map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.strokeIndex }));
    const shots = shotsSoFar(playingHandicap, card);
    points = sum(played.filter((h) => shots.has(h.hole)).map((h) => stablefordPoints(h.strokes, h.par, shots.get(h.hole)!)));
  }

  const total = nine(sorted);
  return {
    out: nine(front),
    in: back.length > 0 ? nine(back) : null,
    total,
    complete,
    played: played.length,
    vsPar: played.length > 0 ? sum(played.map((h) => h.strokes! - h.par)) : null,
    points,
    net: complete && playingHandicap != null && total.strokes != null ? total.strokes - playingHandicap : null,
    counts,
  };
}

export const vsParText = (n: number | null): string => (n == null ? "–" : n === 0 ? "E" : n > 0 ? `+${n}` : String(n));

/** Shots received per hole, for the dots on the card. Empty without a handicap. */
export function shotsOnCard(holes: readonly ScorecardHole[], playingHandicap: number | null): Map<number, number> {
  if (playingHandicap == null) return new Map();
  return shotsSoFar(
    playingHandicap,
    [...holes].sort((a, b) => a.hole - b.hole).map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.strokeIndex }))
  );
}

/** A blank card of n holes, par 4, for typing a course in by hand. */
export function blankScorecard(n: 9 | 18): ScorecardHole[] {
  return Array.from({ length: n }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: null, yards: null, strokes: null, putts: null }));
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sat 4 Oct 2026" */
export function playedLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** The one-line headline: "78 (+6) · 36 pts", or "+3 thru 11" in progress. */
export function headline(t: ScorecardTotals): string {
  const pts = t.points != null ? ` · ${t.points} pts` : "";
  if (t.complete && t.total.strokes != null) return `${t.total.strokes} (${vsParText(t.vsPar)})${pts}`;
  if (t.played === 0) return "No scores yet";
  return `${vsParText(t.vsPar)} thru ${t.played}${pts}`;
}

const cell = (n: number | null) => (n == null ? "–" : String(n));

/**
 * The card as text, for WhatsApp and Messages: readable in a chat bubble,
 * no tables (proportional fonts break columns), and the link at the end so
 * the preview card shows.
 */
export function shareText(meta: ScorecardMeta, holes: readonly ScorecardHole[], link: string | null): string {
  const t = scorecardTotals(holes, meta.playingHandicap);
  const sorted = [...holes].sort((a, b) => a.hole - b.hole);
  const front = sorted.filter((h) => h.hole <= 9);
  const back = sorted.filter((h) => h.hole > 9);
  const lines = [
    `⛳ ${meta.courseName}${meta.teeName ? ` · ${meta.teeName} tees` : ""}`,
    playedLabel(meta.playedOn),
    "",
    `${headline(t)}${meta.handicapIndex != null ? ` · off ${indexLabel(meta.handicapIndex)}` : ""}`,
    `Out ${cell(t.out.strokes)}${t.in ? ` · In ${cell(t.in.strokes)}` : ""}`,
    `Front: ${front.map((h) => cell(h.strokes)).join(" ")}`,
  ];
  if (back.length > 0) lines.push(`Back: ${back.map((h) => cell(h.strokes)).join(" ")}`);
  const highlights = [
    t.counts.albatross ? `${t.counts.albatross} albatross` : null,
    t.counts.eagle ? `${t.counts.eagle} eagle${t.counts.eagle > 1 ? "s" : ""}` : null,
    t.counts.birdie ? `${t.counts.birdie} birdie${t.counts.birdie > 1 ? "s" : ""}` : null,
  ].filter(Boolean);
  if (highlights.length) lines.push(`🐦 ${highlights.join(", ")}`);
  if (link) lines.push("", link);
  return lines.join("\n");
}

/**
 * The round post a scorecard turns into (feed composer, ?scorecard=<id>):
 * the fields RoundDetails already has, filled only where the card can say.
 * A card still in progress has no final score — the member adds one.
 */
export function roundPostFields(meta: ScorecardMeta, holes: readonly ScorecardHole[]): Record<string, string> {
  const t = scorecardTotals(holes, meta.playingHandicap);
  const f: Record<string, string> = {
    holes: String(meta.holes),
    course_par: String(t.total.par),
    played_on: meta.playedOn,
  };
  if (meta.teeName) f.tee = meta.teeName.slice(0, 20);
  if (t.complete && t.total.strokes != null) f.score = String(t.total.strokes);
  if (meta.holes === 18 && t.out.strokes != null && t.in?.strokes != null) {
    f.front_nine = String(t.out.strokes);
    f.back_nine = String(t.in.strokes);
  }
  const birdiesOrBetter = t.counts.birdie + t.counts.eagle + t.counts.albatross;
  if (t.played > 0) f.birdies = String(birdiesOrBetter);
  if (t.total.putts != null) f.putts = String(t.total.putts);
  return f;
}
