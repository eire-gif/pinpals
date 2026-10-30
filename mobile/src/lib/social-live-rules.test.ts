import { describe, expect, it } from "vitest";

import type { Match, MatchDayData } from "./live-match-days";
import {
  circleDetail,
  fourballRows,
  highlightsOf,
  initialsOf,
  movesSince,
  newHighlight,
  orderCircles,
  placeByDate,
  positionsOf,
  type LiveCircle,
} from "./social-live-rules";

const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));

function group(n: number, players: { id: number; name: string; strokes: (number | null)[] }[], team?: string): Match {
  const scores = new Map<number, Map<number, number | null>>();
  for (const p of players) scores.set(p.id, new Map(p.strokes.map((s, i) => [i + 1, s])));
  return {
    round: { id: 100 + n, format: "stableford", matchNumber: n, teeTime: null, status: "live", scramble: team ? { teamName: team } : null },
    players: players.map((p, i) => ({ id: p.id, name: p.name, playingHandicap: 0, courseHandicap: 0, position: i + 1, side: null })),
    card,
    scores,
    format: "matchplay",
    state: null,
  } as unknown as Match;
}

const day = (matches: Match[]): MatchDayData =>
  ({ day: { holes: 18, kind: "fourballs" }, matches, totals: { final: [0, 0], projected: [0, 0], finishedCount: 0 } }) as unknown as MatchDayData;

describe("circles", () => {
  it("post, mine, live days busiest first, shared cards, then results", () => {
    const circles: LiveCircle[] = [
      { kind: "results", dayId: 9, groupId: 1, groupName: "PGS", title: "Autumn Classic" },
      { kind: "day", dayId: 2, title: "Small", groupName: null, logoUrl: null, playing: 4 },
      { kind: "follow", followId: 5, name: "Conor", detail: "H7" },
      { kind: "day", dayId: 3, title: "Big", groupName: null, logoUrl: null, playing: 36 },
      { kind: "mine", roundId: 1, hole: 3 },
      { kind: "round", roundId: 8, name: "Ciarán", others: 3, courseName: "Lahinch" },
      { kind: "post" },
    ];
    expect(orderCircles(circles).map((c) => (c.kind === "day" ? c.title : c.kind))).toEqual(["post", "mine", "Big", "Small", "round", "follow", "results"]);
    expect(circleDetail({ kind: "round", roundId: 8, name: "Ciarán", others: 3, courseName: "Lahinch" })).toBe("Lahinch");
  });

  it("initials and the line under each", () => {
    expect(initialsOf("Portmarnock Golf Society")).toBe("PGS");
    expect(initialsOf("Algarve")).toBe("AL");
    expect(initialsOf("The Saturday Golf Buddies Club")).toBe("TSG");
    expect(initialsOf("  ")).toBe("?");
    expect(circleDetail({ kind: "day", dayId: 1, title: "x", groupName: null, logoUrl: null, playing: 12 })).toBe("12 playing");
    expect(circleDetail({ kind: "mine", roundId: 1, hole: 7 })).toBe("H7");
  });
});

describe("the live view's board", () => {
  it("ranks the day by points, with thru, and keeps a key per player", () => {
    const board = fourballRows(
      day([
        group(1, [
          { id: 1, name: "Paul", strokes: [3, 4, 4] },
          { id: 2, name: "Mary", strokes: [4, 4, 4] },
        ]),
        group(2, [{ id: 3, name: "Declan", strokes: [] }]),
      ])
    );
    expect(board.heading).toBe("PTS");
    expect(board.rows.map((r) => [r.position, r.name, r.value, r.thru, r.key])).toEqual([
      ["1", "Paul", "7", "3", "101:1"],
      ["2", "Mary", "6", "3", "101:2"],
      ["", "Declan", "–", "–", "102:3"],
    ]);
  });

  it("arrows only for players whose place changed", () => {
    const before = new Map([
      ["a", 2],
      ["b", 1],
      ["c", 3],
    ]);
    const rows = [
      { key: "a", position: "1", name: "A", value: "", thru: "", roundId: 1 },
      { key: "b", position: "2", name: "B", value: "", thru: "", roundId: 1 },
      { key: "c", position: "3", name: "C", value: "", thru: "", roundId: 1 },
      { key: "d", position: "4", name: "D", value: "", thru: "", roundId: 1 },
    ];
    expect([...movesSince(before, rows)]).toEqual([
      ["a", "up"],
      ["b", "down"],
    ]);
    expect([...positionsOf([{ key: "x", position: "T2", name: "", value: "", thru: "", roundId: 1 }, { key: "y", position: "", name: "", value: "", thru: "", roundId: 1 }])]).toEqual([["x", 2]]);
  });
});

describe("birdies", () => {
  const data = day([
    group(1, [
      { id: 1, name: "Paul", strokes: [3, 4, 2] },
      { id: 2, name: "Mary", strokes: [4, 1] },
    ]),
    group(2, [{ id: 3, name: "Ignored", strokes: [3] }], "The Blues"),
  ]);

  it("finds birdies, eagles and aces, by team name for a scramble", () => {
    expect(highlightsOf(data).map((h) => [h.name, h.hole, h.word])).toEqual([
      ["Paul", 1, "Birdie"],
      ["Paul", 3, "Eagle"],
      ["Mary", 2, "Hole in one"],
      ["The Blues", 1, "Birdie"],
    ]);
  });

  it("shows nothing on the first look, then the rarest new one", () => {
    const all = highlightsOf(data);
    expect(newHighlight(null, all)).toBeNull();
    const seen = new Set(all.filter((h) => h.word === "Birdie").map((h) => h.key));
    expect(newHighlight(seen, all)?.word).toBe("Hole in one");
    expect(newHighlight(new Set(all.map((h) => h.key)), all)).toBeNull();
  });
});

describe("results among posts", () => {
  it("each result goes before the first older post; older ones only on the last page", () => {
    const posts = ["2026-10-28T10", "2026-10-27T10", "2026-10-25T10"];
    const results = ["2026-10-26T09", "2026-10-28T12", "2026-10-20T00"];
    const placed = (last: boolean) => placeByDate(posts, results, (p) => p, (x) => x, last).map((e) => `${e.kind}:${e.item}`);
    expect(placed(false)).toEqual([
      "extra:2026-10-28T12",
      "post:2026-10-28T10",
      "post:2026-10-27T10",
      "extra:2026-10-26T09",
      "post:2026-10-25T10",
    ]);
    expect(placed(true).at(-1)).toBe("extra:2026-10-20T00");
  });
});
