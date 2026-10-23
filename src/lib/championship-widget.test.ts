import { describe, expect, it } from "vitest";

import type { ChampionshipPayload } from "./championship";
import { championshipWidget } from "./championship-widget";
import { emptyPayload } from "./widget-board";

const p: ChampionshipPayload = {
  v: 1,
  id: 1,
  groupId: 1,
  title: "Autumn Classic",
  rule: "auto",
  tripOutingId: null,
  status: "open",
  days: [1, 2].map((round) => ({ round, playsOn: `2026-11-0${round}`, courseName: round === 1 ? "Portmarnock" : "The Island", firstTee: null, formatLabel: "Stableford", short: "STB", kind: "points", team: false, status: round === 1 ? "final" : "live", outingId: round, itemId: null, matchDayId: round, hidden: false, excluded: false })),
  scoring: [
    { round: 1, kind: "points", team: false, status: "final", rows: [{ memberIds: ["a"], score: 40, thru: 18, finished: true }, { memberIds: ["me"], score: 38, thru: 18, finished: true }] },
    { round: 2, kind: "points", team: false, status: "live", rows: [{ memberIds: ["a"], score: 20, thru: 9, finished: false }, { memberIds: ["me"], score: 30, thru: 13, finished: false }] },
  ],
  players: [
    { key: "m:a", name: "Ciarán Byrne", detail: null, memberId: "a" },
    { key: "m:me", name: "Eire", detail: null, memberId: "me" },
  ],
  updatedAt: "2026-11-02T12:00:00Z",
};

describe("championshipWidget", () => {
  it("shows the overall board with movement, and your overall place", () => {
    const base = { ...emptyPayload(new Date("2026-11-02T12:00:00Z")), state: "live" as const };
    const w = championshipWidget(base, p, "me");
    expect(w.eyebrow).toBe("PINPALS · AUTUMN CLASSIC");
    expect(w.title).toBe("Day 2 of 2 · The Island");
    expect(w.board?.rows).toEqual([
      { pos: "1", name: "You", thru: "13", score: "68", mine: true, good: true, move: 1 },
      { pos: "2", name: "Ciarán Byrne", thru: "9", score: "60", mine: false, good: false, move: -1 },
    ]);
    expect(w.mine).toEqual({ eyebrow: "AUTUMN CLASSIC", title: "Day 2 of 2 · thru 13", big: "1st ▲1", line1: "68 pts · 30 today", line2: "You lead" });
  });
});
