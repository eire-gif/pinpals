import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blankCard,
  buildBoard,
  courseHandicap,
  formatInfo,
  indexLabel,
  matchState,
  netScoreName,
  playingHandicap,
  shotsByHole,
  stablefordPoints,
  toParLabel,
  type CardHole,
  type LivePlayer,
} from "./live-scoring";

// An 18-hole card with stroke indexes 1–18 in a realistic order.
const SI = [7, 13, 3, 15, 1, 11, 5, 17, 9, 8, 16, 2, 12, 6, 18, 4, 14, 10];
const PAR = [4, 4, 4, 3, 4, 5, 4, 3, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4];
const card: CardHole[] = SI.map((si, i) => ({ hole: i + 1, par: PAR[i], strokeIndex: si }));
const sheet = (rows: Record<number, Record<number, number | null>>) =>
  new Map(Object.entries(rows).map(([id, holes]) => [Number(id), new Map(Object.entries(holes).map(([h, s]) => [Number(h), s]))]));

describe("live-scoring.ts handicaps", () => {
  it("works out the course handicap the WHS way", () => {
    // 14.2 × 138 ÷ 113 + (73.4 − 72) = 18.74 → 19
    expect(courseHandicap(14.2, { slope: 138, courseRating: 73.4, par: 72 })).toEqual({ courseHandicap: 19, estimated: false });
    // Portmarnock Red, Blue tees (from the API test): 10.0 × 143 ÷ 113 + 6 = 18.65 → 19
    expect(courseHandicap(10, { slope: 143, courseRating: 78, par: 72 }).courseHandicap).toBe(19);
  });

  it("falls back to the index, and says so, when the course has no rating", () => {
    expect(courseHandicap(14.2, { slope: null, courseRating: null, par: 72 })).toEqual({ courseHandicap: 14, estimated: true });
    expect(courseHandicap(14.5, {}).courseHandicap).toBe(15);
  });

  it("applies the format's allowance, halves rounding up", () => {
    expect(playingHandicap(19, formatInfo("stableford").allowance)).toBe(18); // 18.05
    expect(playingHandicap(10, 0.95)).toBe(10); // 9.5
    expect(playingHandicap(26, 0.95)).toBe(25); // 24.7
    expect(playingHandicap(19, formatInfo("matchplay").allowance)).toBe(19);
  });

  it("writes plus handicaps with a plus", () => {
    expect(indexLabel(14.2)).toBe("14.2");
    expect(indexLabel(-1.5)).toBe("+1.5");
    expect(indexLabel(0)).toBe("0");
  });
});

describe("live-scoring.ts shots per hole", () => {
  const total = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  it("hands out one shot on the hardest holes first", () => {
    const s = shotsByHole(5, card)!;
    expect(total(s)).toBe(5);
    expect(s.get(5)).toBe(1); // SI 1
    expect(s.get(16)).toBe(1); // SI 4
    expect(s.get(3)).toBe(1); // SI 3
    expect(s.get(15)).toBe(0); // SI 18
  });

  it("gives a second shot on the hardest holes above 18", () => {
    const s = shotsByHole(20, card)!;
    expect(total(s)).toBe(20);
    expect(s.get(5)).toBe(2); // SI 1
    expect(s.get(12)).toBe(2); // SI 2
    expect(s.get(3)).toBe(1); // SI 3
  });

  it("takes shots back on the easiest holes for a plus handicap", () => {
    const s = shotsByHole(-2, card)!;
    expect(total(s)).toBe(-2);
    expect(s.get(15)).toBe(-1); // SI 18
    expect(s.get(8)).toBe(-1); // SI 17
    expect(s.get(5)).toBe(0);
  });

  it("allocates by rank on a 9-hole card numbered 1, 3, 5…", () => {
    const nine: CardHole[] = [1, 3, 5, 7, 9, 11, 13, 15, 17].map((si, i) => ({ hole: i + 1, par: 4, strokeIndex: si }));
    const s = shotsByHole(4, nine)!;
    expect([...s.values()]).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0]);
  });

  it("refuses to guess on a card missing a stroke index", () => {
    expect(shotsByHole(10, blankCard(18))).toBeNull();
  });
});

describe("live-scoring.ts per hole", () => {
  it("scores Stableford points", () => {
    expect(stablefordPoints(5, 4, 1)).toBe(2); // net par
    expect(stablefordPoints(4, 4, 1)).toBe(3); // net birdie
    expect(stablefordPoints(8, 4, 1)).toBe(0); // never negative
    expect(stablefordPoints(null, 4, 2)).toBe(0); // picked up
  });

  it("names net scores", () => {
    expect(netScoreName(5, 4, 1)).toBe("Net par");
    expect(netScoreName(4, 4, 1)).toBe("Net birdie");
    expect(netScoreName(9, 4, 1)).toBeNull();
  });

  it("labels net to par", () => {
    expect([toParLabel(0), toParLabel(3), toParLabel(-2)]).toEqual(["E", "+3", "-2"]);
  });
});

describe("live-scoring.ts leaderboard", () => {
  const players: LivePlayer[] = [
    { id: 1, name: "Eire", playingHandicap: 18 },
    { id: 2, name: "Ciarán", playingHandicap: 10 },
    { id: 3, name: "Aoife", playingHandicap: 25 },
    { id: 4, name: "Seán", playingHandicap: 5 },
  ];

  it("ranks Stableford by points with ties, and leaves non-starters at the bottom", () => {
    // Hole 1: par 4, SI 7. Eire (1 shot) 5 = 2pts; Ciarán (1 shot) 4 = 3; Aoife (2 shots, 25 ≥ 18+7) 5 = 3.
    const board = buildBoard("stableford", card, players, sheet({ 1: { 1: 5 }, 2: { 1: 4 }, 3: { 1: 5 } }));
    expect(board.rows.map((r) => [r.name, r.position, r.points])).toEqual([
      ["Aoife", "T1", 3],
      ["Ciarán", "T1", 3],
      ["Eire", "3", 2],
      ["Seán", "", 0],
    ]);
    expect(board.rows[0].pace).toBe(1);
    expect(board.cardIncomplete).toBe(false);
  });

  it("ranks stroke play by net to par", () => {
    const board = buildBoard("stroke", card, players, sheet({ 1: { 1: 5, 2: 5 }, 4: { 1: 4, 2: 4 } }));
    // Seán: 8 strokes, no shots on SI 7 and 13, par 8 → E.
    // Eire: 10 strokes, a shot on each, par 8 → E. Tied, then by name.
    expect(board.rows.slice(0, 2).map((r) => [r.name, r.position, r.netToPar])).toEqual([
      ["Eire", "T1", 0],
      ["Seán", "T1", 0],
    ]);
  });

  it("counts a picked-up hole as zero points and net double on the card", () => {
    const board = buildBoard("stableford", card, players.slice(0, 1), sheet({ 1: { 1: null } }));
    expect(board.rows[0]).toMatchObject({ thru: 1, points: 0, gross: 7, netToPar: 2 });
  });

  it("flags a card without stroke indexes", () => {
    expect(buildBoard("stableford", blankCard(18), players, sheet({ 1: { 1: 4 } })).cardIncomplete).toBe(true);
  });
});

describe("live-scoring.ts singles matchplay", () => {
  const a: LivePlayer = { id: 1, name: "Eire", playingHandicap: 19 };
  const b: LivePlayer = { id: 2, name: "Ciarán", playingHandicap: 10 };

  it("gives the higher handicap the difference, by stroke index", () => {
    const m = matchState(card, a, b, sheet({}))!;
    expect(m.shots).toEqual([9, 0]);
    expect(m.label).toBe("All square");
  });

  it("tracks holes up, dormie and a finished match", () => {
    // Hole 1 (SI 7): Eire gets a shot. 5 net 4 vs 4 → halved.
    // Hole 2 (SI 13): no shot. 4 vs 5 → won.
    // Hole 3 (SI 3): shot. 5 net 4 vs 5 → won.
    let m = matchState(card, a, b, sheet({ 1: { 1: 5, 2: 4, 3: 5 }, 2: { 1: 4, 2: 5, 3: 5 } }))!;
    expect(m.results.map((r) => r.result)).toEqual(["halved", "won", "won"]);
    expect(m.label).toBe("2 UP");
    expect(m.holesLeft).toBe(15);

    // Level handicaps: two holes won, fourteen halved, two to play.
    const even: LivePlayer = { ...a, playingHandicap: 10 };
    const eire = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, 4]));
    const ciaran = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, i < 2 ? 6 : 4]));
    m = matchState(card, even, b, sheet({ 1: eire, 2: ciaran }))!;
    expect(m.label).toBe("Dormie 2");
    expect(m.finished).toBe(false);
  });

  it("finishes 3&2", () => {
    const eire = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, 4]));
    const ciaran = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, i < 3 ? 6 : 4]));
    const even: LivePlayer = { ...a, playingHandicap: 10 };
    const m = matchState(card, even, b, sheet({ 1: eire, 2: ciaran }))!;
    expect(m.up).toBe(3);
    expect(m.finished).toBe(true);
    expect(m.label).toBe("Won 3&2");
  });

  it("can't score a match on a card without stroke indexes", () => {
    expect(matchState(blankCard(18), a, b, sheet({}))).toBeNull();
  });
});

describe("live-scoring.ts is shared", () => {
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/live-scoring.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/live-scoring.ts"), "utf8");
    expect(app).toBe(site);
  });
});
