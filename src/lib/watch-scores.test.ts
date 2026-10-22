import { describe, expect, it } from "vitest";

import { parseWatchScores } from "@/lib/watch-scores";

describe("the group's scores from a watch", () => {
  it("accepts scores, picked up and clear", () => {
    expect(
      parseWatchScores({
        hole: 7,
        scores: [
          { player_id: 12, strokes: 4 },
          { player_id: 13, strokes: null },
          { player_id: 14, clear: true, strokes: 99 },
        ],
      })
    ).toEqual({
      hole: 7,
      scores: [
        { player_id: 12, strokes: 4 },
        { player_id: 13, strokes: null },
        { player_id: 14, strokes: null, clear: true },
      ],
    });
  });

  it("refuses a bad hole, an empty or oversized list, and bad strokes", () => {
    expect(parseWatchScores(null)).toEqual({ error: "Expected JSON" });
    expect(parseWatchScores({ hole: 0, scores: [{ player_id: 1, strokes: 4 }] })).toHaveProperty("error");
    expect(parseWatchScores({ hole: 19, scores: [{ player_id: 1, strokes: 4 }] })).toHaveProperty("error");
    expect(parseWatchScores({ hole: 1, scores: [] })).toHaveProperty("error");
    expect(parseWatchScores({ hole: 1, scores: Array.from({ length: 9 }, () => ({ player_id: 1, strokes: 4 })) })).toHaveProperty("error");
    expect(parseWatchScores({ hole: 1, scores: [{ player_id: 1, strokes: 0 }] })).toHaveProperty("error");
    expect(parseWatchScores({ hole: 1, scores: [{ player_id: 1, strokes: 21 }] })).toHaveProperty("error");
    expect(parseWatchScores({ hole: 1, scores: [{ player_id: 1, strokes: 4.5 }] })).toHaveProperty("error");
    expect(parseWatchScores({ hole: 1, scores: [{ player_id: 1 }] })).toHaveProperty("error");
    expect(parseWatchScores({ hole: 1, scores: [{ strokes: 4 }] })).toHaveProperty("error");
    expect(parseWatchScores({ hole: 1, scores: [{ player_id: "1", strokes: 4 }] })).toHaveProperty("error");
  });
});
