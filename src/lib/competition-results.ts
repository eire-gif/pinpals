/**
 * Competition results — 1st, 2nd and 3rd, and how every tie was broken
 * (Oct 2026).
 *
 * Pure, and byte-identical in mobile/src/lib/competition-results.ts
 * (competition-results.test.ts fails if the copies drift): the organiser's
 * phone works the results out, the website draws the shared results page
 * and the notifications from the same rules.
 *
 * TIES: the R&A's recommended "matching scorecards" method (Rules of Golf,
 * Committee Procedures 5A(6)d), which Golf Ireland clubs use:
 *
 *   1. the last 9 holes, then the last 6, the last 3 and the 18th
 *   2. still level: the last 6, the last 3 and the last hole of the FIRST 9
 *   3. still level: the Committee's choice, set before the day — a tie
 *      (the place is shared) or a random draw
 *
 * Holes are taken by their number on the card, holes 10–18 for the last 9,
 * whatever hole a group started on — the R&A's recommendation for two-tee
 * and shotgun starts, so every tie is judged on the same holes.
 *
 *   Stableford (and team Stableford)  points on those holes, the shots
 *                                     given exactly as in the competition
 *                                     (by stroke index)
 *   Stroke play, net                  gross on those holes minus the same
 *                                     fraction of the handicap: ½ for 9,
 *                                     ⅓ for 6, ⅙ for 3, 1⁄18 for one hole —
 *                                     never rounded
 *   Best gross                        gross on those holes
 *
 * A 9-hole competition compares the last 6, last 3 and last hole (the R&A
 * adjusts the holes "for rounds of fewer holes"), with fractions of 9.
 *
 * NO RETURN: in stroke play a hole without a score (picked up) means no
 * score for the round — Rule 3.3c — so the card is "NR" and can't place.
 * In Stableford a picked-up hole is simply no points (Rule 21.1c). A card
 * with holes not yet entered isn't ranked until it's in.
 *
 * Numbers are exact: a net countback value is kept as (gross × holes −
 * handicap × holes counted) so a third of a shot is never rounded away;
 * it's only turned into 32.33 for showing.
 *
 * The result is plain JSON (no Maps), so the published copy can be stored
 * as it is and shown, shared and notified from without working it out again.
 *
 * AMENDMENTS: the organiser can correct a hole's score or disqualify a card
 * (a wrong score signed for, a breach of the rules). The players' cards are
 * never changed — the amendment is applied here, on the way into the
 * ranking — and every row it touches says "Amended", with what the players
 * submitted and what it became, and why. So a published result that
 * differs from the cards always says so.
 */

import { shotsSoFar, stablefordPoints, type CardHole } from "./live-scoring";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What ranks the day: Stableford points or net stroke play. */
export type ResultsBasis = "stableford" | "stroke";

/** What a ranking is on: the day's basis, or gross for the best gross prize. */
export type RankBasis = ResultsBasis | "gross";

/** Level after every countback step: shared, or a random draw (R&A 5A(6)). */
export type TieRule = "share" | "draw";

export type ResultsSettings = {
  tieRule: TieRule;
  /** Lowest playing handicap of division 2, 3…; empty = one division.
   *  Ascending. Individual competitions only. */
  divisionCuts: number[];
  /** Best gross, worked out from the cards (individual competitions). */
  bestGross: boolean;
  /** A player who places in their division can't also take best gross. */
  onePrizePerPlayer: boolean;
  /** Guests are listed, but only members take places when this is off. */
  guestsCanWin: boolean;
  /** Prizes the cards can't decide: nearest the pin, longest drive. */
  extras: { label: string; winner: string }[];
  /** The organiser's corrections to what the players submitted. */
  amendments: Amendment[];
};

/** A correction by the organiser: a hole's score (hole set), or a
 *  disqualification (dq). Always with a reason, shown to everyone. */
export type Amendment = {
  /** The entrant's key (a player, or a team's card). */
  key: string;
  hole: number | null;
  /** The corrected score; null = picked up. */
  strokes: number | null;
  dq: boolean;
  reason: string;
};

export const DEFAULT_SETTINGS: ResultsSettings = {
  tieRule: "draw",
  divisionCuts: [],
  bestGross: true,
  onePrizePerPlayer: true,
  guestsCanWin: false,
  extras: [],
  amendments: [],
};

/** One card in the competition: a player, or a team or pair on one ball. */
export type ResultEntrant = {
  key: string;
  name: string;
  /** A team's players ("Eire · Tom"), shown under the name. */
  detail: string | null;
  /** Members to tell (a team's every member). */
  memberIds: string[];
  guest: boolean;
  /** The handicap the competition was played off (a team's handicap). */
  handicap: number;
  card: CardHole[];
  /** Hole → strokes; null = picked up; a hole not here isn't entered yet. */
  scores: Record<number, number | null>;
  /** The round (card) it was scored on, and its tee group. */
  roundId: number;
  group: number | null;
  /** Certified by a playing partner (a team's card: by the other side). */
  certified: boolean | null;
  /** Set by applyAmendments: disqualified, and what was amended. */
  dq?: boolean;
  amended?: string[];
};

export type RowStatus = "ok" | "out" | "nr" | "dq";

export type ResultRow = {
  key: string;
  name: string;
  detail: string | null;
  memberIds: string[];
  guest: boolean;
  handicap: number;
  roundId: number;
  group: number | null;
  certified: boolean | null;
  status: RowStatus;
  /** Holes with a score (or picked up) on the card. */
  thru: number;
  /** "38", "70.5" (net), "75" (gross) — the figure the ranking is on. */
  score: string;
  /** Points (Stableford), net and gross, where they exist. */
  points: number | null;
  net: string | null;
  gross: number | null;
  /** First countback figure (last 9), for the "B9" column. */
  back: string | null;
  /** 1-based, null for anyone not ranked (out, NR, a guest). */
  position: number | null;
  /** "1", "=8", "Guest", "NR", "Out". */
  positionLabel: string;
  /** How a tie was broken, in a line. */
  note: string | null;
  /** Won its tie (green in the list). */
  wonTie: boolean;
  /** Index into Ranking.ties when this row was level with others. */
  tie: number | null;
  /** The organiser's amendments to this card, in words; empty when none. */
  amended: string[];
};

export type CountbackStep = {
  label: string;
  short: string;
  holes: number[];
  /** Fraction of the handicap taken off (net stroke play). */
  fraction: string | null;
};

export type TieGroup = {
  /** The level total, as shown. */
  total: string;
  /** In finishing order. */
  keys: string[];
  names: string[];
  /** Each step's figure for each player, in the same order; `decided` marks
   *  the step that first separated someone. */
  steps: { label: string; holes: string; values: string[]; decided: boolean }[];
  /** How it ended: separated by countback, or level after every step. */
  resolvedBy: "countback" | "draw" | "shared";
};

export type Ranking = {
  basis: RankBasis;
  rows: ResultRow[];
  ties: TieGroup[];
};

export type Division = {
  label: string;
  /** "0–15", "16 and over", null with one division. */
  range: string | null;
  ranking: Ranking;
};

export type Prize = {
  label: string;
  winners: { place: string; name: string; detail: string | null; score: string; note: string | null; memberIds: string[]; amended?: boolean }[];
};

export type Results = {
  version: 1;
  basis: ResultsBasis;
  team: boolean;
  holes: number;
  tieRule: TieRule;
  /** The rule as members read it, beside the results. */
  rule: string;
  divisions: Division[];
  bestGross: Ranking | null;
  prizes: Prize[];
  /** For the organiser before publishing. */
  checks: { level: "stop" | "warn" | "ok"; text: string }[];
  /** Every amendment, by card — shown at the top of published results. */
  amendments: { name: string; lines: string[] }[];
  /** The day, added when published so the results stand on their own
   *  (a society's past results, the share page). */
  event?: { title: string; courseName: string; playedOn: string };
  counts: { entrants: number; complete: number; out: number; nr: number; uncertifiedPlacers: number };
};

// ---------------------------------------------------------------------------
// Countback steps (R&A Committee Procedures 5A(6)d)
// ---------------------------------------------------------------------------

const range = (holes: number[]) => (holes.length === 1 ? `hole ${holes[0]}` : `holes ${holes[0]}–${holes[holes.length - 1]}`);
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
};
const FRACTION: Record<string, string> = { "9/18": "½", "6/18": "⅓", "3/18": "⅙", "1/18": "1⁄18", "6/9": "⅔", "3/9": "⅓", "1/9": "1⁄9" };

/** The countback steps for a card, in order. Holes by card number. */
export function countbackSteps(card: readonly CardHole[]): CountbackStep[] {
  const holes = [...card].map((h) => h.hole).sort((a, b) => a - b);
  const n = holes.length;
  const last = (k: number, upTo = n) => holes.slice(Math.max(0, upTo - k), upTo);
  const step = (label: string, short: string, hs: number[]): CountbackStep => ({
    label: `${label} (${range(hs)})`,
    short,
    holes: hs,
    fraction: FRACTION[`${hs.length}/${n}`] ?? `${hs.length}⁄${n}`,
  });
  if (n === 18) {
    const front = 9;
    return [
      step("Last 9", "last 9", last(9)),
      step("Last 6", "last 6", last(6)),
      step("Last 3", "last 3", last(3)),
      step(`${ordinal(holes[17])} hole`, `${ordinal(holes[17])}`, last(1)),
      step("Front 9, last 6", "front 9 last 6", last(6, front)),
      step("Front 9, last 3", "front 9 last 3", last(3, front)),
      step(`${ordinal(holes[8])} hole`, `${ordinal(holes[8])}`, last(1, front)),
    ];
  }
  const lengths = n >= 9 ? [6, 3, 1] : [Math.ceil(n / 2), 1].filter((k, i, a) => k > 0 && k < n && a.indexOf(k) === i);
  return lengths.map((k) =>
    k === 1 ? step(`${ordinal(holes[n - 1])} hole`, ordinal(holes[n - 1]), last(1)) : step(`Last ${k}`, `last ${k}`, last(k))
  );
}

/** The rule in a sentence, for members. */
export function ruleText(holes: number, tieRule: TieRule): string {
  const steps =
    holes === 18
      ? "the last 9, 6, 3 and 18th hole, then the last 6, 3 and last hole of the front 9"
      : "the last 6, 3 and last hole";
  const end = tieRule === "share" ? "still level, the place is shared" : "still level, decided by a random draw";
  return `Ties: countback on ${steps} (R&A recommendation, holes by card number); ${end}.`;
}

// ---------------------------------------------------------------------------
// One card's figures
// ---------------------------------------------------------------------------

type Figures = {
  status: RowStatus;
  thru: number;
  points: number;
  gross: number | null;
  /** Ranking value, scaled to integers; bigger is better for Stableford. */
  total: number;
  steps: number[];
  siMissing: boolean;
};

function figures(e: ResultEntrant, basis: RankBasis, steps: CountbackStep[]): Figures {
  if (e.dq) return { status: "dq", thru: 0, points: 0, gross: null, total: 0, steps: [], siMissing: false };
  const card = [...e.card].sort((a, b) => a.hole - b.hole);
  const n = card.length;
  const shots = shotsSoFar(basis === "gross" ? 0 : e.handicap, card);
  const siMissing = basis === "stableford" && card.some((h) => !shots.has(h.hole));
  const pts = new Map<number, number>();
  const strokes = new Map<number, number | null>();
  let thru = 0;
  let pickedUp = false;
  for (const h of card) {
    if (!(h.hole in e.scores)) continue;
    const s = e.scores[h.hole];
    thru += 1;
    strokes.set(h.hole, s);
    if (s == null) pickedUp = true;
    pts.set(h.hole, stablefordPoints(s, h.par, shots.get(h.hole) ?? 0));
  }
  const complete = thru === n && n > 0;
  const sumPts = (hs: number[]) => hs.reduce((t, x) => t + (pts.get(x) ?? 0), 0);
  const sumGross = (hs: number[]) => hs.reduce((t, x) => t + (strokes.get(x) ?? 0), 0);
  const all = card.map((h) => h.hole);
  const points = sumPts(all);
  const gross = complete && !pickedUp ? sumGross(all) : null;

  if (!complete) return { status: "out", thru, points, gross: null, total: 0, steps: [], siMissing };
  if (basis === "stableford") {
    return { status: "ok", thru, points, gross, total: points, steps: steps.map((s) => sumPts(s.holes)), siMissing };
  }
  // Stroke play: a picked-up hole is no return (Rule 3.3c).
  if (gross == null) return { status: "nr", thru, points, gross: null, total: 0, steps: [], siMissing };
  if (basis === "gross") return { status: "ok", thru, points, gross, total: gross, steps: steps.map((s) => sumGross(s.holes)), siMissing };
  // Net, scaled by n: gross × n − handicap × holes counted.
  return {
    status: "ok",
    thru,
    points,
    gross,
    total: gross * n - e.handicap * n,
    steps: steps.map((s) => sumGross(s.holes) * n - e.handicap * s.holes.length),
    siMissing,
  };
}

/** A scaled net value as shown: 64.5, 32.33. */
function showNet(scaled: number, n: number): string {
  const v = scaled / n;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** FNV-1a: a fixed, checkable order for a draw — the same for everyone who
 *  works it out, so a published draw can't be quietly re-rolled. */
function drawOrder(seed: string, key: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${seed}:${key}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export type RankOptions = {
  tieRule: TieRule;
  /** Fixes the draw, e.g. the day's id. */
  seed: string;
  /** Who can take a place (members only, unless guests can win). */
  eligible?: (e: ResultEntrant) => boolean;
};

export function rankEntrants(entrants: readonly ResultEntrant[], basis: RankBasis, opts: RankOptions): Ranking {
  const card = entrants[0]?.card ?? [];
  const n = card.length;
  const steps = countbackSteps(card);
  const better = basis === "stableford" ? 1 : -1; // Stableford: more is better
  const fig = new Map(entrants.map((e) => [e.key, figures(e, basis, steps)]));
  const show = (scaled: number) => (basis === "stroke" ? showNet(scaled, n) : String(scaled));

  const isEligible = (e: ResultEntrant) => (opts.eligible ? opts.eligible(e) : true);
  const ranked = entrants.filter((e) => fig.get(e.key)!.status === "ok" && isEligible(e));

  /** <0 when a finishes ahead of b; 0 when level after every step. */
  const cmp = (a: ResultEntrant, b: ResultEntrant): number => {
    const fa = fig.get(a.key)!;
    const fb = fig.get(b.key)!;
    if (fa.total !== fb.total) return better * (fb.total - fa.total);
    for (let i = 0; i < steps.length; i++) {
      if (fa.steps[i] !== fb.steps[i]) return better * (fb.steps[i] - fa.steps[i]);
    }
    return 0;
  };
  /** The first step that separates a and b, or -1. */
  const decider = (a: ResultEntrant, b: ResultEntrant): number => {
    const fa = fig.get(a.key)!;
    const fb = fig.get(b.key)!;
    return steps.findIndex((_, i) => fa.steps[i] !== fb.steps[i]);
  };

  ranked.sort((a, b) => cmp(a, b) || (opts.tieRule === "draw" ? drawOrder(opts.seed, a.key) - drawOrder(opts.seed, b.key) : a.name.localeCompare(b.name)));

  const rows: ResultRow[] = [];
  const ties: TieGroup[] = [];
  const base = (e: ResultEntrant): ResultRow => {
    const f = fig.get(e.key)!;
    return {
      key: e.key,
      name: e.name,
      detail: e.detail,
      memberIds: e.memberIds,
      guest: e.guest,
      handicap: e.handicap,
      roundId: e.roundId,
      group: e.group,
      certified: e.certified,
      status: f.status,
      thru: f.thru,
      score: f.status === "ok" ? show(f.total) : f.status === "nr" ? "NR" : `${f.thru}/${n}`,
      points: basis === "stableford" ? f.points : null,
      net: basis === "stroke" && f.status === "ok" ? showNet(f.total, n) : null,
      gross: f.gross,
      back: f.status === "ok" && steps.length > 0 ? show(f.steps[0]) : null,
      position: null,
      positionLabel: "",
      note: null,
      wonTie: false,
      tie: null,
      amended: e.amended ?? [],
    };
  };

  // Walk the order, grouping cards level on the total.
  let i = 0;
  while (i < ranked.length) {
    let j = i + 1;
    const ti = fig.get(ranked[i].key)!.total;
    while (j < ranked.length && fig.get(ranked[j].key)!.total === ti) j++;
    const group = ranked.slice(i, j);
    let tieIndex: number | null = null;
    if (group.length > 1) {
      tieIndex = ties.length;
      const firstDecided = new Set<number>();
      for (let k = 0; k + 1 < group.length; k++) firstDecided.add(decider(group[k], group[k + 1]));
      const allLevel = group.every((e, k) => k === 0 || cmp(group[k - 1], e) === 0);
      ties.push({
        total: show(ti),
        keys: group.map((e) => e.key),
        names: group.map((e) => e.name),
        steps: steps.map((s, si) => ({
          label: s.label,
          holes: range(s.holes),
          values: group.map((e) => show(fig.get(e.key)!.steps[si])),
          decided: firstDecided.has(si),
        })),
        resolvedBy: allLevel ? (opts.tieRule === "draw" ? "draw" : "shared") : "countback",
      });
    }
    group.forEach((e, k) => {
      const row = base(e);
      row.tie = tieIndex;
      // Position: shared only when level after every step and the rule shares.
      const prev = rows[rows.length - 1];
      const levelWithPrev = k > 0 && cmp(group[k - 1], e) === 0;
      row.position = levelWithPrev && opts.tieRule === "share" && prev?.position != null ? prev.position : rows.length + 1;
      if (group.length > 1) {
        const next = group[k + 1];
        const above = group[k - 1];
        if (next && cmp(e, next) !== 0) {
          const d = decider(e, next);
          row.wonTie = true;
          row.note = `Won on countback · ${steps[d].short}: ${show(fig.get(e.key)!.steps[d])} v ${show(fig.get(next.key)!.steps[d])}`;
        } else if (above && cmp(above, e) !== 0) {
          const d = decider(above, e);
          row.note = `Level on ${show(ti)} · lost on ${steps[d].short}`;
        }
        if ((next && cmp(e, next) === 0) || (above && cmp(above, e) === 0)) {
          row.note = opts.tieRule === "draw" ? "Level after every countback step · placed by draw" : "Level after every countback step · place shared";
        }
      }
      rows.push(row);
    });
    i = j;
  }
  // Shared positions read "=8" (on both).
  for (const r of rows) {
    const shared = rows.filter((o) => o.position === r.position).length > 1;
    r.positionLabel = `${shared ? "=" : ""}${r.position}`;
  }

  const unranked = entrants
    .filter((e) => !ranked.includes(e))
    .map((e) => {
      const row = base(e);
      row.positionLabel = row.status === "nr" ? "NR" : row.status === "out" ? "Out" : row.status === "dq" ? "DQ" : "Guest";
      if (row.status === "nr") row.note = "Picked up a hole: no return in stroke play";
      if (row.status === "dq") row.note = "Disqualified by the organiser";
      if (row.status === "ok" && !isEligible(e)) row.note = "Guests don't take places";
      return row;
    })
    .sort((a, b) => ["Guest", "Out", "NR", "DQ"].indexOf(a.positionLabel) - ["Guest", "Out", "NR", "DQ"].indexOf(b.positionLabel) || a.name.localeCompare(b.name));

  return { basis, rows: [...rows, ...unranked], ties };
}

// ---------------------------------------------------------------------------
// Divisions, prizes and the whole result
// ---------------------------------------------------------------------------

/** Even division cuts: the lowest handicap of division 2, 3… so the field
 *  splits as evenly as it can without splitting equal handicaps. */
export function evenCuts(handicaps: readonly number[], divisions: number): number[] {
  if (divisions <= 1 || handicaps.length === 0) return [];
  const sorted = [...handicaps].sort((a, b) => a - b);
  const cuts: number[] = [];
  for (let d = 1; d < divisions; d++) {
    const at = Math.round((sorted.length * d) / divisions);
    const cut = sorted[Math.min(at, sorted.length - 1)];
    if (cuts.length === 0 || cut > cuts[cuts.length - 1]) cuts.push(cut);
  }
  return cuts.filter((c) => c > sorted[0]);
}

export function divisionOf(handicap: number, cuts: readonly number[]): number {
  let d = 0;
  while (d < cuts.length && handicap >= cuts[d]) d++;
  return d;
}

function rangeLabel(d: number, cuts: readonly number[]): string | null {
  if (cuts.length === 0) return null;
  if (d === 0) return `up to ${cuts[0] - 1}`;
  if (d === cuts.length) return `${cuts[d - 1]} and over`;
  return `${cuts[d - 1]}–${cuts[d] - 1}`;
}

const PLACES = ["1st", "2nd", "3rd"];

export type BuildInput = {
  basis: ResultsBasis;
  /** Pairs or teams on one ball: no divisions, no best gross. */
  team: boolean;
  /** What a team is called: "Pairs" (foursomes) or "Teams" (scramble). */
  teamWord?: "Pairs" | "Teams";
  entrants: ResultEntrant[];
  settings: ResultsSettings;
  seed: string;
};

/**
 * The organiser's amendments, applied to copies of the entrants: a hole's
 * score replaced, or the card disqualified, each written up in words
 * ("Hole 7: 5 → 6 — signed for a 5, took 6") for the row and the summary.
 * An amendment to a card that isn't there, or that changes nothing, is
 * ignored.
 */
export function applyAmendments(entrants: readonly ResultEntrant[], amendments: readonly Amendment[]): ResultEntrant[] {
  return entrants.map((e) => {
    const mine = amendments.filter((a) => a.key === e.key);
    if (mine.length === 0) return e;
    const scores = { ...e.scores };
    const lines: string[] = [];
    let dq = false;
    const show = (v: number | null | undefined) => (v === undefined ? "no score" : v === null ? "picked up" : String(v));
    for (const a of mine) {
      const why = a.reason.trim() ? ` — ${a.reason.trim()}` : "";
      if (a.dq) {
        dq = true;
        lines.push(`Disqualified${why}`);
      } else if (a.hole != null && e.card.some((h) => h.hole === a.hole)) {
        const was = a.hole in e.scores ? e.scores[a.hole] : undefined;
        if (was === a.strokes) continue;
        scores[a.hole] = a.strokes;
        lines.push(`Hole ${a.hole}: ${show(was)} → ${show(a.strokes)}${why}`);
      }
    }
    if (lines.length === 0) return e;
    return { ...e, scores, dq, amended: lines };
  });
}

export function buildResults(input: BuildInput): Results {
  const { basis, team, settings, seed, teamWord } = input;
  const entrants = applyAmendments(input.entrants, settings.amendments ?? []);
  const holes = entrants[0]?.card.length ?? 18;
  const opts: RankOptions = { tieRule: settings.tieRule, seed, eligible: (e) => settings.guestsCanWin || !e.guest };
  const cuts = team ? [] : settings.divisionCuts;

  const divisions: Division[] = (cuts.length === 0 ? [0] : [...cuts.map((_, i) => i), cuts.length]).map((d) => ({
    label: cuts.length === 0 ? (team ? (teamWord ?? "Teams") : "Overall") : `Division ${d + 1}`,
    range: rangeLabel(d, cuts),
    ranking: rankEntrants(
      entrants.filter((e) => cuts.length === 0 || divisionOf(e.handicap, cuts) === d),
      basis,
      opts
    ),
  }));

  const prizes: Prize[] = [];
  const placed = new Set<string>();
  for (const d of divisions) {
    const top = d.ranking.rows.filter((r) => r.position != null && r.position <= 3);
    top.forEach((r) => placed.add(r.key));
    prizes.push({
      label: d.label,
      winners: top.map((r) => ({
        place: r.positionLabel.startsWith("=") ? `=${PLACES[r.position! - 1]}` : PLACES[r.position! - 1],
        name: r.name,
        detail: r.detail,
        score: basis === "stableford" ? `${r.score} pts` : `net ${r.score}`,
        note: r.note,
        memberIds: r.memberIds,
        amended: r.amended.length > 0,
      })),
    });
  }

  let bestGross: Ranking | null = null;
  if (!team && settings.bestGross) {
    bestGross = rankEntrants(entrants, "gross", {
      ...opts,
      eligible: (e) => opts.eligible!(e) && !(settings.onePrizePerPlayer && placed.has(e.key)),
    });
    const w = bestGross.rows.find((r) => r.position === 1);
    if (w) {
      const level = bestGross.rows.filter((r) => r.position === 1);
      prizes.push({
        label: "Best gross",
        winners: level.map((r) => ({ place: level.length > 1 ? "=1st" : "1st", name: r.name, detail: r.detail, score: `${r.gross} gross`, note: r.note, memberIds: r.memberIds, amended: r.amended.length > 0 })),
      });
    }
  }
  for (const x of settings.extras) {
    if (x.label.trim() && x.winner.trim()) prizes.push({ label: x.label.trim(), winners: [{ place: "", name: x.winner.trim(), detail: null, score: "", note: null, memberIds: [] }] });
  }

  // Checks before publishing.
  const allRows = divisions.flatMap((d) => d.ranking.rows);
  const out = allRows.filter((r) => r.status === "out");
  const nr = allRows.filter((r) => r.status === "nr");
  const placers = allRows.filter((r) => r.position != null && r.position <= 3);
  const uncertified = placers.filter((r) => r.certified === false);
  const siMissing = entrants.some((e) => e.card.some((h) => h.strokeIndex == null));
  const checks: Results["checks"] = [];
  if (out.length > 0) {
    checks.push({
      level: "stop",
      text: `${out.length} ${out.length === 1 ? "card isn't" : "cards aren't"} in yet: ${out.map((r) => `${r.name} (${r.thru} holes)`).join(", ")}. Publishing closes them as they stand — an unfinished card can't place.`,
    });
  }
  if (siMissing) checks.push({ level: "stop", text: "A card is missing stroke indexes, so shots — and countbacks — can't be worked out exactly. Fill them in on the card." });
  if (uncertified.length > 0) {
    checks.push({ level: "warn", text: `Not certified by a playing partner yet: ${uncertified.map((r) => r.name).join(", ")}.` });
  }
  if (nr.length > 0) checks.push({ level: "warn", text: `No return (picked up a hole in stroke play): ${nr.map((r) => r.name).join(", ")}.` });
  const amended = entrants.filter((e) => e.amended && e.amended.length > 0).map((e) => ({ name: e.name, lines: e.amended! }));
  if (amended.length > 0) {
    checks.push({ level: "warn", text: `${amended.length} ${amended.length === 1 ? "card is" : "cards are"} amended by you. They'll show as Amended, with what the players submitted.` });
  }
  if (checks.length === 0) checks.push({ level: "ok", text: "Every card is in, every hole has a stroke index, and every placed card is certified." });

  return {
    version: 1,
    basis,
    team,
    holes,
    tieRule: settings.tieRule,
    rule: ruleText(holes, settings.tieRule),
    divisions,
    bestGross,
    prizes,
    checks,
    amendments: amended,
    counts: {
      entrants: entrants.length,
      complete: allRows.filter((r) => r.status !== "out").length,
      out: out.length,
      nr: nr.length,
      uncertifiedPlacers: uncertified.length,
    },
  };
}

/** Where a member finished, for their notification and their results card. */
export function placeOf(results: Results, memberId: string): { division: string; row: ResultRow; of: number } | null {
  for (const d of results.divisions) {
    const row = d.ranking.rows.find((r) => r.memberIds.includes(memberId));
    if (row) return { division: d.label, row, of: d.ranking.rows.filter((r) => r.position != null).length };
  }
  return null;
}
