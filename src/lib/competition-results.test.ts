import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  buildResults,
  countbackSteps,
  divisionOf,
  evenCuts,
  placeOf,
  rankEntrants,
  type ResultEntrant,
} from "./competition-results";
import type { CardHole } from "./live-scoring";

// Par 4 everywhere, SI 1–18 in hole order: off scratch, Stableford points
// are 2 for a 4, 3 for a 3, 1 for a 5 — easy to read in a test.
const card18: CardHole[] = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));
const card9: CardHole[] = card18.slice(0, 9);

/** Strokes from Stableford points, scratch, par 4. */
const fromPoints = (pts: number[]): Record<number, number | null> => Object.fromEntries(pts.map((p, i) => [i + 1, 6 - p]));
const fromStrokes = (s: (number | null)[]) => Object.fromEntries(s.map((x, i) => [i + 1, x]));

let seq = 0;
const entrant = (name: string, scores: Record<number, number | null>, over: Partial<ResultEntrant> = {}): ResultEntrant => ({
  key: `k${++seq}`,
  name,
  detail: null,
  memberIds: [`m-${name}`],
  guest: false,
  handicap: 0,
  card: card18,
  scores,
  roundId: 1,
  group: 1,
  certified: true,
  ...over,
});

const opts = { tieRule: "share" as const, seed: "day-1" };

describe("countback steps (R&A Committee Procedures 5A(6)d)", () => {
  it("18 holes: last 9, 6, 3, 18th, then the front 9's last 6, 3 and 9th", () => {
    expect(countbackSteps(card18).map((s) => [s.short, s.holes[0], s.holes[s.holes.length - 1], s.fraction])).toEqual([
      ["last 9", 10, 18, "½"],
      ["last 6", 13, 18, "⅓"],
      ["last 3", 16, 18, "⅙"],
      ["18th", 18, 18, "1⁄18"],
      ["front 9 last 6", 4, 9, "⅓"],
      ["front 9 last 3", 7, 9, "⅙"],
      ["9th", 9, 9, "1⁄18"],
    ]);
  });
  it("9 holes: last 6, 3 and last hole, in fractions of nine", () => {
    expect(countbackSteps(card9).map((s) => [s.short, s.holes.length, s.fraction])).toEqual([
      ["last 6", 6, "⅔"],
      ["last 3", 3, "⅓"],
      ["9th", 1, "1⁄9"],
    ]);
  });
});

describe("Stableford countback", () => {
  // Both 38. Last 9: 19 v 19. Last 6: 14 v 12 — John wins there.
  const john = entrant("John", fromPoints([2, 2, 2, 2, 2, 2, 2, 2, 3, 1, 2, 2, 2, 3, 2, 2, 3, 2]));
  const declan = entrant("Declan", fromPoints([2, 2, 2, 2, 2, 2, 2, 3, 2, 3, 2, 2, 2, 2, 2, 2, 2, 2]));

  it("separates a tie on the first step that differs, and says how", () => {
    const r = rankEntrants([declan, john], "stableford", opts);
    expect(r.rows.map((x) => [x.positionLabel, x.name, x.score, x.back])).toEqual([
      ["1", "John", "38", "19"],
      ["2", "Declan", "38", "19"],
    ]);
    expect(r.rows[0].note).toBe("Won on countback · last 6: 14 v 12");
    expect(r.rows[0].wonTie).toBe(true);
    expect(r.rows[1].note).toBe("Level on 38 · lost on last 6");
    expect(r.ties[0].resolvedBy).toBe("countback");
    expect(r.ties[0].steps.map((s) => [s.values, s.decided]).slice(0, 2)).toEqual([
      [["19", "19"], false],
      [["14", "12"], true],
    ]);
  });

  it("goes on to the front 9 when the back 9 can't separate them", () => {
    // Identical back nines; the front 9's last 6 differs (holes 4–9).
    const back = [2, 2, 2, 2, 2, 2, 2, 2, 2];
    const a = entrant("A", fromPoints([3, 3, 2, 2, 2, 2, 2, 2, 2, ...back]));
    const b = entrant("B", fromPoints([2, 2, 2, 3, 3, 2, 2, 2, 2, ...back]));
    const r = rankEntrants([a, b], "stableford", opts);
    expect(r.rows.map((x) => x.name)).toEqual(["B", "A"]);
    expect(r.rows[0].note).toBe("Won on countback · front 9 last 6: 14 v 12");
  });

  it("level after every step: shared (=1, =1, then 3rd)", () => {
    const pts = Array(18).fill(2);
    const r = rankEntrants([entrant("X", fromPoints(pts)), entrant("Y", fromPoints(pts)), entrant("Z", fromPoints([...pts.slice(0, 17), 1]))], "stableford", opts);
    expect(r.rows.map((x) => x.positionLabel)).toEqual(["=1", "=1", "3"]);
    expect(r.ties[0].resolvedBy).toBe("shared");
    expect(r.rows[0].note).toBe("Level after every countback step · place shared");
  });

  it("level after every step with a draw: separate places, the same draw every time", () => {
    const pts = Array(18).fill(2);
    const x = entrant("X", fromPoints(pts));
    const y = entrant("Y", fromPoints(pts));
    const one = rankEntrants([x, y], "stableford", { tieRule: "draw", seed: "day-7" });
    const two = rankEntrants([y, x], "stableford", { tieRule: "draw", seed: "day-7" });
    expect(one.rows.map((r) => r.positionLabel)).toEqual(["1", "2"]);
    expect(one.rows.map((r) => r.key)).toEqual(two.rows.map((r) => r.key));
    expect(one.ties[0].resolvedBy).toBe("draw");
    expect(one.rows[1].note).toContain("placed by draw");
  });

  it("a picked-up hole is 0 points, not a no-return", () => {
    const s = fromPoints(Array(18).fill(2));
    s[7] = null;
    const r = rankEntrants([entrant("P", s)], "stableford", opts);
    expect(r.rows[0]).toMatchObject({ status: "ok", score: "34", positionLabel: "1" });
  });

  it("gives shots by stroke index, as in the competition", () => {
    // Off 18: a shot on every hole, so a 5 everywhere is 36 points.
    const r = rankEntrants([entrant("H", fromStrokes(Array(18).fill(5)), { handicap: 18 })], "stableford", opts);
    expect(r.rows[0].score).toBe("36");
  });
});

describe("Net stroke play countback", () => {
  it("takes the fraction of the handicap off, never rounded", () => {
    // Both net 70. Last 9: A 40 − ½×10 = 35; B 39 − ½×9 = 34.5. B wins.
    const nine = (fives: number) => Array.from({ length: 9 }, (_, i) => (i < fives ? 5 : 4));
    const a = entrant("A", fromStrokes([...nine(4), ...nine(4)]), { handicap: 10 }); // 80 − 10
    const b = entrant("B", fromStrokes([...nine(4), ...nine(3)]), { handicap: 9 }); // 79 − 9
    const r = rankEntrants([a, b], "stroke", opts);
    expect(r.rows.map((x) => [x.name, x.score])).toEqual([
      ["B", "70"],
      ["A", "70"],
    ]);
    expect(r.rows[0].note).toBe("Won on countback · last 9: 34.5 v 35");
    // A third of a handicap is kept exactly: last 6 for A is 25 − 10/3.
    expect(r.ties[0].steps[1].values[1]).toBe("21.67");
  });

  it("a picked-up hole is a no return (Rule 3.3c) and can't place", () => {
    const s = fromStrokes(Array(18).fill(4));
    s[3] = null;
    const r = rankEntrants([entrant("NR", s), entrant("OK", fromStrokes(Array(18).fill(5)))], "stroke", opts);
    expect(r.rows.map((x) => [x.name, x.positionLabel, x.score])).toEqual([
      ["OK", "1", "90"],
      ["NR", "NR", "NR"],
    ]);
  });

  it("a card not finished isn't ranked", () => {
    const half = fromStrokes(Array(9).fill(3));
    const r = rankEntrants([entrant("Half", half), entrant("Done", fromStrokes(Array(18).fill(5)))], "stroke", opts);
    expect(r.rows.map((x) => [x.name, x.positionLabel, x.score])).toEqual([
      ["Done", "1", "90"],
      ["Half", "Out", "9/18"],
    ]);
  });
});

describe("the whole result", () => {
  const pts = (total: number) => fromPoints([...Array(18).fill(2)].map((p, i) => (i < total - 36 ? 3 : i < 36 - total ? 1 : 2)));

  it("guests are listed but don't take places by default", () => {
    const res = buildResults({
      basis: "stableford",
      team: false,
      entrants: [entrant("Guest", pts(40), { guest: true, memberIds: [] }), entrant("Member", pts(36))],
      settings: DEFAULT_SETTINGS,
      seed: "d",
    });
    expect(res.divisions[0].ranking.rows.map((r) => [r.name, r.positionLabel])).toEqual([
      ["Member", "1"],
      ["Guest", "Guest"],
    ]);
  });

  it("divides by handicap and gives 1st–3rd in each; best gross skips a player already placed", () => {
    const e = [
      entrant("Low1", fromStrokes(Array(18).fill(4)), { handicap: 2 }), // 72 gross, 38 pts
      entrant("Low2", fromStrokes([...Array(17).fill(4), 5]), { handicap: 2 }), // 73
      entrant("Low3", fromStrokes([...Array(16).fill(4), 5, 5]), { handicap: 2 }), // 74
      entrant("Low4", fromStrokes([...Array(15).fill(4), 5, 5, 5]), { handicap: 3 }), // 75, 4th
      entrant("High1", fromStrokes(Array(18).fill(5)), { handicap: 20 }),
      entrant("High2", fromStrokes(Array(18).fill(6)), { handicap: 22 }),
    ];
    expect(evenCuts(e.map((x) => x.handicap), 2)).toEqual([3]);
    expect(evenCuts([5, 5, 5, 5], 2)).toEqual([]); // equal handicaps aren't split
    const cuts = [20];
    expect(divisionOf(19, cuts)).toBe(0);
    expect(divisionOf(20, cuts)).toBe(1);
    const res = buildResults({ basis: "stableford", team: false, entrants: e, settings: { ...DEFAULT_SETTINGS, divisionCuts: cuts }, seed: "d" });
    expect(res.divisions.map((d) => [d.label, d.range])).toEqual([
      ["Division 1", "up to 19"],
      ["Division 2", "20 and over"],
    ]);
    expect(res.prizes[0].winners.map((w) => w.name)).toEqual(["Low1", "Low2", "Low3"]);
    // Low1–3 have places, so the best gross goes to Low4 (75).
    const gross = res.prizes.find((p) => p.label === "Best gross")!;
    expect(gross.winners.map((w) => [w.name, w.score])).toEqual([["Low4", "75 gross"]]);
  });

  it("flags cards not in, missing stroke indexes and uncertified placers", () => {
    const noSi = card18.map((h) => (h.hole === 5 ? { ...h, strokeIndex: null } : h));
    const res = buildResults({
      basis: "stableford",
      team: false,
      entrants: [entrant("A", pts(36), { certified: false, card: noSi }), entrant("B", fromPoints(Array(9).fill(2)))],
      settings: DEFAULT_SETTINGS,
      seed: "d",
    });
    expect(res.checks.map((c) => c.level)).toEqual(["stop", "stop", "warn"]);
    expect(res.counts).toMatchObject({ entrants: 2, out: 1, uncertifiedPlacers: 1 });
  });

  it("tells a member where they finished", () => {
    const res = buildResults({ basis: "stableford", team: false, entrants: [entrant("Eire", pts(34)), entrant("Tom", pts(37))], settings: DEFAULT_SETTINGS, seed: "d" });
    expect(placeOf(res, "m-Eire")).toMatchObject({ division: "Overall", of: 2, row: { positionLabel: "2" } });
  });

  it("pairs: no divisions or best gross, named as pairs", () => {
    const res = buildResults({
      basis: "stableford",
      team: true,
      teamWord: "Pairs",
      entrants: [entrant("Eire & Tom", pts(38), { detail: "Eire · Tom", handicap: 14 })],
      settings: { ...DEFAULT_SETTINGS, divisionCuts: [10] },
      seed: "d",
    });
    expect(res.divisions.map((d) => d.label)).toEqual(["Pairs"]);
    expect(res.bestGross).toBeNull();
  });

  it("is plain JSON, so the published copy is the same thing", () => {
    const res = buildResults({ basis: "stroke", team: false, entrants: [entrant("A", fromStrokes(Array(18).fill(5)), { handicap: 9 })], settings: DEFAULT_SETTINGS, seed: "d" });
    expect(JSON.parse(JSON.stringify(res))).toEqual(res);
  });
});

describe("competition-results.ts is shared", () => {
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/competition-results.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/competition-results.ts"), "utf8");
    expect(app).toBe(site);
  });
});
