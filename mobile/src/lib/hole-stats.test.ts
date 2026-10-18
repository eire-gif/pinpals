import { describe, expect, it } from "vitest";

import { isEmptyStat, missedGreen, statInsights, statsSummary, type HoleStat, type StatsCard } from "./hole-stats";

// Par 4 everywhere keeps the arithmetic readable.
let nextId = 1;
function card(holes: { strokes: number | null; stat?: Partial<HoleStat> }[]): StatsCard {
  const id = nextId++;
  const stats = new Map<number, HoleStat>();
  holes.forEach((h, i) => {
    if (h.stat) stats.set(i + 1, { hole: i + 1, putts: null, tee: null, greenMiss: null, penalties: null, ...h.stat });
  });
  return {
    id,
    clubId: 1,
    courseName: "Portmarnock",
    teeName: null,
    holes: 18,
    playedOn: `2026-10-${String((id % 28) + 1).padStart(2, "0")}`,
    teamCard: null,
    holeList: holes.map((h, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1, strokes: h.strokes })),
    stats,
  };
}

describe("green in regulation", () => {
  it("is on in par − 2, from score and putts", () => {
    expect(missedGreen(4, 2, 4)).toBe(false); // on in 2
    expect(missedGreen(5, 2, 4)).toBe(true); // on in 3
    expect(missedGreen(3, 1, 3)).toBe(true); // par 3 on in 2
    expect(missedGreen(null, 2, 4)).toBeNull();
    expect(missedGreen(4, null, 4)).toBeNull();
    expect(missedGreen(2, 3, 4)).toBeNull(); // can't putt more than you scored
  });
});

describe("empty taps", () => {
  it("are holes with nothing on them", () => {
    expect(isEmptyStat(undefined)).toBe(true);
    expect(isEmptyStat({ hole: 1, putts: null, tee: null, greenMiss: null, penalties: 0 })).toBe(true);
    expect(isEmptyStat({ hole: 1, putts: 2, tee: null, greenMiss: null, penalties: null })).toBe(false);
  });
});

describe("the summary", () => {
  // One round, 18 par 4s:
  //   holes 1–6:  fairway, on in 2, 2 putts (par)          → GIR
  //   holes 7–12: left, missed short, 2 putts, 5 (bogey)  → no GIR, no save
  //   holes 13–15: right, missed short, 1 putt, 4 (par)   → no GIR, saved
  //   holes 16–18: left, missed long, 3 putts, 6, 1 penalty
  const holes = [
    ...Array.from({ length: 6 }, () => ({ strokes: 4, stat: { tee: "fairway" as const, putts: 2 } })),
    ...Array.from({ length: 6 }, () => ({ strokes: 5, stat: { tee: "left" as const, greenMiss: "short" as const, putts: 2 } })),
    ...Array.from({ length: 3 }, () => ({ strokes: 4, stat: { tee: "right" as const, greenMiss: "short" as const, putts: 1 } })),
    ...Array.from({ length: 3 }, () => ({ strokes: 6, stat: { tee: "left" as const, greenMiss: "long" as const, putts: 3, penalties: 1 } })),
  ];
  const s = statsSummary([card(holes)]);

  it("counts what was tapped", () => {
    expect(s.holes).toBe(18);
    expect(s.rounds).toBe(1);
  });

  it("works out fairways and where the misses go", () => {
    expect(s.tee).toMatchObject({ n: 18, read: "early", value: { fairwayPct: 33, leftPct: 50, rightPct: 17 } });
  });

  it("works out greens in regulation and par saves", () => {
    expect(s.greens).toMatchObject({ n: 18, value: { perRound: 6, pct: 33 } });
    expect(s.scrambling).toMatchObject({ n: 12, value: 25 }); // 3 of 12
  });

  it("splits missed greens by direction", () => {
    expect(s.misses).toMatchObject({ n: 12, value: { short: 75, long: 25, left: 0, right: 0 } });
  });

  it("totals putting and penalties a round", () => {
    // 6·2 + 6·2 + 3·1 + 3·3 = 36
    expect(s.putting).toMatchObject({ value: { perRound: 36, threePutts: 3, onePutts: 3 } });
    expect(s.penalties).toMatchObject({ value: 3 });
  });

  it("says what's worth acting on", () => {
    const tips = statInsights(s);
    expect(tips.map((t) => t.text)).toEqual([
      "75% of your missed greens finish short. Take one more club into greens.",
      "Your tee shots miss left 3 to 1.",
      "3 three-putts a round. Lag putting from distance is the quickest win.",
      "3 penalty shots a round.",
    ]);
  });
});

describe("small samples", () => {
  it("stay hidden until there's enough", () => {
    const s = statsSummary([card([{ strokes: 5, stat: { putts: 2, tee: "left", greenMiss: "short" } }])]);
    expect("need" in s.greens && s.greens.need).toBe(17);
    expect("need" in s.misses && s.misses.unit).toBe("missed greens");
    expect(statInsights(s)).toEqual([]);
  });

  it("leave out holes with nothing tapped and holes with no score", () => {
    const s = statsSummary([card([{ strokes: 4 }, { strokes: null, stat: { putts: 2 } }, { strokes: 4, stat: { putts: 2 } }])]);
    expect(s.holes).toBe(2);
    // The picked-up hole has putts but no score: no green either way.
    expect("need" in s.greens && s.greens.need).toBe(17);
  });

  it("ignores tee shots on par 3s", () => {
    const c = card(Array.from({ length: 18 }, () => ({ strokes: 3, stat: { tee: "left" as const } })));
    const par3 = { ...c, holeList: c.holeList.map((h) => ({ ...h, par: 3 })) };
    expect("need" in statsSummary([par3]).tee).toBe(true);
  });
});

describe("first-putt distance (0179)", () => {
  it("counts a tap of only the distance as a stat", () => {
    expect(isEmptyStat({ hole: 1, putts: null, tee: null, greenMiss: null, penalties: null, firstPutt: "3-6" })).toBe(false);
  });

  it("waits for five putts in a band, then gives holed and three-putt %", () => {
    // 4 from 3–6ft: not enough on its own.
    const few = card(Array.from({ length: 4 }, () => ({ strokes: 4, stat: { putts: 1, firstPutt: "3-6" as const } })));
    const s1 = statsSummary([few]);
    expect("need" in s1.byDistance && s1.byDistance.need).toBe(1);

    // 6 from 30ft+: none holed, 2 three-putts. 5 from 3–6ft: 3 holed.
    const c = card([
      ...Array.from({ length: 4 }, () => ({ strokes: 5, stat: { putts: 2, firstPutt: "30+" as const } })),
      ...Array.from({ length: 2 }, () => ({ strokes: 6, stat: { putts: 3, firstPutt: "30+" as const } })),
      ...Array.from({ length: 3 }, () => ({ strokes: 4, stat: { putts: 1, firstPutt: "3-6" as const } })),
      ...Array.from({ length: 2 }, () => ({ strokes: 5, stat: { putts: 2, firstPutt: "3-6" as const } })),
    ]);
    const s = statsSummary([c]);
    expect("value" in s.byDistance && s.byDistance.value).toEqual([
      { band: "3-6", label: "3–6ft", n: 5, holedPct: 60, threePuttPct: 0 },
      { band: "30+", label: "30ft+", n: 6, holedPct: 0, threePuttPct: 33 },
    ]);
    expect(statInsights(s).some((i) => i.text.startsWith("33% of your putts from 30ft+"))).toBe(true);
  });

  it("ignores a distance on a hole with no putts", () => {
    const c = card(Array.from({ length: 6 }, () => ({ strokes: 3, stat: { putts: 0, firstPutt: "0-3" as const } })));
    expect("need" in statsSummary([c]).byDistance).toBe(true);
  });
});
