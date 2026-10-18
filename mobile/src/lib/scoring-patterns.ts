/**
 * My Game, stage 1: scoring patterns (claude/my-game-stats.md, Oct 2026).
 *
 * Everything here comes from the scores members already keep — par, stroke
 * index and strokes per hole on their scorecards — so it needs no new taps.
 * Pure (no React, no Supabase) so it is tested in mobile/src/lib.
 *
 * Honesty rules, which the screen relies on:
 *   - Every figure carries the sample it rests on, and a read: "early" once
 *     there's enough to say anything, "good" once there's enough to trust it.
 *     Below the minimum it is null and the screen says how much more is needed.
 *   - A hole with no score (not played yet, or picked up) is left out: we
 *     can't know what it would have been. Team cards (foursomes, greensomes,
 *     scramble: one ball for a pair or team) are left out entirely.
 *   - "Over par" is gross, against the card's par. Nothing is adjusted for
 *     handicap, so a figure means the same thing to everyone reading it.
 */

export type PatternHole = {
  hole: number;
  par: number;
  strokeIndex: number | null;
  strokes: number | null;
};

export type PatternCard = {
  id: number;
  clubId: number | null;
  courseName: string;
  teeName: string | null;
  holes: 9 | 18;
  /** YYYY-MM-DD */
  playedOn: string;
  teamCard: string | null;
  holeList: PatternHole[];
};

export type Read = "early" | "good";

/** A figure and how sure it is. */
export type Measured<T> = { value: T; n: number; read: Read };

/** A figure there isn't enough for yet. */
export type NotYet = { need: number; unit: string };

export type Figure<T> = Measured<T> | NotYet;

export const isMeasured = <T>(f: Figure<T>): f is Measured<T> => (f as Measured<T>).read !== undefined;

/**
 * How much each figure needs. `early`: the least we'll show at all; `good`:
 * when we stop calling it early. Counts are of the thing averaged — holes,
 * rounds or chances — named in `unit`.
 */
export const MINIMUMS = {
  parType: { early: 9, good: 36, unit: "holes" },
  difficulty: { early: 9, good: 36, unit: "holes" },
  start: { early: 4, good: 10, unit: "rounds" },
  nines: { early: 3, good: 8, unit: "full rounds" },
  doubles: { early: 36, good: 180, unit: "holes" },
  bounceBack: { early: 5, good: 20, unit: "doubles" },
  courseRounds: { early: 3, good: 6, unit: "rounds" },
  courseHole: { early: 2, good: 4, unit: "rounds" },
} as const;

type MinKey = keyof typeof MINIMUMS;

function figure<T>(key: MinKey, n: number, value: () => T): Figure<T> {
  const m = MINIMUMS[key];
  if (n < m.early) return { need: m.early - n, unit: m.unit };
  return { value: value(), n, read: n >= m.good ? "good" : "early" };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

type Played = PatternHole & { strokes: number };
const played = (h: PatternHole): h is Played => h.strokes != null && h.strokes > 0 && h.par >= 3 && h.par <= 6;

/** Newest first, team cards out, at most `limit` cards that have a score on them. */
export function patternCards(cards: readonly PatternCard[], limit = 20): PatternCard[] {
  return cards
    .filter((c) => c.teamCard == null && c.holeList.some(played))
    .slice()
    .sort((a, b) => (a.playedOn === b.playedOn ? b.id - a.id : a.playedOn < b.playedOn ? 1 : -1))
    .slice(0, limit);
}

export type ParTypeRow = { par: 3 | 4 | 5; avgOver: Figure<number> };
export type DifficultyRow = { band: "hardest" | "middle" | "easiest"; label: string; avgOver: Figure<number> };

export type CourseHeat = {
  key: string;
  courseName: string;
  clubId: number | null;
  rounds: number;
  read: Read;
  /** Hole by hole; null where it hasn't been played often enough. */
  holes: { hole: number; par: number | null; avgOver: number | null; plays: number }[];
};

export type Insight = { text: string; read: Read; basis: string };

export type ScoringPatterns = {
  rounds: number;
  holes: number;
  /** Average strokes over par, by the hole's par. */
  byPar: ParTypeRow[];
  /** Average over par on the hardest (SI 1–6), middle and easiest holes. */
  byDifficulty: DifficultyRow[];
  /** Holes 1–3 against the rest, per hole over par. */
  start: Figure<{ firstThree: number; rest: number; extra: number }>;
  /** Full 18-hole rounds: average strokes on each nine, and the gap. */
  nines: Figure<{ front: number; back: number; gap: number }>;
  /** Double bogey or worse, per 18 holes. */
  doublesPerRound: Figure<number>;
  /** Share (0–100) of holes straight after a double where you made par or better. */
  bounceBack: Figure<number>;
  /** The course you've played most, hole by hole — if it's enough. */
  course: CourseHeat | NotYet | null;
  /** Up to three plain-English findings, strongest first. */
  insights: Insight[];
};

const courseKey = (c: PatternCard) => (c.clubId != null ? `club:${c.clubId}:${(c.courseName || "").toLowerCase()}` : `name:${(c.courseName || "").toLowerCase()}`);

export function scoringPatterns(input: readonly PatternCard[], limit = 20): ScoringPatterns {
  const cards = patternCards(input, limit);
  const all: Played[] = cards.flatMap((c) => c.holeList.filter(played));

  // ---- by par ----
  const byPar: ParTypeRow[] = ([3, 4, 5] as const).map((par) => {
    const hs = all.filter((h) => h.par === par);
    return { par, avgOver: figure("parType", hs.length, () => round1(mean(hs.map((h) => h.strokes - h.par)))) };
  });

  // ---- by difficulty (stroke index) ----
  const bands = [
    { band: "hardest" as const, label: "Hardest holes (SI 1–6)", lo: 1, hi: 6 },
    { band: "middle" as const, label: "Middle holes (SI 7–12)", lo: 7, hi: 12 },
    { band: "easiest" as const, label: "Easiest holes (SI 13–18)", lo: 13, hi: 18 },
  ];
  const byDifficulty: DifficultyRow[] = bands.map((b) => {
    const hs = all.filter((h) => h.strokeIndex != null && h.strokeIndex >= b.lo && h.strokeIndex <= b.hi);
    return { band: b.band, label: b.label, avgOver: figure("difficulty", hs.length, () => round1(mean(hs.map((h) => h.strokes - h.par)))) };
  });

  // ---- the start: holes 1–3 against the rest, rounds with all of 1–3 scored ----
  const startRounds = cards.filter((c) => [1, 2, 3].every((n) => c.holeList.some((h) => h.hole === n && played(h))) && c.holeList.filter(played).length >= 6);
  const start = figure("start", startRounds.length, () => {
    const first = startRounds.flatMap((c) => c.holeList.filter((h) => played(h) && h.hole <= 3) as Played[]);
    const rest = startRounds.flatMap((c) => c.holeList.filter((h) => played(h) && h.hole > 3) as Played[]);
    const f = mean(first.map((h) => h.strokes - h.par));
    const r = mean(rest.map((h) => h.strokes - h.par));
    return { firstThree: round1(f), rest: round1(r), extra: round1((f - r) * 3) };
  });

  // ---- front and back nine, full 18-hole rounds ----
  const fulls = cards.filter((c) => c.holes === 18 && Array.from({ length: 18 }, (_, i) => i + 1).every((n) => c.holeList.some((h) => h.hole === n && played(h))));
  const nines = figure("nines", fulls.length, () => {
    const nine = (c: PatternCard, back: boolean) =>
      c.holeList.filter((h) => played(h) && (back ? h.hole > 9 : h.hole <= 9)).reduce((s, h) => s + (h.strokes as number), 0);
    const front = round1(mean(fulls.map((c) => nine(c, false))));
    const back = round1(mean(fulls.map((c) => nine(c, true))));
    return { front, back, gap: round1(back - front) };
  });

  // ---- doubles ----
  const doubles = all.filter((h) => h.strokes - h.par >= 2).length;
  const doublesPerRound = figure("doubles", all.length, () => round1((doubles / all.length) * 18));

  // ---- bounce back: the next hole played on the same card after a double ----
  let chances = 0;
  let bounced = 0;
  for (const c of cards) {
    const hs = c.holeList.filter(played).sort((a, b) => a.hole - b.hole);
    for (let i = 0; i < hs.length - 1; i++) {
      if (hs[i].strokes - hs[i].par < 2 || hs[i + 1].hole !== hs[i].hole + 1) continue;
      chances += 1;
      if (hs[i + 1].strokes <= hs[i + 1].par) bounced += 1;
    }
  }
  const bounceBack = figure("bounceBack", chances, () => Math.round((bounced / chances) * 100));

  // ---- the course you play most ----
  const byCourse = new Map<string, PatternCard[]>();
  for (const c of cards) byCourse.set(courseKey(c), [...(byCourse.get(courseKey(c)) ?? []), c]);
  let course: ScoringPatterns["course"] = null;
  const most = [...byCourse.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (most) {
    const [key, cs] = most;
    const m = MINIMUMS.courseRounds;
    if (cs.length < m.early) {
      course = { need: m.early - cs.length, unit: `${m.unit} at one course` };
    } else {
      const holeNos = [...new Set(cs.flatMap((c) => c.holeList.map((h) => h.hole)))].sort((a, b) => a - b);
      course = {
        key,
        courseName: cs[0].courseName,
        clubId: cs[0].clubId,
        rounds: cs.length,
        read: cs.length >= m.good ? "good" : "early",
        holes: holeNos.map((n) => {
          const plays = cs.flatMap((c) => c.holeList.filter((h) => h.hole === n && played(h)) as Played[]);
          const par = plays[0]?.par ?? cs.flatMap((c) => c.holeList).find((h) => h.hole === n)?.par ?? null;
          return {
            hole: n,
            par,
            plays: plays.length,
            avgOver: plays.length >= MINIMUMS.courseHole.early ? round1(mean(plays.map((h) => h.strokes - h.par))) : null,
          };
        }),
      };
    }
  }

  const result: Omit<ScoringPatterns, "insights"> = {
    rounds: cards.length,
    holes: all.length,
    byPar,
    byDifficulty,
    start,
    nines,
    doublesPerRound,
    bounceBack,
    course,
  };
  return { ...result, insights: insightsFrom(result) };
}

/**
 * Plain-English findings, strongest first. Each says only what its figure
 * shows, and only once that figure has reached its minimum. Shots are per
 * round so they can be compared with each other.
 */
export function insightsFrom(p: Omit<ScoringPatterns, "insights">): Insight[] {
  const out: { cost: number; insight: Insight }[] = [];

  // A par type well above the others. Cost: the gap × that par type's holes in a typical round (4/10/4).
  const parRows = p.byPar.filter((r) => isMeasured(r.avgOver)) as { par: 3 | 4 | 5; avgOver: Measured<number> }[];
  if (parRows.length >= 2) {
    const worst = parRows.reduce((a, b) => (b.avgOver.value > a.avgOver.value ? b : a));
    const others = parRows.filter((r) => r !== worst);
    const otherAvg = mean(others.map((r) => r.avgOver.value));
    const gap = worst.avgOver.value - otherAvg;
    const perRound = { 3: 4, 4: 10, 5: 4 }[worst.par];
    if (gap >= 0.3) {
      out.push({
        cost: gap * perRound,
        insight: {
          text: `Par ${worst.par}s are your weakest holes: ${fmtOver(worst.avgOver.value)} each, against ${fmtOver(round1(otherAvg))} on the others.`,
          read: worst.avgOver.read,
          basis: `${worst.avgOver.n} par ${worst.par}s`,
        },
      });
    }
  }

  if (isMeasured(p.start) && p.start.value.extra >= 1) {
    out.push({
      cost: p.start.value.extra,
      insight: {
        text: `Slow starter: holes 1–3 cost you about ${p.start.value.extra} ${p.start.value.extra === 1 ? "shot" : "shots"} more than your usual pace would.`,
        read: p.start.read,
        basis: `${p.start.n} rounds`,
      },
    });
  }

  if (isMeasured(p.nines) && Math.abs(p.nines.value.gap) >= 1.5) {
    const back = p.nines.value.gap > 0;
    out.push({
      cost: Math.abs(p.nines.value.gap),
      insight: {
        text: back
          ? `You fade on the back nine: ${p.nines.value.back} against ${p.nines.value.front} on the front.`
          : `Your front nine is the costly one: ${p.nines.value.front} against ${p.nines.value.back} on the back.`,
        read: p.nines.read,
        basis: `${p.nines.n} full rounds`,
      },
    });
  }

  if (isMeasured(p.doublesPerRound) && p.doublesPerRound.value >= 2) {
    // Each double is at least one shot more than a bogey; count that shot.
    out.push({
      cost: p.doublesPerRound.value * 0.9,
      insight: {
        text: `Doubles or worse: ${p.doublesPerRound.value} a round. Turning half of them into bogeys is worth about ${round1(p.doublesPerRound.value / 2)} shots.`,
        read: p.doublesPerRound.read,
        basis: `${p.doublesPerRound.n} holes`,
      },
    });
  }

  if (isMeasured(p.bounceBack) && p.bounceBack.value < 30) {
    // No shot cost to measure here; ranked below anything that has one.
    out.push({
      cost: 0.5,
      insight: {
        text: `After a double you make par or better ${p.bounceBack.value}% of the time — one bad hole often turns into two.`,
        read: p.bounceBack.read,
        basis: `${p.bounceBack.n} doubles`,
      },
    });
  }

  return out
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3)
    .map((o) => o.insight);
}

/** "+1.2", "−0.3", "level" — over par on a hole. */
export function fmtOver(x: number): string {
  if (x === 0) return "level";
  return x > 0 ? `+${x.toFixed(1)}` : `−${Math.abs(x).toFixed(1)}`;
}

/** "Early read · 6 rounds" / "Good read · 140 holes". */
export function readLabel(f: Measured<unknown>, unit: string): string {
  return `${f.read === "good" ? "Good read" : "Early read"} · ${f.n} ${unit}`;
}

/** "3 more full rounds to show this". */
export function notYetLabel(f: NotYet): string {
  return `${f.need} more ${f.unit} to show this`;
}

/** The heatmap's four shades, by average over par on a hole. */
export function heatLevel(avgOver: number | null): 0 | 1 | 2 | 3 | 4 {
  if (avgOver == null) return 0;
  if (avgOver < 0.5) return 1;
  if (avgOver < 1) return 2;
  if (avgOver < 1.5) return 3;
  return 4;
}
