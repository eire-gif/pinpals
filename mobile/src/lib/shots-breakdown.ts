/**
 * My Game, stage 3: where your shots go against your goal handicap
 * (claude/my-game-stats.md, Oct 2026). Pure, so it's tested.
 *
 * AN ESTIMATE, and the screen says so. From the member's own stats
 * (hole-stats.ts) and the published averages for their goal
 * (benchmarks.ts), four areas, in shots a round:
 *
 *   Approach   — greens you miss that a golfer at your goal would hit. Each
 *                costs about a shot, less the share they'd save anyway:
 *                (their greens − yours) × (1 − their up-and-down rate)
 *   Short game — of the greens you do miss, how many more (or fewer) you
 *                get up and down than they would:
 *                (their up-and-down rate − your par-save rate) × your missed greens
 *   Putting    — your putts a round − theirs
 *   Penalties  — your penalty shots a round − theirs
 *
 * Positive = shots lost to a golfer at your goal; negative = shots gained.
 * Tee shots get no shot figure: fairways hit barely differ by handicap in
 * the published table (46–50% from 25 to scratch), so a fairways gap isn't
 * a reliable measure of shots. They're shown as a comparison only.
 *
 * Each area appears only once the stats it rests on have reached their
 * minimum (hole-stats.ts), and carries the weakest of those reads.
 */
import { benchmarkFor, golferLabel, type Benchmark } from "./benchmarks";
import { isEmptyStat, statsSummary, type StatsCard, type StatsSummary } from "./hole-stats";
import type { Read } from "./scoring-patterns";

export type Area = "approach" | "shortGame" | "putting" | "penalties";

export const AREA_LABELS: Record<Area, string> = {
  approach: "Approach",
  shortGame: "Short game",
  putting: "Putting",
  penalties: "Penalties",
};

export type AreaResult = {
  area: Area;
  label: string;
  /** Shots a round lost (+) or gained (−) against the goal. */
  shots: number;
  read: Read;
  /** You and them, in the area's own terms. */
  detail: string;
};

export type Breakdown = {
  goal: number;
  goalLabel: string;
  bench: Benchmark & { clamped: boolean };
  areas: AreaResult[];
  /** Sum of the areas shown. */
  total: number;
  /** The area costing most, if it costs at least half a shot. */
  leak: AreaResult | null;
  tee: { yours: number; theirs: number; read: Read } | null;
};

const round1 = (x: number) => Math.round(x * 10) / 10;
const weakest = (...reads: Read[]): Read => (reads.includes("early") ? "early" : "good");

export function shotsBreakdown(s: StatsSummary, goal: number): Breakdown {
  const bench = benchmarkFor(goal);
  const theirGreens = (bench.girPct / 100) * 18;
  const theirUD = bench.upDownPct / 100;
  const who = golferLabel(goal);
  const areas: AreaResult[] = [];

  if ("read" in s.greens) {
    const yours = s.greens.value.perRound;
    areas.push({
      area: "approach",
      label: AREA_LABELS.approach,
      shots: round1((theirGreens - yours) * (1 - theirUD)),
      read: s.greens.read,
      detail: `${yours} greens a round · ${who} hits ${round1(theirGreens)}`,
    });
    if ("read" in s.scrambling) {
      const missed = 18 - yours;
      areas.push({
        area: "shortGame",
        label: AREA_LABELS.shortGame,
        shots: round1((theirUD - s.scrambling.value / 100) * missed),
        read: weakest(s.greens.read, s.scrambling.read),
        detail: `Par saved ${s.scrambling.value}% after missing · ${who} gets up and down ${Math.round(bench.upDownPct)}%`,
      });
    }
  }
  if ("read" in s.putting) {
    areas.push({
      area: "putting",
      label: AREA_LABELS.putting,
      shots: round1(s.putting.value.perRound - bench.puttsPerRound),
      read: s.putting.read,
      detail: `${s.putting.value.perRound} putts a round · ${who} takes ${bench.puttsPerRound}`,
    });
  }
  if ("read" in s.penalties) {
    areas.push({
      area: "penalties",
      label: AREA_LABELS.penalties,
      shots: round1(s.penalties.value - bench.penaltiesPerRound),
      read: s.penalties.read,
      detail: `${s.penalties.value} a round · ${who} has ${round1(bench.penaltiesPerRound)}`,
    });
  }

  const worst = areas.reduce<AreaResult | null>((a, b) => (a == null || b.shots > a.shots ? b : a), null);
  return {
    goal,
    goalLabel: who,
    bench,
    areas,
    total: round1(areas.reduce((t, a) => t + a.shots, 0)),
    leak: worst && worst.shots >= 0.5 ? worst : null,
    tee: "read" in s.tee ? { yours: s.tee.value.fairwayPct, theirs: Math.round(bench.fairwayPct), read: s.tee.read } : null,
  };
}

// ---------------------------------------------------------------------------
// The practice focus
// ---------------------------------------------------------------------------

export type Focus = {
  area: Area;
  title: string;
  drill: string;
  /** What to move, from where to where. Lower is better unless `higherIsBetter`. */
  target: { label: string; now: number; goal: number; unit: string; higherIsBetter: boolean };
  /** Where Training covers it (claude/training.md): a drill, a lie guide or the Putting Lab. */
  train?: { label: string; to: string };
};

/** One thing to practise, for the biggest leak, with a number to move. */
export function practiceFocus(b: Breakdown, s: StatsSummary): Focus | null {
  const leak = b.leak;
  if (!leak) return null;
  const bench = b.bench;

  if (leak.area === "approach" && "read" in s.greens) {
    const theirGreens = round1((bench.girPct / 100) * 18);
    const misses = "read" in s.misses ? s.misses.value : null;
    const greens = { label: "Greens in regulation a round", now: s.greens.value.perRound, goal: theirGreens, unit: "", higherIsBetter: true };
    if (misses && misses.short >= 50) {
      return {
        area: "approach",
        title: "Approach distance control",
        drill: "Ladder drill: 10 balls each to 100, 125 and 150 yards. Count how many finish within 10 yards of the number — past it counts, short doesn't. On the course, take one more club when you're between two.",
        target: { label: "Missed greens that finish short", now: misses.short, goal: 50, unit: "%", higherIsBetter: false },
      };
    }
    if (misses && misses.long >= 50) {
      return {
        area: "approach",
        title: "Club down into greens",
        drill: "Hit 10 balls each at three distances aiming to land on the front third of the green. On the course, play to the middle and take one less club when in doubt.",
        target: greens,
      };
    }
    return {
      area: "approach",
      title: "Start line on approach shots",
      drill: "Lay a club down on your target line. Hit 20 mid-irons, counting how many start inside two club-widths of it. Then 10 balls to a target green, counting greens hit.",
      target: greens,
    };
  }

  if (leak.area === "shortGame" && "read" in s.scrambling) {
    return {
      area: "shortGame",
      title: "Up and down from around the green",
      drill: "Pick three spots off the practice green — a short chip, a longer one, a bunker if there is one. Ten balls from each, and play every one out. Count how many you get down in two.",
      target: { label: "Par saved after missing the green", now: s.scrambling.value, goal: Math.round(bench.upDownPct), unit: "%", higherIsBetter: true },
      train: { label: "Bunker and lie guides in Training", to: "/train/lies" },
    };
  }

  if (leak.area === "putting" && "read" in s.putting) {
    const lag = s.putting.value.threePutts >= 1.5;
    return {
      area: "putting",
      title: lag ? "Lag putting" : "Holing out from 3–6 feet",
      drill: lag
        ? "From 30, 40 and 50 feet, five balls each: every one must finish inside three feet (a putter length). Start again from 30 if one doesn't."
        : "Ten balls in a circle at 3 feet, then at 5 feet. Hole every one before you move back.",
      target: lag
        ? { label: "Three-putts a round", now: s.putting.value.threePutts, goal: Math.max(0.5, round1(s.putting.value.threePutts / 2)), unit: "", higherIsBetter: false }
        : { label: "Putts a round", now: s.putting.value.perRound, goal: bench.puttsPerRound, unit: "", higherIsBetter: false },
      train: lag ? { label: "Ladder lag in the Putting Lab", to: "/train/drill/ladder-lag" } : { label: "Clock drill in the Putting Lab", to: "/train/drill/clock" },
    };
  }

  if (leak.area === "penalties" && "read" in s.penalties) {
    return {
      area: "penalties",
      title: "Keep it in play",
      drill: "Before each round, note the holes where you've lost a ball or gone in the water. On those, tee off with the club you're surest of keeping in play — even if it's an iron.",
      target: { label: "Penalty shots a round", now: s.penalties.value, goal: round1(bench.penaltiesPerRound), unit: "", higherIsBetter: false },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Am I getting better? Last 5 rounds with stats against the 5 before.
// ---------------------------------------------------------------------------

export type AreaTrend = { area: Area; label: string; better: number };

/** Per area, shots better (+) or worse (−) a round, newest 5 rounds with stats against the 5 before. */
export function areaTrend(cards: readonly StatsCard[], goal: number): AreaTrend[] {
  const withStats = cards
    .filter((c) => c.teamCard == null && c.holeList.some((h) => !isEmptyStat(c.stats.get(h.hole))))
    .slice()
    .sort((a, b) => (a.playedOn === b.playedOn ? b.id - a.id : a.playedOn < b.playedOn ? 1 : -1));
  if (withStats.length < 10) return [];
  const recent = shotsBreakdown(statsSummary(withStats.slice(0, 5), 5), goal);
  const before = shotsBreakdown(statsSummary(withStats.slice(5, 10), 5), goal);
  const out: AreaTrend[] = [];
  for (const r of recent.areas) {
    const b = before.areas.find((x) => x.area === r.area);
    if (b) out.push({ area: r.area, label: r.label, better: round1(b.shots - r.shots) });
  }
  return out;
}

/** The goal to start from: three shots better than the handicap they play off, never below scratch. */
export function defaultGoal(ownHandicap: number | null): number {
  if (ownHandicap == null) return 18;
  return Math.max(0, Math.round(ownHandicap) - 3);
}
