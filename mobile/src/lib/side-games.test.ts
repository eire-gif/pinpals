import { describe, expect, it } from "vitest";

import type { CardHole, LivePlayer } from "./live-scoring";
import {
  balances,
  euros,
  exposure,
  gameMoney,
  matchLine,
  parseEuros,
  pointsLabel,
  settle,
  sideGames,
  sideGamesBlocked,
  sidePoints,
  sixesPairs,
  type SideGamesConfig,
} from "./side-games";

// Par 4s, stroke index = hole number. Everyone off scratch, so points are
// simply 2 for a 4, 3 for a 3, 1 for a 5, 0 for a 6+.
const card: CardHole[] = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));
const players: LivePlayer[] = [
  { id: 1, name: "You", playingHandicap: 0 },
  { id: 2, name: "Conor", playingHandicap: 0 },
  { id: 3, name: "Dave", playingHandicap: 0 },
  { id: 4, name: "Mark", playingHandicap: 0 },
];

function sheet(rows: Record<number, (number | null)[]>) {
  return new Map(
    Object.entries(rows).map(([id, strokes]) => [
      Number(id),
      new Map(strokes.map((s, i) => [i + 1, s] as [number, number | null])),
    ]),
  );
}

const fours = (n: number) => Array.from({ length: n }, () => 4);

const base: SideGamesConfig = {
  bestFront: true,
  bestBack: true,
  bestOverall: false,
  sixes: "pairs",
  mode: "money",
  stakes: { front: 500, back: 500, overall: 0, sixes: 500 },
};

describe("which rounds can have side games", () => {
  const round = { holes: 18, format: "stableford", matchDayId: null, scramble: null, status: "live" };
  it("an 18-hole round of own balls with two or more", () => {
    expect(sideGamesBlocked(round, 4)).toBeNull();
  });
  it("not 9 holes, team games, finished rounds or one player", () => {
    expect(sideGamesBlocked({ ...round, holes: 9 }, 4)).toMatch(/18-hole/);
    expect(sideGamesBlocked({ ...round, format: "scramble" }, 4)).toMatch(/own ball/);
    expect(sideGamesBlocked({ ...round, matchDayId: 7 }, 4)).toMatch(/own ball/);
    expect(sideGamesBlocked({ ...round, status: "finished" }, 4)).toMatch(/finished/);
    expect(sideGamesBlocked(round, 1)).toMatch(/two players/);
  });
});

describe("rotating partners", () => {
  it("everyone partners everyone once", () => {
    expect(sixesPairs([1, 2, 3, 4])).toEqual([
      [[1, 2], [3, 4]],
      [[1, 3], [2, 4]],
      [[1, 4], [2, 3]],
    ]);
    expect(sixesPairs([1, 2, 3])).toEqual([]);
  });
});

describe("the games, in the order they're played", () => {
  it("sixes, front, sixes, sixes, back", () => {
    const games = sideGames(base, card, players, sheet({}));
    expect(games.map((g) => g.id)).toEqual(["sixes1", "front", "sixes2", "sixes3", "back"]);
    expect(games.every((g) => g.status === "not_started")).toBe(true);
  });

  it("Best Front 9: most points on 1–9, final when everyone's done the 9th", () => {
    // Conor birdies the 1st; everyone else pars everything.
    const s = sheet({ 1: fours(9), 2: [3, ...fours(8)], 3: fours(9), 4: fours(9) });
    const front = sideGames(base, card, players, s).find((g) => g.id === "front")!;
    expect(front.status).toBe("final");
    expect(front.winners).toEqual([2]);
    expect(front.standings[0]).toMatchObject({ playerId: 2, points: 19, thru: 9 });
  });

  it("live while anyone's still to finish, with the leader as it stands", () => {
    const s = sheet({ 1: [3, 4], 2: [4, 4], 3: [4], 4: [4] });
    const front = sideGames(base, card, players, s).find((g) => g.id === "front")!;
    expect(front.status).toBe("live");
    expect(front.winners).toEqual([1]);
  });

  it("everyone level means nobody is winning", () => {
    const s = sheet({ 1: fours(9), 2: fours(9), 3: fours(9), 4: fours(9) });
    expect(sideGames(base, card, players, s).find((g) => g.id === "front")!.winners).toEqual([]);
  });

  it("a picked-up hole counts as played for no points", () => {
    const s = sheet({ 1: [null, ...fours(8)], 2: fours(9), 3: fours(9), 4: fours(9) });
    const front = sideGames(base, card, players, s).find((g) => g.id === "front")!;
    expect(front.status).toBe("final");
    expect(front.standings.find((r) => r.playerId === 1)).toMatchObject({ points: 16, thru: 9 });
  });

  it("handicap shots count: a 5 with a shot is 2 points", () => {
    const hcp: LivePlayer[] = [{ ...players[0]!, playingHandicap: 18 }, players[1]!];
    const s = sheet({ 1: Array.from({ length: 9 }, () => 5), 2: fours(9) });
    const front = sideGames({ ...base, sixes: null }, card, hcp, s).find((g) => g.id === "front")!;
    expect(front.standings.map((r) => r.points)).toEqual([18, 18]);
    expect(front.winners).toEqual([]);
  });
});

describe("Sixes in pairs", () => {
  it("better ball of each pair, hole by hole", () => {
    // Holes 1–6: You birdie the 1st and 2nd; Dave birdies the 3rd. You & Conor win 1 up.
    const s = sheet({
      1: [3, 3, 4, 4, 4, 4],
      2: fours(6),
      3: [4, 4, 3, 4, 4, 4],
      4: fours(6),
    });
    const m = sideGames(base, card, players, s).find((g) => g.id === "sixes1")!;
    expect(m.match).toMatchObject({ sideA: [1, 2], sideB: [3, 4], up: 1, played: 6, result: "A" });
    expect(m.status).toBe("final");
    expect(matchLine(m.match!)).toBe("Won 1 up");
  });

  it("decided early once it can't be caught", () => {
    const s = sheet({ 1: [3, 3, 3, 3], 2: fours(4), 3: fours(4), 4: fours(4) });
    const m = sideGames(base, card, players, s).find((g) => g.id === "sixes1")!;
    expect(m.status).toBe("final");
    expect(matchLine(m.match!)).toBe("Won 4&2");
  });

  it("halved moves nothing", () => {
    const s = sheet({ 1: fours(6), 2: fours(6), 3: fours(6), 4: fours(6) });
    const m = sideGames(base, card, players, s).find((g) => g.id === "sixes1")!;
    expect(m.match!.result).toBe("halved");
    expect(gameMoney(m, [1, 2, 3, 4]).size).toBe(0);
  });

  it("needs four players; with three it isn't set", () => {
    expect(sideGames(base, card, players.slice(0, 3), sheet({})).some((g) => g.kind === "sixes")).toBe(false);
  });
});

describe("money and settling up", () => {
  // The day from the mock-up: Conor wins the front, You the back; Sixes:
  // You & Conor win 1–6, 7–12 halved, You & Mark win 13–18.
  const s = sheet({
    1: [3, 4, 4, 4, 4, 4, 4, 4, 5, 4, 4, 4, 3, 4, 4, 3, 4, 4],
    2: [4, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5],
    3: fours(18),
    4: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  });

  it("each game's stake, the totals and the fewest payments", () => {
    const games = sideGames(base, card, players, s);
    const ids = players.map((p) => p.id);
    expect(games.find((g) => g.id === "front")!.winners).toEqual([2]);
    expect(games.find((g) => g.id === "back")!.winners).toEqual([1]);
    expect(games.find((g) => g.id === "sixes1")!.match!.result).toBe("A");
    expect(games.find((g) => g.id === "sixes2")!.match!.result).toBe("halved");
    expect(games.find((g) => g.id === "sixes3")!.match!.result).toBe("A");

    const bal = balances(games, ids);
    // You: −5 front, +15 back, +5, 0, +5 = +20. Conor: +15 −5 +5 −5 = +10.
    expect(Object.fromEntries(bal)).toEqual({ 1: 2000, 2: 1000, 3: -2000, 4: -1000 });
    expect([...bal.values()].reduce((a, b) => a + b, 0)).toBe(0);
    expect(settle(bal)).toEqual([
      { from: 3, to: 1, cents: 2000 },
      { from: 4, to: 2, cents: 1000 },
    ]);
  });

  it("tied winners share the pot; odd cents still balance", () => {
    const three = players.slice(0, 3);
    const t = sheet({ 1: [3, ...fours(8)], 2: [3, ...fours(8)], 3: fours(9) });
    const cfg: SideGamesConfig = { ...base, sixes: null, bestBack: false, stakes: { ...base.stakes, front: 501 } };
    const front = sideGames(cfg, card, three, t)[0]!;
    const money = gameMoney(front, [1, 2, 3]);
    expect(money.get(3)).toBe(-501);
    expect((money.get(1) ?? 0) + (money.get(2) ?? 0)).toBe(501);
  });

  it("live games count only 'as it stands'", () => {
    const live = sheet({ 1: [3], 2: [4], 3: [4], 4: [4] });
    const games = sideGames(base, card, players, live);
    expect([...balances(games, [1, 2, 3, 4]).values()].every((c) => c === 0)).toBe(true);
    expect(balances(games, [1, 2, 3, 4], true).get(1)).toBeGreaterThan(0);
  });

  it("no stakes outside money mode", () => {
    const games = sideGames({ ...base, mode: "points" }, card, players, s);
    expect(games.every((g) => g.stakeCents === 0)).toBe(true);
    const pts = sidePoints(games, [1, 2, 3, 4]);
    // You: back + sixes1 + ½ + sixes3 = 3½.
    expect(pts.get(1)).toBe(3.5);
    expect(pointsLabel(pts.get(1)!)).toBe("3½");
  });

  it("settle squares any set of balances", () => {
    const bal = new Map([[1, 700], [2, -300], [3, -300], [4, -100]]);
    const pays = settle(bal);
    const after = new Map(bal);
    for (const p of pays) {
      after.set(p.from, after.get(p.from)! + p.cents);
      after.set(p.to, after.get(p.to)! - p.cents);
    }
    expect([...after.values()].every((c) => c === 0)).toBe(true);
    expect(pays.length).toBeLessThanOrEqual(3);
  });
});

describe("what's at stake", () => {
  it("the mock-up's day: lose at most €25, win at most €45", () => {
    expect(exposure(base, 4)).toEqual({ maxLoss: 2500, maxWin: 4500 });
    expect(exposure({ ...base, mode: "pride" }, 4)).toEqual({ maxLoss: 0, maxWin: 0 });
  });
});

describe("amounts", () => {
  it("reads what's typed", () => {
    expect(parseEuros("5")).toBe(500);
    expect(parseEuros("€2.50")).toBe(250);
    expect(parseEuros("2,5")).toBe(250);
    expect(parseEuros("0")).toBe(0);
    expect(parseEuros("abc")).toBeNull();
    expect(parseEuros("501")).toBeNull();
    expect(parseEuros("1.234")).toBeNull();
  });
  it("prints euros", () => {
    expect(euros(500)).toBe("€5");
    expect(euros(250)).toBe("€2.50");
    expect(euros(-1000)).toBe("−€10");
    expect(euros(2000, true)).toBe("+€20");
    expect(euros(-2000, true)).toBe("−€20");
  });
});
