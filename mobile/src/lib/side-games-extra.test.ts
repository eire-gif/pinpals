import { describe, expect, it } from "vitest";

import { betLine, extraExposure, nassau, skins, sumMoney, wolf, wolfOn, wolfToPick, type Pts } from "./side-games-extra";

const IDS = [1, 2, 3, 4];

/** points(player, hole) for every hole up to `thru`. */
function pts(points: (p: number, h: number) => number, thru = 18, ids = IDS): Pts {
  const out = new Map<number, Map<number, number | null>>();
  for (const id of ids) {
    const row = new Map<number, number | null>();
    for (let h = 1; h <= 18; h++) row.set(h, h <= thru ? points(id, h) : null);
    out.set(id, row);
  }
  return out;
}

const total = (m: ReadonlyMap<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe("skins", () => {
  it("one winner takes the skin from each of the others", () => {
    const r = skins(pts((p) => (p === 1 ? 3 : 2)), IDS, "carry", 200);
    expect(r.won.get(1)).toBe(18);
    expect(r.money.get(1)).toBe(18 * 200 * 3);
    expect(r.money.get(2)).toBe(-18 * 200);
    expect(total(r.money)).toBe(0);
    expect(r.final).toBe(true);
  });

  it("ties carry the skin on, or lose it when void", () => {
    // Holes 1 and 2 tied; player 2 wins the 3rd; then all tied.
    const p = pts((id, h) => (h === 3 && id === 2 ? 4 : 2));
    const carry = skins(p, IDS, "carry", 100);
    expect(carry.holes[2]).toMatchObject({ winner: 2, value: 3 });
    expect(carry.won.get(2)).toBe(3);
    // 15 tied holes at the end are never won.
    expect(total(carry.won)).toBe(3);
    const voided = skins(p, IDS, "void", 100);
    expect(voided.won.get(2)).toBe(1);
  });

  it("only counts holes in order, and says what's riding", () => {
    const p = pts((id, h) => (h === 1 ? 2 : id === 1 ? 3 : 2), 4);
    const r = skins(p, IDS, "carry", 0);
    expect(r.won.get(1)).toBe(4); // hole 1 tied and carried: 2 on the 2nd, then the 3rd and 4th
    expect(r.riding).toBe(1);
    expect(r.final).toBe(false);
    const tiedLast = skins(pts(() => 2, 2), IDS, "carry", 0);
    expect(tiedLast.riding).toBe(3);
  });
});

describe("wolf", () => {
  it("turns go round in playing order", () => {
    expect([1, 2, 3, 4, 5, 18].map((h) => wolfOn(h, IDS))).toEqual([1, 2, 3, 4, 1, 2]);
  });

  it("a pair's win is a point from each loser; a lone wolf plays for two from each", () => {
    const p = pts((id) => (id === 1 ? 4 : 2), 2);
    // Hole 1: Wolf 1 takes 3, they win. Hole 2: Wolf 2 goes alone and loses to 1.
    const r = wolf(p, IDS, new Map([[1, 3], [2, null]]), 100);
    expect(r.holes[0]).toMatchObject({ wolf: 1, partner: 3, result: "wolf" });
    expect(r.holes[1]).toMatchObject({ wolf: 2, partner: null, result: "others" });
    // 1: +1 +2 = 3; 3: +1 +2 = 3; 2: -1 -6 = -7; 4: -1 +2 = 1.
    expect(Object.fromEntries(r.points)).toEqual({ 1: 3, 2: -7, 3: 3, 4: 1 });
    expect(total(r.money)).toBe(0);
    expect(r.money.get(2)).toBe(-700);
  });

  it("a hole with no pick waits, and a halved hole moves nothing", () => {
    const r = wolf(pts(() => 2, 3), IDS, new Map([[1, 2]]), 100);
    expect(r.holes[0].result).toBe("halved");
    expect(r.holes[1].result).toBeNull();
    expect(wolfToPick(r.holes)?.hole).toBe(2);
    expect(total(r.points)).toBe(0);
  });

  it("needs four players", () => {
    expect(wolf(pts(() => 2, 18, [1, 2, 3]), [1, 2, 3], new Map(), 100).holes).toEqual([]);
  });
});

describe("nassau", () => {
  const two = [1, 2];

  it("front, back and 18 between every two players", () => {
    // Player 1 wins every hole: front 5&4, back 5&4, 18 10&8.
    const r = nassau(pts((id) => (id === 1 ? 3 : 2), 18, two), two, 500);
    const main = r.bets.filter((b) => b.press === 0);
    expect(main.map((b) => [b.label, b.winner, betLine(b)])).toEqual([
      ["Front 9", 1, "Won 5&4"],
      ["Back 9", 1, "Won 5&4"],
      ["18 holes", 1, "Won 10&8"],
    ]);
    // Presses started on 2 down: on the 3rd (front), 12th (back) and 3rd (18).
    expect(r.bets.filter((b) => b.press > 0).map((b) => [b.from, b.to])).toEqual(
      expect.arrayContaining([
        [3, 9],
        [12, 18],
        [3, 18],
      ])
    );
    expect(total(r.money)).toBe(0);
    expect(r.money.get(1)).toBeGreaterThanOrEqual(1500);
  });

  it("every pair plays: three players make three pairings", () => {
    const three = [1, 2, 3];
    const r = nassau(pts(() => 2, 18, three), three, 100);
    expect(new Set(r.bets.map((b) => `${b.a}-${b.b}`))).toEqual(new Set(["1-2", "1-3", "2-3"]));
    expect(r.bets.every((b) => b.done && b.winner == null)).toBe(true);
    expect(total(r.money)).toBe(0);
    expect(r.points.get(1)).toBe(3); // halves: ½ × 3 bets × 2 opponents
  });

  it("in progress", () => {
    const r = nassau(pts((id, h) => (id === 2 && h === 1 ? 3 : 2), 5, two), two, 100);
    const front = r.bets.find((b) => b.label === "Front 9")!;
    expect(betLine(front)).toBe("1 down · thru 5");
    expect(betLine(front, false)).toBe("1 up · thru 5");
    expect(total(r.money)).toBe(0);
  });
});

describe("together", () => {
  it("adds up money and the most you can lose", () => {
    expect(Object.fromEntries(sumMoney([1, 2], new Map([[1, 5]]), new Map([[1, -2], [2, 3]])))).toEqual({ 1: 3, 2: 3 });
    expect(extraExposure({ skins: true, wolf: false, nassau: true, stakes: { skins: 200, wolf: 0, nassau: 500 } }, 4)).toEqual({ maxLoss: 18 * 200 + 9 * 500, maxWin: 18 * 200 * 3 + 9 * 500 });
  });
});
