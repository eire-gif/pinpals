import { describe, expect, it } from "vitest";

import { buildFollowCard, newHighlight, toneOf } from "@/lib/follow-card";
import type { CardHole } from "@/lib/live-scoring";
import type { WidgetGame, WidgetPlayer, WidgetRound } from "@/lib/widget-board";

const NOW = new Date("2026-10-17T12:00:00Z");
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const SI = [7, 15, 13, 1, 9, 5, 17, 11, 3, 12, 6, 16, 14, 2, 8, 18, 4, 10];
const CARD: CardHole[] = PARS.map((par, i) => ({ hole: i + 1, par, strokeIndex: SI[i] }));

const round = (over: Partial<WidgetRound> = {}): WidgetRound => ({
  id: 1, matchDayId: null, matchNumber: null, format: "stableford", matchFormat: null, status: "live",
  courseName: "Portmarnock Links", teeTime: null, scramble: null, ...over,
});
const player = (id: number, name: string, over: Partial<WidgetPlayer> = {}): WidgetPlayer => ({
  id, memberId: null, name, playingHandicap: 0, courseHandicap: 0, side: null, position: id, ...over,
});
const sheet = (rows: Record<number, (number | null)[]>) =>
  new Map(Object.entries(rows).map(([id, list]) => [Number(id), new Map(list.map((s, i) => [i + 1, s] as [number, number | null]))]));
const game = (r: Partial<WidgetRound>, players: WidgetPlayer[], scores: Record<number, (number | null)[]>): WidgetGame => ({
  round: round(r), players, card: CARD, scores: sheet(scores),
});

describe("toneOf", () => {
  it("names a score against par, a hole in one first", () => {
    expect([toneOf(1, 3), toneOf(2, 5), toneOf(3, 5), toneOf(3, 4), toneOf(4, 4), toneOf(5, 4), toneOf(7, 4), toneOf(null, 4), toneOf(undefined, 4)]).toEqual([
      "ace", "albatross", "eagle", "birdie", "par", "bogey", "double", "pickup", "none",
    ]);
  });
});

describe("a junior's Stableford card", () => {
  // Aoife off 18 gets a shot a hole; nett par everywhere is 2 points.
  const g = game(
    {},
    [player(1, "Dad Walsh", { playingHandicap: 10 }), player(2, "Aoife Walsh", { playingHandicap: 18 }), player(3, "Tom Byrne", { playingHandicap: 5 })],
    { 1: [4, 4, 3, 5, 4], 2: [5, 4, 4, 6, null], 3: [4, 4, 3, 5, 4] },
  );
  const c = buildFollowCard({ game: g, playerId: 2, playedOn: "2026-10-17", now: NOW })!;

  it("shows only her card, points per hole, and where she's playing now", () => {
    expect(c.name).toBe("Aoife Walsh");
    expect(c.firstName).toBe("Aoife");
    expect(c.handicapLine).toBe("Plays off 18");
    expect(c.holes.slice(0, 5).map((h) => h.value)).toEqual(["2", "3", "2", "2", "0"]);
    expect(c.holes[1].tone).toBe("par");
    expect(c.holes[4].tone).toBe("pickup");
    expect(c.holes[5].strokes).toBeUndefined();
    expect(c.holes[5].value).toBe("");
    expect(c.nowPlaying).toBe(6);
    expect(c.summary).toEqual({ big: "9", unit: "pts", progress: "Thru 5", place: expect.stringMatching(/ of 3$/), extra: null });
    expect(c.dateLabel).toBe("Sat 17 Oct");
  });

  it("never carries anyone else's name or score", () => {
    const text = JSON.stringify(c);
    expect(text).not.toContain("Dad");
    expect(text).not.toContain("Tom");
  });

  it("totals Out and In; a pick-up makes the gross NR", () => {
    expect(c.halves[0]).toEqual({ label: "Out", par: 36, strokes: "NR", value: "9" });
    expect(c.halves[1]).toEqual({ label: "In", par: 36, strokes: "", value: "" });
  });
});

describe("a stroke round, finished", () => {
  const g = game({ format: "stroke", status: "finished" }, [player(1, "Ciara", { playingHandicap: 18 })], { 1: PARS.map((p) => p + 1) });
  const c = buildFollowCard({ game: g, playerId: 1, now: NOW })!;
  it("is net to par, final, gross shown, no place on her own", () => {
    expect(c.state).toBe("final");
    expect(c.valueHeading).toBe("NET");
    expect(c.summary).toEqual({ big: "E", unit: "net", progress: "Finished", place: null, extra: "Gross 90" });
    expect(c.nowPlaying).toBeNull();
  });
});

describe("a singles match", () => {
  const g = game(
    { format: "matchplay", matchFormat: "matchplay" },
    [player(1, "Aoife", { courseHandicap: 0, side: 1 }), player(2, "Opponent", { courseHandicap: 0, side: 2, position: 2 })],
    { 1: [4, 3, 3], 2: [4, 4, 4] },
  );
  it("reads from the followed player's side", () => {
    const a = buildFollowCard({ game: g, playerId: 1, now: NOW })!;
    expect(a.valueHeading).toBe("MATCH");
    expect(a.holes.slice(0, 3).map((h) => h.value)).toEqual(["½", "W", "W"]);
    expect(a.summary.big).toBe("2 UP");
    expect(a.summary.place).toBeNull();
    expect(JSON.stringify(a)).not.toContain("Opponent");
    const b = buildFollowCard({ game: g, playerId: 2, now: NOW })!;
    expect(b.summary.big).toBe("2 DOWN");
    expect(b.holes.slice(0, 3).map((h) => h.value)).toEqual(["½", "L", "L"]);
  });
});

describe("a scramble team", () => {
  const g = game(
    { scramble: { teamName: "The Blues", teamNumber: 1, teamHandicap: 4 }, format: "stroke" },
    [player(1, "Aoife Walsh"), player(2, "Mark", { position: 2 })],
    { 1: [3, 4, 3] },
  );
  it("follows the team's one ball, under the player's name", () => {
    const c = buildFollowCard({ game: g, playerId: 2, now: NOW })!;
    expect(c.name).toBe("Mark · The Blues");
    expect(c.handicapLine).toBe("Team handicap 4");
    expect(c.holes[0].strokes).toBe(3);
    expect(c.formatLabel).toBe("Scramble");
  });
});

describe("newHighlight", () => {
  const before = buildFollowCard({ game: game({}, [player(1, "A")], { 1: [4] }), playerId: 1, now: NOW });
  const after = buildFollowCard({ game: game({}, [player(1, "A")], { 1: [4, 3] }), playerId: 1, now: NOW })!;
  it("spots a new birdie between polls, and nothing on the first load", () => {
    expect(newHighlight(before, after)).toEqual({ hole: 2, tone: "birdie" });
    expect(newHighlight(null, after)).toBeNull();
    expect(newHighlight(after, after)).toBeNull();
  });
});

it("returns null for a player who isn't in the game", () => {
  expect(buildFollowCard({ game: game({}, [player(1, "A")], {}), playerId: 99, now: NOW })).toBeNull();
});
