import { describe, expect, it } from "vitest";

import { BENCHMARK_TABLE, benchmarkFor, golferLabel } from "./benchmarks";
import { statsSummary, type HoleStat, type StatsCard, type StatsSummary } from "./hole-stats";
import { areaTrend, defaultGoal, practiceFocus, shotsBreakdown } from "./shots-breakdown";

describe("the published averages", () => {
  it("are used exactly at a published handicap", () => {
    expect(benchmarkFor(15)).toMatchObject({ ...BENCHMARK_TABLE.find((r) => r.handicap === 15)!.b, clamped: false });
  });

  it("are read off a straight line between two", () => {
    // 12 = two fifths of the way from 10 to 15.
    const b = benchmarkFor(12);
    expect(b.girPct).toBe(31.2); // 36 → 24
    expect(b.puttsPerRound).toBe(32); // 31.2 → 33.1
    expect(b.upDownPct).toBe(27); // 31 → 21
    expect(b.penaltiesPerRound).toBe(1.95); // 1.62 → 2.45
  });

  it("stop at scratch and 25, and say so", () => {
    expect(benchmarkFor(30)).toMatchObject({ girPct: 10, clamped: true });
    expect(benchmarkFor(-2)).toMatchObject({ girPct: 61, clamped: true });
  });

  it("name the golfer naturally", () => {
    expect(golferLabel(12)).toBe("a 12 handicapper");
    expect(golferLabel(18)).toBe("an 18 handicapper");
    expect(golferLabel(0)).toBe("a scratch golfer");
  });
});

/** A summary as the stats engine would give it, all good reads. */
function summary(over: Partial<{ greens: number; scramble: number; putts: number; threePutts: number; pens: number; short: number; fairway: number }> = {}): StatsSummary {
  const o = { greens: 4, scramble: 20, putts: 33, threePutts: 2, pens: 2, short: 71, fairway: 45, ...over };
  const m = (value: unknown) => ({ value, n: 100, read: "good" as const });
  return {
    holes: 180,
    rounds: 10,
    tee: m({ fairwayPct: o.fairway, leftPct: 40, rightPct: 15 }) as StatsSummary["tee"],
    greens: m({ perRound: o.greens, pct: Math.round((o.greens / 18) * 100) }) as StatsSummary["greens"],
    misses: m({ short: o.short, long: 10, left: 10, right: 100 - o.short - 20 }) as StatsSummary["misses"],
    scrambling: m(o.scramble) as StatsSummary["scrambling"],
    putting: m({ perRound: o.putts, threePutts: o.threePutts, onePutts: 4 }) as StatsSummary["putting"],
    byDistance: { need: 5, unit: "putts" },
    penalties: m(o.pens) as StatsSummary["penalties"],
  };
}

describe("where your shots go", () => {
  const b = shotsBreakdown(summary(), 12);

  it("works out each area against the goal", () => {
    const by = Object.fromEntries(b.areas.map((a) => [a.area, a.shots]));
    // Approach: (31.2% of 18 = 5.6 − 4) × (1 − 0.27) = 1.2
    expect(by.approach).toBeCloseTo(1.2, 1);
    // Short game: (0.27 − 0.20) × 14 missed = 1.0
    expect(by.shortGame).toBeCloseTo(1.0, 1);
    // Putting: 33 − 32 = 1.0; penalties: 2 − 1.95 = 0.1 (rounded)
    expect(by.putting).toBe(1);
    expect(by.penalties).toBe(0.1);
    expect(b.total).toBeCloseTo(3.3, 1);
  });

  it("names the biggest leak, and nothing when nothing's worth half a shot", () => {
    expect(b.leak?.area).toBe("approach");
    const tidy = shotsBreakdown(summary({ greens: 5.6, scramble: 27, putts: 32, pens: 2 }), 12);
    expect(tidy.leak).toBeNull();
  });

  it("compares fairways without turning them into shots", () => {
    expect(b.tee).toEqual({ yours: 45, theirs: 49, read: "good" });
    expect(b.areas.some((a) => (a.area as string) === "tee")).toBe(false);
  });

  it("leaves out an area until its stats are in", () => {
    const s = { ...summary(), scrambling: { need: 5, unit: "chances" } } as StatsSummary;
    expect(shotsBreakdown(s, 12).areas.map((a) => a.area)).toEqual(["approach", "putting", "penalties"]);
  });
});

describe("the model against the published table", () => {
  it("accounts for most of the gap between two handicaps, never more", () => {
    // A golfer exactly at Shot Scope's 15-handicap averages, aiming for 10.
    const at15 = BENCHMARK_TABLE.find((r) => r.handicap === 15)!.b;
    const s = summary({ greens: (at15.girPct / 100) * 18, scramble: at15.upDownPct, putts: at15.puttsPerRound, pens: at15.penaltiesPerRound });
    const total = shotsBreakdown(s, 10).total;
    // Their scores to par differ by 6.5 (+17.38 v +10.88); these four areas explain most of it.
    expect(total).toBeGreaterThan(4.5);
    expect(total).toBeLessThan(6.5);
  });
});

describe("the practice focus", () => {
  it("is distance control when most missed greens are short", () => {
    const s = summary();
    const f = practiceFocus(shotsBreakdown(s, 12), s)!;
    expect(f.title).toBe("Approach distance control");
    expect(f.target).toMatchObject({ now: 71, goal: 50, unit: "%", higherIsBetter: false });
  });

  it("follows the leak to the short game, putting or penalties", () => {
    const sg = summary({ greens: 5.6, scramble: 5 });
    expect(practiceFocus(shotsBreakdown(sg, 12), sg)!.area).toBe("shortGame");
    const putt = summary({ greens: 5.6, scramble: 27, putts: 36, threePutts: 3 });
    expect(practiceFocus(shotsBreakdown(putt, 12), putt)!.title).toBe("Lag putting");
    const pens = summary({ greens: 5.6, scramble: 27, putts: 32, pens: 5 });
    expect(practiceFocus(shotsBreakdown(pens, 12), pens)!.target).toMatchObject({ label: "Penalty shots a round", now: 5, goal: 2 });
  });

  it("isn't offered without a leak", () => {
    const s = summary({ greens: 5.6, scramble: 27, putts: 32, pens: 2 });
    expect(practiceFocus(shotsBreakdown(s, 12), s)).toBeNull();
  });
});

describe("am I getting better", () => {
  let id = 1;
  const round = (date: string, putts: number): StatsCard => {
    const stats = new Map<number, HoleStat>();
    for (let h = 1; h <= 18; h++) stats.set(h, { hole: h, putts, tee: null, greenMiss: null, penalties: null });
    return {
      id: id++,
      clubId: 1,
      courseName: "Portmarnock",
      teeName: null,
      holes: 18,
      playedOn: date,
      teamCard: null,
      holeList: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1, strokes: 2 + putts })),
      stats,
    };
  };

  it("needs ten rounds with stats", () => {
    expect(areaTrend([round("2026-10-01", 2)], 12)).toEqual([]);
  });

  it("compares the newest five with the five before", () => {
    // Older five: 2 putts a hole (36 a round); newer five: 1 a hole (18).
    const older = Array.from({ length: 5 }, (_, i) => round(`2026-09-0${i + 1}`, 2));
    const newer = Array.from({ length: 5 }, (_, i) => round(`2026-10-0${i + 1}`, 1));
    const t = areaTrend([...older, ...newer], 12);
    const putting = t.find((a) => a.area === "putting")!;
    expect(putting.better).toBe(18); // 36 putts a round down to 18
    expect(statsSummary(newer, 5).rounds).toBe(5);
  });
});

describe("the starting goal", () => {
  it("is three better than your handicap, not below scratch", () => {
    expect(defaultGoal(15.4)).toBe(12);
    expect(defaultGoal(2)).toBe(0);
    expect(defaultGoal(null)).toBe(18);
  });
});
