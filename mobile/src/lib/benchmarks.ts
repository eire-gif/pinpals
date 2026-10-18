/**
 * Published amateur averages by handicap, for My Game's comparisons
 * (stage 3, claude/my-game-stats.md, Oct 2026).
 *
 * One source for every figure, so the comparisons agree with each other:
 * Shot Scope's benchmark table of its members' rounds, by handicap 0–25
 * ("Traditional Statistics v Strokes Gained", Shot Scope e-book, chapter 1,
 * https://shotscope.com/ebook/Strokes_Gained.pdf). Shot Scope doesn't give
 * the sample size or dates in it. Its "Up & Down %" is closest to My Game's
 * par saves (par or better after missing the green in regulation), not
 * identical, and the screen says so.
 *
 * Between two published handicaps the figures are read off a straight line;
 * outside 0–25 the nearest end is used, and the screen says that too.
 *
 * Until PinPals has enough rounds of its own (claude/my-game-stats.md:
 * "PinPals' own benchmarks once data allows"), these are the yardstick.
 */

export type Benchmark = {
  /** Fairways hit, % of par 4 and 5 tee shots. */
  fairwayPct: number;
  /** Greens in regulation, % of holes. */
  girPct: number;
  /** Up and down after missing the green, %. */
  upDownPct: number;
  puttsPerRound: number;
  penaltiesPerRound: number;
};

export const BENCHMARK_SOURCE = {
  name: "Shot Scope",
  title: "Traditional Statistics v Strokes Gained",
  url: "https://shotscope.com/ebook/Strokes_Gained.pdf",
} as const;

/** The published rows, exactly as given. */
export const BENCHMARK_TABLE: { handicap: number; b: Benchmark }[] = [
  { handicap: 0, b: { fairwayPct: 50, girPct: 61, upDownPct: 47, puttsPerRound: 29.4, penaltiesPerRound: 0.56 } },
  { handicap: 5, b: { fairwayPct: 48, girPct: 44, upDownPct: 41, puttsPerRound: 30.2, penaltiesPerRound: 0.91 } },
  { handicap: 10, b: { fairwayPct: 49, girPct: 36, upDownPct: 31, puttsPerRound: 31.2, penaltiesPerRound: 1.62 } },
  { handicap: 15, b: { fairwayPct: 48, girPct: 24, upDownPct: 21, puttsPerRound: 33.1, penaltiesPerRound: 2.45 } },
  { handicap: 20, b: { fairwayPct: 46, girPct: 17, upDownPct: 20, puttsPerRound: 33.1, penaltiesPerRound: 3.03 } },
  { handicap: 25, b: { fairwayPct: 46, girPct: 10, upDownPct: 18, puttsPerRound: 33.8, penaltiesPerRound: 4.67 } },
];

export const BENCHMARK_MIN = 0;
export const BENCHMARK_MAX = 25;

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The averages for a handicap: published, or read between the two nearest. */
export function benchmarkFor(handicap: number): Benchmark & { clamped: boolean } {
  const h = Math.min(BENCHMARK_MAX, Math.max(BENCHMARK_MIN, handicap));
  const clamped = h !== handicap;
  const hi = BENCHMARK_TABLE.findIndex((r) => r.handicap >= h);
  const upper = BENCHMARK_TABLE[hi];
  if (upper.handicap === h || hi === 0) return { ...upper.b, clamped };
  const lower = BENCHMARK_TABLE[hi - 1];
  const t = (h - lower.handicap) / (upper.handicap - lower.handicap);
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    fairwayPct: round1(mix(lower.b.fairwayPct, upper.b.fairwayPct)),
    girPct: round1(mix(lower.b.girPct, upper.b.girPct)),
    upDownPct: round1(mix(lower.b.upDownPct, upper.b.upDownPct)),
    puttsPerRound: round1(mix(lower.b.puttsPerRound, upper.b.puttsPerRound)),
    penaltiesPerRound: round2(mix(lower.b.penaltiesPerRound, upper.b.penaltiesPerRound)),
    clamped,
  };
}

/** "a 12 handicapper", "a scratch golfer", "a plus handicapper". */
export function golferLabel(handicap: number): string {
  if (handicap < 0) return "a plus handicapper";
  if (handicap === 0) return "a scratch golfer";
  return `${[8, 11, 18].includes(Math.round(handicap)) ? "an" : "a"} ${Math.round(handicap)} handicapper`;
}
