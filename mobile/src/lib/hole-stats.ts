/**
 * My Game, stage 2: the stats a member taps per hole (0178,
 * claude/my-game-stats.md) — tee shot, putts, which way they missed the
 * green, penalties — and what they add up to. Pure, so it's tested.
 *
 * Worked out, never tapped:
 *   - green in regulation: on in par − 2 or fewer, i.e. strokes − putts ≤ par − 2
 *   - par save (scrambling): missed the green in regulation, still made par or better
 *
 * Same honesty rules as scoring-patterns.ts: every figure carries its sample
 * and a read, and stays hidden below its minimum. Holes with no score (not
 * played, or picked up) don't count towards anything that needs the score.
 */
import { patternCards, type Figure, type PatternCard, type Read } from "./scoring-patterns";

export type TeeShot = "left" | "fairway" | "right";
export type GreenMiss = "short" | "long" | "left" | "right";

export type HoleStat = {
  hole: number;
  putts: number | null;
  tee: TeeShot | null;
  greenMiss: GreenMiss | null;
  penalties: number | null;
};

export const TEE_SHOTS: TeeShot[] = ["left", "fairway", "right"];
export const GREEN_MISSES: GreenMiss[] = ["short", "long", "left", "right"];

/** A card with the member's own stats on it, by hole. */
export type StatsCard = PatternCard & { stats: ReadonlyMap<number, HoleStat> };

/** Did they miss the green in regulation? Null until there's a score and putts. */
export function missedGreen(strokes: number | null, putts: number | null, par: number): boolean | null {
  if (strokes == null || putts == null || putts > strokes) return null;
  return strokes - putts > par - 2;
}

/** Tee shots count on par 4s and 5s only. */
export const hasTeeShot = (par: number) => par >= 4;

/** A hole with nothing tapped on it. */
export const isEmptyStat = (s: HoleStat | null | undefined) =>
  !s || (s.putts == null && s.tee == null && s.greenMiss == null && !s.penalties);

export const STAT_MINIMUMS = {
  fairways: { early: 14, good: 70, unit: "drives" },
  greens: { early: 18, good: 90, unit: "holes" },
  misses: { early: 10, good: 40, unit: "missed greens" },
  scrambling: { early: 10, good: 40, unit: "chances" },
  putting: { early: 18, good: 90, unit: "holes" },
  penalties: { early: 18, good: 90, unit: "holes" },
} as const;

type StatKey = keyof typeof STAT_MINIMUMS;

function figure<T>(key: StatKey, n: number, value: () => T): Figure<T> {
  const m = STAT_MINIMUMS[key];
  if (n < m.early) return { need: m.early - n, unit: m.unit };
  return { value: value(), n, read: n >= m.good ? "good" : "early" };
}

const pct = (a: number, b: number) => Math.round((a / b) * 100);
const perRound = (count: number, holes: number) => Math.round((count / holes) * 18 * 10) / 10;

export type StatsSummary = {
  /** Holes with anything tapped on them, and the cards they're on. */
  holes: number;
  rounds: number;
  /** Tee shots on par 4s and 5s: % fairway, and where the misses went. */
  tee: Figure<{ fairwayPct: number; leftPct: number; rightPct: number }>;
  /** Greens in regulation a round, and the share of holes. */
  greens: Figure<{ perRound: number; pct: number }>;
  /** Where missed greens finished, % of those tapped. */
  misses: Figure<Record<GreenMiss, number>>;
  /** Par or better after missing the green in regulation, %. */
  scrambling: Figure<number>;
  putting: Figure<{ perRound: number; threePutts: number; onePutts: number }>;
  penalties: Figure<number>;
};

type Joined = { par: number; strokes: number | null; stat: HoleStat };

export function statsSummary(cards: readonly StatsCard[], limit = 20): StatsSummary {
  // The same cards My Game's patterns use, newest first; then only holes with taps.
  const ids = new Set(patternCards(cards, limit).map((c) => c.id));
  const used = cards.filter((c) => ids.has(c.id));
  const joined: Joined[] = [];
  const withStats = new Set<number>();
  for (const c of used) {
    for (const h of c.holeList) {
      const stat = c.stats.get(h.hole);
      if (isEmptyStat(stat)) continue;
      joined.push({ par: h.par, strokes: h.strokes, stat: stat! });
      withStats.add(c.id);
    }
  }

  const tees = joined.filter((j) => hasTeeShot(j.par) && j.stat.tee != null);
  const tee = figure("fairways", tees.length, () => ({
    fairwayPct: pct(tees.filter((j) => j.stat.tee === "fairway").length, tees.length),
    leftPct: pct(tees.filter((j) => j.stat.tee === "left").length, tees.length),
    rightPct: pct(tees.filter((j) => j.stat.tee === "right").length, tees.length),
  }));

  const scored = joined.filter((j) => missedGreen(j.strokes, j.stat.putts, j.par) != null);
  const hit = scored.filter((j) => missedGreen(j.strokes, j.stat.putts, j.par) === false).length;
  const greens = figure("greens", scored.length, () => ({ perRound: perRound(hit, scored.length), pct: pct(hit, scored.length) }));

  const missed = joined.filter((j) => j.stat.greenMiss != null);
  const misses = figure("misses", missed.length, () => {
    const out = {} as Record<GreenMiss, number>;
    for (const m of GREEN_MISSES) out[m] = pct(missed.filter((j) => j.stat.greenMiss === m).length, missed.length);
    return out;
  });

  const chances = scored.filter((j) => missedGreen(j.strokes, j.stat.putts, j.par) === true);
  const scrambling = figure("scrambling", chances.length, () => pct(chances.filter((j) => (j.strokes as number) <= j.par).length, chances.length));

  const putted = joined.filter((j) => j.stat.putts != null);
  const putting = figure("putting", putted.length, () => ({
    perRound: perRound(putted.reduce((s, j) => s + (j.stat.putts as number), 0), putted.length),
    threePutts: perRound(putted.filter((j) => (j.stat.putts as number) >= 3).length, putted.length),
    onePutts: perRound(putted.filter((j) => j.stat.putts === 1).length, putted.length),
  }));

  const penalties = figure("penalties", joined.length, () => perRound(joined.reduce((s, j) => s + (j.stat.penalties ?? 0), 0), joined.length));

  return { holes: joined.length, rounds: withStats.size, tee, greens, misses, scrambling, putting, penalties };
}

export type StatInsight = { text: string; read: Read; basis: string };

/**
 * What the taps say, in plain words — only patterns strong enough to act
 * on, and only once their figure has reached its minimum.
 */
export function statInsights(s: StatsSummary): StatInsight[] {
  const out: StatInsight[] = [];
  if ("read" in s.misses) {
    const [dir, share] = (Object.entries(s.misses.value) as [GreenMiss, number][]).reduce((a, b) => (b[1] > a[1] ? b : a));
    if (share >= 50) {
      const tip = { short: "Take one more club into greens.", long: "Take one less club into greens.", left: "Check your aim and alignment.", right: "Check your aim and alignment." }[dir];
      out.push({ text: `${share}% of your missed greens finish ${dir}. ${tip}`, read: s.misses.read, basis: `${s.misses.n} missed greens` });
    }
  }
  if ("read" in s.tee) {
    const { leftPct, rightPct } = s.tee.value;
    const big = Math.max(leftPct, rightPct);
    const small = Math.min(leftPct, rightPct);
    if (big >= 20 && big >= small * 2) {
      out.push({ text: `Your tee shots miss ${leftPct > rightPct ? "left" : "right"} ${small === 0 ? "every time" : `${Math.round(big / small)} to 1`}.`, read: s.tee.read, basis: `${s.tee.n} drives` });
    }
  }
  if ("read" in s.putting && s.putting.value.threePutts >= 2) {
    out.push({ text: `${s.putting.value.threePutts} three-putts a round. Lag putting from distance is the quickest win.`, read: s.putting.read, basis: `${s.putting.n} holes` });
  }
  if ("read" in s.penalties && s.penalties.value >= 1) {
    out.push({ text: `${s.penalties.value} penalty ${s.penalties.value === 1 ? "shot" : "shots"} a round.`, read: s.penalties.read, basis: `${s.penalties.n} holes` });
  }
  return out;
}
