import { describe, expect, it } from "vitest";

import {
  fmtOver,
  heatLevel,
  isMeasured,
  notYetLabel,
  patternCards,
  readLabel,
  scoringPatterns,
  type Measured,
  type NotYet,
  type PatternCard,
} from "./scoring-patterns";

// A par-72 card: 4 par 3s, 10 par 4s, 4 par 5s, SI 1–18 in hole order.
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5];

let nextId = 1;
function card(overs: (number | null)[], opts: Partial<PatternCard> = {}): PatternCard {
  const id = nextId++;
  return {
    id,
    clubId: 7,
    courseName: "Portmarnock",
    teeName: "White",
    holes: overs.length === 9 ? 9 : 18,
    playedOn: `2026-09-${String((id % 28) + 1).padStart(2, "0")}`,
    teamCard: null,
    holeList: overs.map((o, i) => ({ hole: i + 1, par: PARS[i], strokeIndex: i + 1, strokes: o == null ? null : PARS[i] + o })),
    ...opts,
  };
}

const flat = (o: number) => Array.from({ length: 18 }, () => o);

describe("which cards count", () => {
  it("leaves out team cards and cards with no score, newest first, at most the limit", () => {
    const a = card(flat(1), { playedOn: "2026-10-01" });
    const b = card(flat(1), { playedOn: "2026-10-05" });
    const team = card(flat(0), { playedOn: "2026-10-06", teamCard: "scramble" });
    const empty = card(Array.from({ length: 18 }, () => null), { playedOn: "2026-10-07" });
    expect(patternCards([a, b, team, empty]).map((c) => c.id)).toEqual([b.id, a.id]);
    expect(patternCards([a, b], 1).map((c) => c.id)).toEqual([b.id]);
  });
});

describe("small samples", () => {
  it("shows nothing it can't back up, and says how much more it needs", () => {
    const p = scoringPatterns([card(flat(1))]);
    expect(p.rounds).toBe(1);
    expect(isMeasured(p.nines)).toBe(false);
    expect((p.nines as NotYet).need).toBe(2);
    expect(notYetLabel(p.nines as NotYet)).toBe("2 more full rounds to show this");
    expect(isMeasured(p.start)).toBe(false);
    expect(p.course).toEqual({ need: 2, unit: "rounds at one course" });
    expect(p.insights).toEqual([]);
  });

  it("calls a figure early, then good, as the sample grows", () => {
    const three = scoringPatterns([card(flat(1)), card(flat(1)), card(flat(1))]);
    expect(three.nines).toMatchObject({ read: "early", n: 3 });
    const eight = scoringPatterns(Array.from({ length: 8 }, () => card(flat(1))));
    expect(eight.nines).toMatchObject({ read: "good", n: 8 });
    expect(readLabel(eight.nines as Measured<unknown>, "full rounds")).toBe("Good read · 8 full rounds");
  });
});

describe("the patterns", () => {
  // Six rounds: bogey on par 4s, par on par 3s and 5s, except a double on
  // holes 1 and 2 every time (a slow start) and a par straight after.
  const overs = PARS.map((par, i) => (i < 2 ? 2 : par === 4 ? 1 : 0));
  const rounds = Array.from({ length: 6 }, () => card(overs));
  const p = scoringPatterns(rounds);

  it("averages over par by the hole's par", () => {
    // Par 4s: holes 1,2 (+2) and eight others (+1) → (2·2 + 8·1) / 10 = 1.2
    expect(p.byPar.find((r) => r.par === 4)!.avgOver).toMatchObject({ value: 1.2, n: 60, read: "good" });
    expect(p.byPar.find((r) => r.par === 3)!.avgOver).toMatchObject({ value: 0 });
  });

  it("splits by stroke index", () => {
    const hardest = p.byDifficulty.find((d) => d.band === "hardest")!.avgOver as Measured<number>;
    // SI 1–6 = holes 1–6: +2, +2, 0 (par 3), 0 (par 5), +1, +1 → 1.0
    expect(hardest.value).toBe(1);
  });

  it("measures the start against the rest of the round", () => {
    expect(p.start).toMatchObject({ n: 6, read: "early" });
    const s = (p.start as Measured<{ firstThree: number; rest: number; extra: number }>).value;
    expect(s.firstThree).toBeCloseTo(1.3, 1); // (+2 +2 +0) / 3
    expect(s.extra).toBeGreaterThan(1);
  });

  it("counts doubles a round and what happens next", () => {
    expect((p.doublesPerRound as Measured<number>).value).toBe(2);
    // After the hole-1 double comes another double (hole 2); after hole 2, a par 3 in level par.
    expect(p.bounceBack).toMatchObject({ n: 12, value: 50 });
  });

  it("maps the course played most, hole by hole", () => {
    const c = p.course;
    expect(c && "holes" in c).toBe(true);
    if (!c || !("holes" in c)) return;
    expect(c.rounds).toBe(6);
    expect(c.read).toBe("good");
    expect(c.holes[0]).toMatchObject({ hole: 1, par: 4, avgOver: 2, plays: 6 });
    expect(c.holes).toHaveLength(18);
  });

  it("says what's costing most, in order, and on what it's based", () => {
    expect(p.insights.length).toBeGreaterThan(0);
    expect(p.insights.length).toBeLessThanOrEqual(3);
    expect(p.insights.some((i) => /Slow starter/.test(i.text))).toBe(true);
    for (const i of p.insights) expect(i.basis).toMatch(/\d/);
  });
});

describe("holes without a score", () => {
  it("are left out, not counted as pars or doubles", () => {
    const withGaps = flat(1).map((o, i) => (i === 4 ? null : o));
    const p = scoringPatterns([card(withGaps), card(withGaps), card(withGaps)]);
    expect(p.holes).toBe(51);
    // Not a full round, so no nines.
    expect(isMeasured(p.nines)).toBe(false);
  });
});

describe("formatting", () => {
  it("writes over par the way golfers read it", () => {
    expect(fmtOver(1.2)).toBe("+1.2");
    expect(fmtOver(-0.3)).toBe("−0.3");
    expect(fmtOver(0)).toBe("level");
  });

  it("shades the heatmap in four steps", () => {
    expect([null, 0.2, 0.7, 1.2, 2.3].map(heatLevel)).toEqual([0, 1, 2, 3, 4]);
  });
});
