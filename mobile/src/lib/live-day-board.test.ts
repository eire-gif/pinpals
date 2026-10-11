import { describe, expect, it } from "vitest";

import { dayBoard } from "./live-day-board";
import type { Match } from "./live-match-days";

const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));

/** A tee group: players with playing handicaps, and their strokes on the first holes. */
function group(n: number, format: "stableford" | "stroke", players: { id: number; name: string; hcp: number; strokes: (number | null)[] }[]): Match {
  const scores = new Map<number, Map<number, number | null>>();
  for (const p of players) scores.set(p.id, new Map(p.strokes.map((s, i) => [i + 1, s])));
  return {
    round: { id: 100 + n, format, matchNumber: n, teeTime: `09:${String(n * 10).padStart(2, "0")}`, status: "live" },
    players: players.map((p, i) => ({ id: p.id, name: p.name, playingHandicap: p.hcp, courseHandicap: p.hcp, position: i + 1, side: null })),
    card,
    scores,
    format: "matchplay",
    state: null,
  } as unknown as Match;
}

describe("dayBoard", () => {
  it("ranks every player from every group together by Stableford points", () => {
    const board = dayBoard([
      // Off scratch: par 4s are 2 points each, a birdie 3.
      group(1, "stableford", [
        { id: 1, name: "Eire", hcp: 0, strokes: [4, 4, 3] }, // 7
        { id: 2, name: "Dave", hcp: 0, strokes: [5, 4, 4] }, // 5
      ]),
      group(2, "stableford", [
        { id: 3, name: "Ciarán", hcp: 0, strokes: [3, 3] }, // 6 thru 2
        { id: 4, name: "Niall", hcp: 0, strokes: [] }, // not started
      ]),
    ]);
    expect(board.format).toBe("stableford");
    expect(board.rows.map((r) => [r.name, r.position, r.points, r.thru, r.group])).toEqual([
      ["Eire", "1", 7, 3, 1],
      ["Ciarán", "2", 6, 2, 2],
      ["Dave", "3", 5, 3, 1],
      ["Niall", "", 0, 0, 2],
    ]);
  });

  it("gives shots by each player's own handicap and shows ties", () => {
    const board = dayBoard([
      // 18 handicap gets a shot a hole: a 5 is a net par, 2 points.
      group(1, "stableford", [{ id: 1, name: "High", hcp: 18, strokes: [5, 5] }]),
      group(2, "stableford", [{ id: 2, name: "Low", hcp: 0, strokes: [4, 4] }]),
    ]);
    expect(board.rows.map((r) => [r.name, r.position, r.points])).toEqual([
      ["High", "T1", 4],
      ["Low", "T1", 4],
    ]);
  });

  it("ranks stroke play by net to par", () => {
    const board = dayBoard([
      group(1, "stroke", [{ id: 1, name: "A", hcp: 0, strokes: [5, 5] }]),
      group(2, "stroke", [{ id: 2, name: "B", hcp: 0, strokes: [4, 3] }]),
    ]);
    expect(board.format).toBe("stroke");
    expect(board.rows.map((r) => [r.name, r.netToPar])).toEqual([
      ["B", -1],
      ["A", 2],
    ]);
  });
});
