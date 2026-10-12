import { describe, expect, it } from "vitest";

import { bestOf, bestOfLabel, comparedWithOwn, indicatorLabel } from "./handicap-indicator";

describe("bestOf — the WHS table, as 0122's SQL has it", () => {
  it("needs three cards", () => {
    expect(bestOf(0)).toBeNull();
    expect(bestOf(2)).toBeNull();
  });

  it("matches the table from 3 to 20", () => {
    const table: [number, number, number][] = [
      [3, 1, -2], [4, 1, -1], [5, 1, 0], [6, 2, -1], [7, 2, 0], [8, 2, 0],
      [9, 3, 0], [11, 3, 0], [12, 4, 0], [14, 4, 0], [15, 5, 0], [16, 5, 0],
      [17, 6, 0], [18, 6, 0], [19, 7, 0], [20, 8, 0],
    ];
    for (const [n, count, adjustment] of table) expect(bestOf(n)).toEqual({ count, adjustment });
  });

  it("never looks past the last 20", () => {
    expect(bestOf(35)).toEqual({ count: 8, adjustment: 0 });
  });
});

describe("labels", () => {
  it("says what the indicator is made of, or how many cards are still needed", () => {
    expect(bestOfLabel(20)).toBe("Best 8 of your last 20 scorecards");
    expect(bestOfLabel(3)).toBe("Best 1 of 3 scorecards, less 2.0");
    expect(bestOfLabel(9, "their")).toBe("Best 3 of 9 scorecards");
    expect(bestOfLabel(2)).toBe("1 more 18-hole scorecard with a course rating and slope to go");
    expect(bestOfLabel(0)).toBe("3 more 18-hole scorecards with a course rating and slope to go");
  });

  it("writes an index with one decimal, plus handicaps with a plus", () => {
    expect(indicatorLabel(12)).toBe("12.0");
    expect(indicatorLabel(-1.2)).toBe("+1.2");
  });

  it("compares with the member's own handicap", () => {
    expect(comparedWithOwn(null, 12)).toBeNull();
    expect(comparedWithOwn(12.2, 12)).toBe("In line with your handicap");
    expect(comparedWithOwn(10.4, 12)).toBe("1.6 lower than your handicap");
    expect(comparedWithOwn(14, 12)).toBe("2.0 higher than your handicap");
  });
});
