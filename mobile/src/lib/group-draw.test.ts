import { describe, expect, it } from "vitest";

import { addMinutes, draw, indexTotal, shuffle, swapPlayers, teamSizes, teeGroupSizes, teeTimes, type DrawPlayer } from "./group-draw";

/** A repeatable "random" source. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const field = (indexes: (number | null)[]): DrawPlayer[] => indexes.map((index, i) => ({ key: `p${i}`, name: `Player ${i}`, index }));

describe("teeGroupSizes", () => {
  it("makes as few groups as it can, as even as possible, bigger first", () => {
    expect(teeGroupSizes(8, 4)).toEqual([4, 4]);
    expect(teeGroupSizes(10, 4)).toEqual([4, 3, 3]);
    expect(teeGroupSizes(9, 4)).toEqual([3, 3, 3]);
    expect(teeGroupSizes(5, 4)).toEqual([3, 2]);
    expect(teeGroupSizes(3, 4)).toEqual([3]);
    expect(teeGroupSizes(9, 3)).toEqual([3, 3, 3]);
    expect(teeGroupSizes(0, 4)).toEqual([]);
  });
});

describe("teamSizes", () => {
  it("only makes full teams and says how many are left over", () => {
    expect(teamSizes(12, 4)).toEqual({ sizes: [4, 4, 4], leftOver: 0 });
    expect(teamSizes(10, 4)).toEqual({ sizes: [4, 4], leftOver: 2 });
    expect(teamSizes(7, 2)).toEqual({ sizes: [2, 2, 2], leftOver: 1 });
  });
});

describe("draw", () => {
  it("puts everyone in exactly one group, in the sizes asked", () => {
    const players = field([1, 5, 9, 12, 14, 18, 22, 28, 30, 36]);
    for (const mode of ["random", "balanced"] as const) {
      const groups = draw(players, [4, 3, 3], mode, seeded(7));
      expect(groups.map((g) => g.length)).toEqual([4, 3, 3]);
      expect(groups.flat().map((p) => p.key).sort()).toEqual(players.map((p) => p.key).sort());
    }
  });

  it("random draws differ with the seed", () => {
    const players = field([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = draw(players, [4, 4], "random", seeded(1)).flat().map((p) => p.key);
    const b = draw(players, [4, 4], "random", seeded(99)).flat().map((p) => p.key);
    expect(a).not.toEqual(b);
  });

  it("balanced teams have close handicap totals, much closer than sorted order", () => {
    const players = field([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]);
    const groups = draw(players, [4, 4, 4, 4], "balanced", seeded(3));
    const totals = groups.map((g) => indexTotal(g));
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(8);
    // For comparison, the best four together would total 20 and the worst 116.
    for (const t of totals) expect(t).toBeGreaterThan(50);
  });

  it("balanced: each team gets one of the best players", () => {
    const players = field([1, 2, 3, 4, 20, 21, 22, 23, 30, 31, 32, 33, 40, 41, 42, 43]);
    const groups = draw(players, [4, 4, 4, 4], "balanced", seeded(5));
    for (const g of groups) expect(g.some((p) => (p.index ?? 99) <= 4)).toBe(true);
  });

  it("a missing handicap counts as the middle of the field", () => {
    const players = field([2, 4, null, null, 30, 32]);
    const groups = draw(players, [2, 2, 2], "balanced", seeded(2));
    expect(groups.map((g) => g.length)).toEqual([2, 2, 2]);
  });

  it("leaves out anyone beyond the sizes", () => {
    const groups = draw(field([1, 2, 3, 4, 5]), [2, 2], "random", seeded(4));
    expect(groups.flat()).toHaveLength(4);
  });
});

describe("swapPlayers, shuffle and tee times", () => {
  it("swaps two seats and leaves the rest", () => {
    const g = [["a", "b"], ["c", "d"]];
    expect(swapPlayers(g, { group: 0, position: 1 }, { group: 1, position: 0 })).toEqual([["a", "c"], ["b", "d"]]);
    expect(swapPlayers(g, { group: 0, position: 0 }, { group: 5, position: 0 })).toEqual(g);
    expect(g).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("shuffle keeps everyone", () => {
    expect(shuffle([1, 2, 3, 4, 5], seeded(8)).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("tee times step on from the first", () => {
    expect(teeTimes("09:00", 10, 3)).toEqual(["09:00", "09:10", "09:20"]);
    expect(teeTimes("", 10, 2)).toEqual(["", ""]);
    expect(addMinutes("23:55", 10)).toBe("00:05");
    expect(addMinutes("25:00", 10)).toBe("");
  });
});
