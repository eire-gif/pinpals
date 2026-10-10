import { describe, expect, it } from "vitest";

import type { ScorecardHole } from "./scorecard-math";
import { scorecardStats, type StatCard } from "./scorecard-stats";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const holes = (strokes: (number | null)[], putts = true): ScorecardHole[] =>
  strokes.map((s, i) => ({ hole: i + 1, par: PARS[i], strokeIndex: i + 1, yards: null, strokes: s, putts: s == null || !putts ? null : 2 }));
const card = (id: number, strokes: (number | null)[], extra: Partial<StatCard> = {}): StatCard => ({
  id,
  courseName: `Course ${id}`,
  playedOn: "2026-10-09",
  holes: 18,
  playingHandicap: 10,
  holeList: holes(strokes),
  ...extra,
});

describe("scorecard stats", () => {
  // Level par with an eagle on 4 (par 5 in 3) and a birdie on 1.
  const good = PARS.map((p, i) => (i === 3 ? 3 : i === 0 ? 3 : p));
  // Bogey every hole.
  const bad = PARS.map((p) => p + 1);
  const half = [...PARS.slice(0, 9).map((p) => p - 1), ...Array(9).fill(null)];

  it("best and average are finished eighteens; birdies count from every card", () => {
    const s = scorecardStats([card(1, good), card(2, bad), card(3, half)]);
    expect(s.cards).toBe(3);
    expect(s.rounds).toBe(2);
    expect(s.best).toMatchObject({ id: 1, strokes: 69, vsPar: -3 });
    expect(s.average).toBe(79.5);
    expect(s.eagles).toBe(1);
    expect(s.birdies).toBe(1 + 9);
    expect(s.holesPlayed).toBe(45);
    expect(s.puttsPerRound).toBe(36);
    expect(s.bestPoints?.id).toBe(1);
  });

  it("no average from one round, nothing from no cards", () => {
    expect(scorecardStats([card(1, good)]).average).toBeNull();
    const none = scorecardStats([]);
    expect(none.best).toBeNull();
    expect(none.parOrBetterPct).toBeNull();
  });

  it("a nine-hole card is a round but never the best 18", () => {
    const nine = card(4, PARS.slice(0, 9), { holes: 9, holeList: holes(PARS.slice(0, 9)) });
    const s = scorecardStats([nine]);
    expect(s.rounds).toBe(1);
    expect(s.best).toBeNull();
  });
});
