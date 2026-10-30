import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildWrapped, cardPoints, handicapChange, wrappedYear, type WrappedCard } from "./wrapped";

const holes = (strokes: (number | null)[], par = 4) => strokes.map((s, i) => ({ hole: i + 1, par, strokeIndex: i + 1, strokes: s }));
const fours = (n: number) => Array.from({ length: n }, () => 4);

const card = (over: Partial<WrappedCard>): WrappedCard => ({
  clubId: 1,
  courseName: "Portmarnock",
  country: "ireland",
  playedOn: "2026-06-01",
  holes: 18,
  handicapIndex: 16.2,
  playingHandicap: 0,
  groupDay: false,
  holeList: holes(fours(18)),
  ...over,
});

describe("the two copies", () => {
  it("are byte-identical", () => {
    const site = readFileSync(join(__dirname, "wrapped.ts"), "utf8");
    const app = readFileSync(join(__dirname, "../../mobile/src/lib/wrapped.ts"), "utf8");
    expect(app).toBe(site);
  });
});

describe("a year in golf", () => {
  it("counts rounds, scores, courses, the best round and the handicap change", () => {
    const cards = [
      card({ playedOn: "2026-03-10", handicapIndex: 16.2 }),
      card({ playedOn: "2026-06-01", holeList: holes([3, 3, 2, ...fours(15)]), handicapIndex: 15.0 }),
      card({ playedOn: "2026-06-20", clubId: 2, courseName: "Lahinch", handicapIndex: 14.1 }),
      card({ playedOn: "2026-10-26", clubId: 3, courseName: "Old Head", holes: 9, holeList: holes(fours(9)), handicapIndex: 13.8 }),
      card({ playedOn: "2025-12-30", clubId: 9, courseName: "Last year" }),
    ];
    const w = buildWrapped(2026, cards, [{ key: "c", name: "Conor", rounds: 22 }, { key: "d", name: "Dave", rounds: 4 }], new Set([1]));
    expect(w.rounds).toBe(4);
    expect(w.km).toBe(25);
    expect(w.best).toEqual({ points: 40, courseName: "Portmarnock", playedOn: "2026-06-01" });
    expect(w.bestGross!.strokes).toBe(68);
    expect([w.eagles, w.birdies]).toEqual([1, 2]);
    expect(w.courses).toBe(3);
    expect(w.newCourses).toBe(2);
    expect(w.newestCourse).toBe("Old Head");
    expect(w.topCourse).toEqual({ name: "Portmarnock", rounds: 2 });
    expect(w.handicap).toEqual({ from: 16.2, to: 13.8 });
    expect(handicapChange(w.handicap!)).toBe("−2.4");
    expect(w.byMonth[5]).toBe(2);
    expect(w.busiestMonth).toBe(5);
    expect(w.partner).toEqual({ key: "c", name: "Conor", rounds: 22 });
  });

  it("a card without stroke indexes has no points; picked-up holes are 0", () => {
    expect(cardPoints(card({ holeList: holes(fours(18)).map((h) => ({ ...h, strokeIndex: null })) }))).toBeNull();
    expect(cardPoints(card({ holeList: holes([null, ...fours(17)]) }))).toBe(34);
    expect(cardPoints(card({ playingHandicap: 18, holeList: holes(Array.from({ length: 18 }, () => 5)) }))).toBe(36);
  });

  it("personas", () => {
    expect(buildWrapped(2026, [], [], new Set()).persona.id).toBe("rookie");
    const abroad = [card({}), card({ clubId: 5, country: "spain", courseName: "Valderrama" })];
    expect(buildWrapped(2026, abroad, [], new Set()).persona.id).toBe("traveller");
    const society = Array.from({ length: 5 }, (_, i) => card({ playedOn: `2026-0${i + 1}-01`, groupDay: i < 3 }));
    expect(buildWrapped(2026, society, [], new Set([1])).persona.id).toBe("society");
    const explorer = Array.from({ length: 5 }, (_, i) => card({ clubId: 10 + i, courseName: `C${i}` }));
    expect(buildWrapped(2026, explorer, [], new Set()).persona.id).toBe("explorer");
  });

  it("opens last year's in January", () => {
    expect(wrappedYear(new Date(2027, 0, 10))).toBe(2026);
    expect(wrappedYear(new Date(2026, 11, 20))).toBe(2026);
  });
});
