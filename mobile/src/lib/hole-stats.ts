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

/** How far the first putt was, in feet (0179) — tapped once there are putts. */
export type FirstPutt = "0-3" | "3-6" | "6-10" | "10-20" | "20-30" | "30+";

export type HoleStat = {
  hole: number;
  putts: number | null;
  tee: TeeShot | null;
  greenMiss: GreenMiss | null;
  penalties: number | null;
  /** Optional so stats saved before 0179, and older builds' queued saves, still read. */
  firstPutt?: FirstPutt | null;
};

export const TEE_SHOTS: TeeShot[] = ["left", "fairway", "right"];
export const GREEN_MISSES: GreenMiss[] = ["short", "long", "left", "right"];
export const FIRST_PUTTS: { id: FirstPutt; label: string; long: string }[] = [
  { id: "0-3", label: "<3", long: "under 3ft" },
  { id: "3-6", label: "3–6", long: "3–6ft" },
  { id: "6-10", label: "6–10", long: "6–10ft" },
  { id: "10-20", label: "10–20", long: "10–20ft" },
  { id: "20-30", label: "20–30", long: "20–30ft" },
  { id: "30+", label: "30+", long: "30ft+" },
];
export const isFirstPutt = (v: unknown): v is FirstPutt => FIRST_PUTTS.some((f) => f.id === v);

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
  !s || (s.putts == null && s.tee == null && s.greenMiss == null && !s.penalties && s.firstPutt == null);

export const STAT_MINIMUMS = {
  fairways: { early: 14, good: 70, unit: "drives" },
  greens: { early: 18, good: 90, unit: "holes" },
  misses: { early: 10, good: 40, unit: "missed greens" },
  scrambling: { early: 10, good: 40, unit: "chances" },
  putting: { early: 18, good: 90, unit: "holes" },
  /** Per distance band, so each band needs its own handful before it shows. */
  firstPutt: { early: 5, good: 25, unit: "putts" },
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
  /** By first-putt distance (0179): % holed with the first putt, and % three-putted. Bands below their minimum are left out. */
  byDistance: Figure<{ band: FirstPutt; label: string; n: number; holedPct: number; threePuttPct: number }[]>;
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

  const measured = putted.filter((j) => j.stat.firstPutt != null && j.stat.putts! >= 1);
  const bands = FIRST_PUTTS.map((f) => {
    const in_ = measured.filter((j) => j.stat.firstPutt === f.id);
    return { band: f.id, label: f.long, n: in_.length, holedPct: in_.length ? pct(in_.filter((j) => j.stat.putts === 1).length, in_.length) : 0, threePuttPct: in_.length ? pct(in_.filter((j) => j.stat.putts! >= 3).length, in_.length) : 0 };
  }).filter((b) => b.n >= STAT_MINIMUMS.firstPutt.early);
  // Shown once any band has enough putts; the read follows the total measured.
  const byDistance: StatsSummary["byDistance"] =
    bands.length === 0 ? { need: STAT_MINIMUMS.firstPutt.early - Math.max(0, ...FIRST_PUTTS.map((f) => measured.filter((j) => j.stat.firstPutt === f.id).length)), unit: STAT_MINIMUMS.firstPutt.unit } : { value: bands, n: measured.length, read: measured.length >= STAT_MINIMUMS.putting.good ? "good" : "early" };

  const penalties = figure("penalties", joined.length, () => perRound(joined.reduce((s, j) => s + (j.stat.penalties ?? 0), 0), joined.length));

  return { holes: joined.length, rounds: withStats.size, tee, greens, misses, scrambling, putting, byDistance, penalties };
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
  if ("read" in s.byDistance) {
    const worst = [...s.byDistance.value].sort((a, b) => b.threePuttPct - a.threePuttPct)[0];
    if (worst && worst.threePuttPct >= 15) {
      out.push({ text: `${worst.threePuttPct}% of your putts from ${worst.label} end in a three-putt. The Putting Lab's Ladder lag works on exactly that.`, read: s.byDistance.read, basis: `${worst.n} putts from ${worst.label}` });
    }
  }
  if ("read" in s.penalties && s.penalties.value >= 1) {
    out.push({ text: `${s.penalties.value} penalty ${s.penalties.value === 1 ? "shot" : "shots"} a round.`, read: s.penalties.read, basis: `${s.penalties.n} holes` });
  }
  return out;
}
