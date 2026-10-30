import { describe, expect, it } from "vitest";

import {
  averageIndex,
  balancedTeams,
  cupResultLine,
  cupState,
  defaultLineup,
  lineupProblem,
  matchLine,
  matchesFor,
  pairUp,
  pickTurn,
  pts,
  randomTeams,
  type CupPlayer,
  type SessionScore,
} from "./trip-cup-rules";

const s = (points: number, final: [number, number], projected = final, done = final[0] + final[1] === points): SessionScore => ({
  points,
  final,
  projected,
  started: true,
  done,
});
const todo = (points: number): SessionScore => ({ points, final: [0, 0], projected: [0, 0], started: false, done: false });

describe("points", () => {
  it("writes halves", () => {
    expect(pts(0)).toBe("0");
    expect(pts(0.5)).toBe("½");
    expect(pts(6.5)).toBe("6½");
    expect(pts(7)).toBe("7");
  });

  it("counts a session's matches from the smaller team", () => {
    expect(matchesFor("singles", 6, 6)).toBe(6);
    expect(matchesFor("fourball", 6, 6)).toBe(3);
    expect(matchesFor("foursomes", 6, 5)).toBe(2);
    expect(matchesFor("singles", 0, 6)).toBe(0);
  });
});

describe("the Cup", () => {
  it("the mock-up: Navy 3½ – Gold 1½ of 12, Gold holders", () => {
    const st = cupState([s(3, [2, 1]), s(3, [1.5, 0.5], [1.5, 1.5], false), todo(6)], 2);
    expect(st.points).toBe(12);
    expect(st.final).toEqual([3.5, 1.5]);
    expect(st.projected).toEqual([3.5, 2.5]);
    expect(st.toWin).toBe(6.5);
    expect(st.toRetain).toBe(6);
    expect(st.needs).toEqual([3, 4.5]);
    expect(st.remaining).toBe(7);
    expect(st.decided).toBeNull();
    expect(st.over).toBe(false);
  });

  it("is won with more than half", () => {
    const st = cupState([s(3, [2, 1]), s(3, [1.5, 1.5]), s(6, [3.5, 2.5])], 2);
    expect(st.final).toEqual([7, 5]);
    expect(st.decided).toEqual({ team: 1, how: "won" });
    expect(cupResultLine(st, ["Navy", "Gold"], 2)).toBe("Navy take the Cup, 7 – 5");
    expect(cupResultLine(st, ["Navy", "Gold"], null)).toBe("Navy win the Cup, 7 – 5");
  });

  it("is won before the end once it can't be caught", () => {
    const st = cupState([s(6, [6, 0]), s(6, [0.5, 0], [0.5, 0], false)], null);
    expect(st.decided).toEqual({ team: 1, how: "won" });
    expect(st.over).toBe(false);
  });

  it("the holders keep it on a tie, and as soon as the others can't pass half", () => {
    const tie = cupState([s(6, [3, 3]), s(6, [3, 3])], 2);
    expect(tie.decided).toEqual({ team: 2, how: "retained" });
    expect(cupResultLine(tie, ["Navy", "Gold"], 2)).toBe("Gold keep the Cup, 6 – 6");
    // Navy 2, Gold 4, 6 left: Navy could still reach 8. Not decided.
    expect(cupState([s(6, [2, 4]), todo(6)], 2).decided).toBeNull();
    // Gold reach 6 of 12: kept, with points still to play.
    expect(cupState([s(6, [0, 6]), todo(6)], 2).decided).toEqual({ team: 2, how: "retained" });
  });

  it("with no holders a tie is shared", () => {
    const tie = cupState([s(6, [3, 3]), s(6, [3, 3])], null);
    expect(tie.decided).toBeNull();
    expect(tie.over).toBe(true);
    expect(cupResultLine(tie, ["Navy", "Gold"], null)).toBe("Shared, 6 – 6");
  });

  it("nothing played yet", () => {
    const st = cupState([todo(3), todo(3), todo(6)], null);
    expect(st.needs).toEqual([6.5, 6.5]);
    expect(st.decided).toBeNull();
    expect(cupResultLine(st, ["A", "B"], null)).toBeNull();
    expect(cupState([], 1).decided).toBeNull();
  });
});

describe("teams", () => {
  const people: CupPlayer[] = [
    { memberId: "a", name: "Ann", index: 2 },
    { memberId: "b", name: "Bob", index: 8 },
    { memberId: "c", name: "Cat", index: 12 },
    { memberId: "d", name: "Dan", index: 16 },
    { memberId: "e", name: "Eve", index: 20 },
    { memberId: "f", name: "Fin", index: 28 },
  ];

  it("takes turns: team 1 when level", () => {
    expect(pickTurn(1, 1)).toBe(1);
    expect(pickTurn(2, 1)).toBe(2);
    expect(pickTurn(2, 3)).toBe(1);
  });

  it("balances by handicap, three a side, averages close", () => {
    const t = balancedTeams(people);
    const one = people.filter((p) => t.get(p.memberId) === 1);
    const two = people.filter((p) => t.get(p.memberId) === 2);
    expect(one).toHaveLength(3);
    expect(two).toHaveLength(3);
    expect(Math.abs(averageIndex(one)! - averageIndex(two)!)).toBeLessThanOrEqual(3);
  });

  it("keeps captains on their teams", () => {
    const t = balancedTeams(people, { 1: "f", 2: "a" });
    expect(t.get("f")).toBe(1);
    expect(t.get("a")).toBe(2);
    expect([...t.values()].filter((x) => x === 1)).toHaveLength(3);
    const r = randomTeams(people, { 1: "b", 2: "c" }, () => 0.42);
    expect(r.get("b")).toBe(1);
    expect(r.get("c")).toBe(2);
    expect([...r.values()].filter((x) => x === 2)).toHaveLength(3);
  });

  it("averages to one place, ignoring unknowns", () => {
    expect(averageIndex([{ memberId: "x", name: "X", index: 10 }, { memberId: "y", name: "Y", index: 13.5 }, { memberId: "z", name: "Z", index: null }])).toBe(11.8);
    expect(averageIndex([])).toBeNull();
  });
});

describe("lineups", () => {
  it("ones for singles, twos otherwise; the odd one sits out", () => {
    expect(defaultLineup(["a", "b", "c"], "singles")).toEqual([["a"], ["b"], ["c"]]);
    expect(defaultLineup(["a", "b", "c"], "fourball")).toEqual([["a", "b"]]);
  });

  it("match n is each side's nth", () => {
    expect(pairUp([["a"], ["b"], ["c"]], [["x"], ["y"]])).toEqual([
      { one: ["a"], two: ["x"] },
      { one: ["b"], two: ["y"] },
    ]);
  });

  it("checks the shape", () => {
    expect(lineupProblem([], "singles")).toMatch(/in order/);
    expect(lineupProblem([["a", "b"]], "singles")).toMatch(/one player/);
    expect(lineupProblem([["a"]], "foursomes")).toMatch(/two a side/);
    expect(lineupProblem([["a", "b"], ["b", "c"]], "fourball")).toMatch(/two matches/);
    expect(lineupProblem([["a", "b"], ["c", "d"]], "greensomes")).toBeNull();
  });
});

describe("match lines", () => {
  const names = ["Navy", "Gold"] as const;
  it("says how each match stands", () => {
    expect(matchLine(null, names)).toBe("Not started");
    expect(matchLine({ finished: false, leader: 0, margin: "All square", played: 0 }, names)).toBe("Not started");
    expect(matchLine({ finished: false, leader: 2, margin: "1 UP", played: 14 }, names)).toBe("Gold 1 UP · thru 14");
    expect(matchLine({ finished: false, leader: 0, margin: "All square", played: 3 }, names)).toBe("All square · thru 3");
    expect(matchLine({ finished: true, leader: 1, margin: "3&2", played: 16 }, names)).toBe("Navy won 3&2");
    expect(matchLine({ finished: true, leader: 0, margin: "Halved", played: 18 }, names)).toBe("Halved");
  });
});
