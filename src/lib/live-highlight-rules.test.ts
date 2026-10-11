import { describe, expect, it } from "vitest";

import { highlightKind, highlightMessage, scorerLabel } from "@/lib/live-highlight-rules";

describe("which scores are announced", () => {
  it("birdie, eagle, albatross and hole in one — gross against par", () => {
    expect(highlightKind(3, 4)).toBe("birdie");
    expect(highlightKind(3, 5)).toBe("eagle");
    expect(highlightKind(2, 5)).toBe("albatross");
    expect(highlightKind(2, 4)).toBe("eagle");
    expect(highlightKind(1, 3)).toBe("hole_in_one");
    expect(highlightKind(1, 4)).toBe("hole_in_one");
  });
  it("not par or worse, a pick-up, or nonsense", () => {
    expect(highlightKind(4, 4)).toBeNull();
    expect(highlightKind(6, 4)).toBeNull();
    expect(highlightKind(null, 4)).toBeNull();
    expect(highlightKind(0, 4)).toBeNull();
    expect(highlightKind(2.5, 4)).toBeNull();
  });
});

describe("who gets the credit", () => {
  const players = [
    { name: "Eire Byrne", side: 1, position: 1 },
    { name: "Tom Walsh", side: 1, position: 2 },
    { name: "Ruth Kelly", side: 2, position: 3 },
  ];
  it("a player by first name", () => {
    expect(scorerLabel({ scorer: players[0], roundPlayers: players, scramble: null, oneBallPerSide: false })).toBe("Eire");
  });
  it("a foursomes pair", () => {
    expect(scorerLabel({ scorer: players[0], roundPlayers: players, scramble: null, oneBallPerSide: true })).toBe("Eire & Tom");
  });
  it("a scramble team", () => {
    expect(scorerLabel({ scorer: players[0], roundPlayers: players, scramble: { teamName: "The Bandits", teamNumber: 2 }, oneBallPerSide: false })).toBe("The Bandits");
    expect(scorerLabel({ scorer: players[0], roundPlayers: players, scramble: { teamName: null, teamNumber: 2 }, oneBallPerSide: false })).toBe("Team 2");
  });
});

describe("the words", () => {
  it("birdie", () => {
    expect(highlightMessage({ kind: "birdie", who: "Eire", hole: 7, par: 4, strokes: 3, course: "Portmarnock Links" })).toEqual({
      title: "🐦 Birdie for Eire!",
      body: "3 on the par-4 7th at Portmarnock Links. Tap for the leaderboard.",
    });
  });
  it("hole in one", () => {
    expect(highlightMessage({ kind: "hole_in_one", who: "Tom", hole: 12, par: 3, strokes: 1, course: "Lahinch" })).toEqual({
      title: "⛳️ HOLE IN ONE for Tom!",
      body: "An ace on the 12th (par 3) at Lahinch. Tap for the leaderboard.",
    });
  });
  it("eagle and albatross", () => {
    expect(highlightMessage({ kind: "eagle", who: "The Bandits", hole: 2, par: 5, strokes: 3, course: "X" }).title).toBe("🦅 Eagle for The Bandits!");
    expect(highlightMessage({ kind: "albatross", who: "Ruth", hole: 1, par: 5, strokes: 2, course: "X" }).body).toBe("2 on the par-5 1st at X. Tap for the leaderboard.");
  });
});
