import { describe, expect, it } from "vitest";

import { blankScorecard, headline, holeResult, playedLabel, roundPostFields, scorecardTotals, shareText, type ScorecardHole } from "./scorecard-math";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const SI = [7, 15, 13, 1, 9, 5, 17, 11, 3, 12, 6, 16, 14, 2, 8, 18, 4, 10];

const card = (strokes: (number | null)[]): ScorecardHole[] =>
  strokes.map((s, i) => ({ hole: i + 1, par: PARS[i], strokeIndex: SI[i], yards: 400, strokes: s, putts: s == null ? null : 2 }));

// Level par everywhere except a birdie on 1 and a double on 4.
const ROUND = PARS.map((p, i) => (i === 0 ? p - 1 : i === 3 ? p + 2 : p));

const META = { courseName: "Portmarnock Golf Club", teeName: "Blue", holes: 18 as const, playedOn: "2026-10-04", handicapIndex: 12.4, playingHandicap: 14 };

describe("scorecard totals", () => {
  it("adds up a complete round: out, in, total, vs par, counts", () => {
    const t = scorecardTotals(card(ROUND), null);
    expect(t.complete).toBe(true);
    expect(t.total.par).toBe(72);
    expect(t.total.strokes).toBe(73);
    expect(t.out.strokes).toBe(36 + 1);
    expect(t.in?.strokes).toBe(36);
    expect(t.vsPar).toBe(1);
    expect(t.counts).toMatchObject({ birdie: 1, par: 16, double: 1 });
    expect(t.total.yards).toBe(7200);
    expect(t.total.putts).toBe(36);
    expect(t.points).toBeNull();
  });

  it("scores Stableford from the playing handicap", () => {
    // Off 14: a shot on SI 1–14. Level par on a stroke hole is 3 points.
    const t = scorecardTotals(card(ROUND), 14);
    // 14 stroke holes at net birdie or better… computed independently:
    expect(t.points).toBe(
      ROUND.reduce((sum, s, i) => sum + Math.max(0, PARS[i] + 2 + (SI[i] <= 14 ? 1 : 0) - s), 0)
    );
    expect(t.net).toBe(73 - 14);
  });

  it("reads a card in progress as 'thru'", () => {
    const partial = card([...ROUND.slice(0, 11), ...Array(7).fill(null)]);
    const t = scorecardTotals(partial, null);
    expect(t.complete).toBe(false);
    expect(t.played).toBe(11);
    expect(t.total.strokes).toBeNull();
    expect(headline(t)).toBe("+1 thru 11");
  });

  it("handles a nine-hole card", () => {
    const nine = card(ROUND.slice(0, 9));
    const t = scorecardTotals(nine, null);
    expect(t.in).toBeNull();
    expect(t.total.strokes).toBe(t.out.strokes);
  });

  it("names results", () => {
    expect(holeResult(2, 5)).toBe("albatross");
    expect(holeResult(3, 5)).toBe("eagle");
    expect(holeResult(7, 4)).toBe("worse");
  });

  it("makes blank cards", () => {
    expect(blankScorecard(9)).toHaveLength(9);
    expect(blankScorecard(18)[17]).toMatchObject({ hole: 18, par: 4, strokes: null });
  });
});

describe("sharing", () => {
  it("writes a chat-friendly card with the link last", () => {
    const text = shareText(META, card(ROUND), "https://www.pinpals.ie/c/abc");
    expect(text.split("\n")[0]).toBe("⛳ Portmarnock Golf Club · Blue tees");
    expect(text).toContain("Sun 4 Oct 2026");
    expect(text).toContain("73 (+1)");
    expect(text).toContain("off 12.4");
    expect(text).toContain("Out 37 · In 36");
    expect(text).toContain("🐦 1 birdie");
    expect(text.endsWith("https://www.pinpals.ie/c/abc")).toBe(true);
  });

  it("dates read like a card", () => {
    expect(playedLabel("2026-10-09")).toBe("Fri 9 Oct 2026");
  });

  it("fills a round post only with what the card knows", () => {
    expect(roundPostFields(META, card(ROUND))).toEqual({
      holes: "18", course_par: "72", played_on: "2026-10-04", tee: "Blue", score: "73",
      front_nine: "37", back_nine: "36", birdies: "1", putts: "36",
    });
    const partial = roundPostFields(META, card([...ROUND.slice(0, 5), ...Array(13).fill(null)]));
    expect(partial.score).toBeUndefined();
    expect(partial.front_nine).toBeUndefined();
  });
});
