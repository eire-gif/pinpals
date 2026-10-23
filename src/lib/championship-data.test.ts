import { describe, expect, it } from "vitest";

import type { DayRow } from "./championship";
import { applyPublished, scoreDay } from "./championship-data";
import type { Results } from "./competition-results";
import type { TvGame } from "./tv-board";

const card = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));
const round = (id: number, format: string, extra: Partial<TvGame["round"]> = {}): TvGame["round"] => ({
  id,
  matchNumber: id,
  format,
  matchFormat: null,
  status: "live",
  courseName: "The Island",
  teeTime: null,
  scramble: null,
  ...extra,
});
const player = (id: number, memberId: string | null, name: string, hcp = 0) => ({ id, memberId, name, club: null, playingHandicap: hcp, courseHandicap: hcp, side: null, position: id });

describe("scoreDay", () => {
  it("individual Stableford: points so far, per member", () => {
    const g: TvGame = {
      round: round(1, "stableford"),
      players: [player(1, "a", "Ann"), player(2, null, "Guest Bob")],
      card,
      scores: new Map([
        [1, new Map([[1, 3], [2, 4]])],
        [2, new Map()],
      ]),
      entries: [],
    };
    const d = scoreDay([g], { kind: "fourballs", foursomes_scoring: null, greensomes: null });
    expect(d.kind).toBe("points");
    expect(d.rows).toEqual([
      { memberIds: ["a"], guestNames: [], score: 5, thru: 2, finished: false },
      { memberIds: [], guestNames: ["Guest Bob"], score: null, thru: 0, finished: false },
    ]);
  });

  it("a scramble team: every member gets the side's net to par", () => {
    const g: TvGame = {
      round: round(1, "stroke", { scramble: { teamName: "Eagles", teamNumber: 1, teamHandicap: 0, foursomes: null, greensomes: false } }),
      players: [player(1, "a", "Ann"), player(2, "b", "Bob")],
      card,
      scores: new Map([[1, new Map([[1, 3], [2, 3]])]]),
      entries: [],
    };
    const d = scoreDay([g], { kind: "scramble", foursomes_scoring: null, greensomes: null });
    expect(d.team).toBe(true);
    expect(d.kind).toBe("net");
    expect(d.rows[0]).toMatchObject({ memberIds: ["a", "b"], score: -2, thru: 2 });
  });

  it("a match day isn't on the leaderboard", () => {
    expect(scoreDay([], { kind: "match", foursomes_scoring: null, greensomes: null }).excluded).toBe(true);
  });
});

describe("applyPublished", () => {
  it("takes the published points and places, and drops DQs", () => {
    const rows: DayRow[] = [
      { memberIds: ["a"], score: 36, thru: 18, finished: true },
      { memberIds: ["b"], score: 36, thru: 18, finished: true },
      { memberIds: ["c"], score: 30, thru: 18, finished: true },
    ];
    const row = (m: string, points: number, position: number | null, status = "ok") => ({ memberIds: [m], points, position, status });
    const results = {
      basis: "stableford",
      divisions: [{ label: "Overall", range: null, ranking: { basis: "stableford", ties: [], rows: [row("a", 36, 2), row("b", 37, 1), row("c", 30, null, "dq")] } }],
    } as unknown as Results;
    applyPublished(rows, results);
    expect(rows.map((r) => [r.score, r.position])).toEqual([
      [36, 2],
      [37, 1],
      [null, null],
    ]);
  });

  it("matches guests by name and puts amended net scores to par", () => {
    const rows: DayRow[] = [
      { memberIds: ["a"], score: -1, thru: 18, finished: true, par: 72 },
      { memberIds: [], guestNames: ["Guest Bob"], score: 2, thru: 18, finished: true, par: 72 },
    ];
    const results = {
      basis: "stroke",
      divisions: [
        {
          label: "Overall",
          range: null,
          ranking: {
            basis: "stroke",
            ties: [],
            rows: [
              { memberIds: ["a"], name: "Ann", guest: false, net: "70.5", points: null, position: 1, status: "ok" },
              { memberIds: [], name: "Guest Bob", guest: true, net: "73", points: null, position: null, status: "ok" },
            ],
          },
        },
      ],
    } as unknown as Results;
    applyPublished(rows, results);
    expect(rows.map((r) => [r.score, r.position])).toEqual([
      [-1.5, 1],
      [1, null],
    ]);
  });
});
