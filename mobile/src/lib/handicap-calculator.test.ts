import { describe, expect, it } from "vitest";

import { calcRow, isWomensTee, manualTee, teesFor, type CalcCard } from "./handicap-calculator";

// The Links Portmarnock as Golf Ireland lists it (26 Oct 2026).
const CARDS: CalcCard[] = [
  { teeName: "White", holes: 18, courseRating: 73.5, slope: 130, parTotal: 72 },
  { teeName: "Blue", holes: 18, courseRating: 75.8, slope: 133, parTotal: 72 },
  { teeName: "Gold", holes: 18, courseRating: 67.3, slope: 118, parTotal: 72 },
  { teeName: "Green", holes: 18, courseRating: 71.1, slope: 125, parTotal: 72 },
  { teeName: "Green (Women)", holes: 18, courseRating: 77.1, slope: 137, parTotal: 72 },
  { teeName: "Gold (Women)", holes: 18, courseRating: 72.7, slope: 126, parTotal: 72 },
  { teeName: "Blue B9", holes: 9, courseRating: 38.1, slope: 133, parTotal: 36 },
];

describe("handicap-calculator.ts", () => {
  it("lists men's or women's tees for the holes chosen, longest first", () => {
    expect(teesFor(CARDS, "men", 18).map((t) => t.name)).toEqual(["Blue", "White", "Green", "Gold"]);
    expect(teesFor(CARDS, "women", 18).map((t) => t.name)).toEqual(["Green (Women)", "Gold (Women)"]);
    expect(teesFor(CARDS, "men", 9).map((t) => t.name)).toEqual(["Blue B9"]);
    expect(teesFor(CARDS, "women", 9)).toEqual([]);
    expect(isWomensTee("Red (women)")).toBe(true);
  });

  it("gives Golf Ireland's figures, and plays-off from the exact course handicap", () => {
    const rows = teesFor(CARDS, "men", 18).map((t) => calcRow(15.6, t, 0.95));
    expect(rows.map((r) => r.course.courseHandicap)).toEqual([22, 19, 16, 12]);
    expect(rows.map((r) => r.plays)).toEqual([21, 18, 16, 11]);
    expect(teesFor(CARDS, "women", 18).map((t) => calcRow(15.6, t, 1).plays)).toEqual([24, 18]);
    expect(calcRow(15.6, teesFor(CARDS, "men", 9)[0], 1).course).toMatchObject({ courseHandicap: 11, indexUsed: 7.8 });
  });

  it("checks typed-in tees, catching a rating for the wrong number of holes", () => {
    expect(manualTee(18, { slope: "125", rating: "71.1", par: "72" }).tee).toMatchObject({ slope: 125, courseRating: 71.1, par: 72, holes: 18 });
    expect(manualTee(9, { slope: "125", rating: "71.1", par: "36" }).problem).toMatch(/for 18 holes/);
    expect(manualTee(18, { slope: "125", rating: "35.6", par: "72" }).problem).toMatch(/9-hole rating/);
    expect(manualTee(18, { slope: "200", rating: "", par: "" }).problem).toMatch(/55 to 155/);
    expect(manualTee(18, { slope: "125", rating: "", par: "72" })).toEqual({ tee: null, problem: null });
  });
});
