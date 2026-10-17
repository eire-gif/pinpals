import { describe, expect, it } from "vitest";
import { holesStillToScore, scoringPlayerIds, type CardHole } from "./live-scoring";

const card = [1, 2, 3].map((n) => ({ hole: n, par: 4, strokeIndex: n })) as CardHole[];
const players = [
  { id: 11, position: 2, side: 1 },
  { id: 10, position: 1, side: 1 },
  { id: 12, position: 3, side: 2 },
  { id: 13, position: 4, side: 2 },
];

describe("scoringPlayerIds", () => {
  it("is everyone for a normal round", () => {
    expect(scoringPlayerIds(players, { scramble: false, matchFormat: null })).toEqual([10, 11, 12, 13]);
  });
  it("is the team's first player in a scramble", () => {
    expect(scoringPlayerIds(players, { scramble: true, matchFormat: null })).toEqual([10]);
  });
  it("is each pair's first player in foursomes", () => {
    expect(scoringPlayerIds(players, { scramble: false, matchFormat: "foursomes" })).toEqual([10, 12]);
  });
});

describe("holesStillToScore", () => {
  it("lists holes with who is missing, empty when complete", () => {
    const scores = new Map([
      [10, new Map<number, number | null>([[1, 4], [2, 5], [3, null]])],
      [11, new Map<number, number | null>([[1, 4]])],
    ]);
    expect(holesStillToScore(card, [10, 11], scores)).toEqual([
      { hole: 2, playerIds: [11] },
      { hole: 3, playerIds: [11] },
    ]);
    // A pick-up (null) counts as scored.
    expect(holesStillToScore(card, [10], scores)).toEqual([]);
  });
});
