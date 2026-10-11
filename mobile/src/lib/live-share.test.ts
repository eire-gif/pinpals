import { describe, expect, it } from "vitest";

import { buildBoard, type CardHole } from "./live-scoring";
import { liveGameShareText, type ShareGame } from "./live-share";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const SI = [7, 15, 13, 1, 9, 5, 17, 11, 3, 12, 6, 16, 14, 2, 8, 18, 4, 10];
const CARD: CardHole[] = PARS.map((par, i) => ({ hole: i + 1, par, strokeIndex: SI[i] }));

const sheet = (rows: Record<number, (number | null)[]>) =>
  new Map(Object.entries(rows).map(([id, list]) => [Number(id), new Map(list.map((s, i) => [i + 1, s] as [number, number | null]))]));

const PLAYERS = [
  { id: 1, name: "Eire Byrne", playingHandicap: 10 },
  { id: 2, name: "Dave Morgan", playingHandicap: 18 },
];

const base = (over: Partial<ShareGame> = {}): ShareGame => {
  const scores = sheet({ 1: PARS.slice(0, 9).map((p) => p), 2: PARS.slice(0, 8).map((p) => p + 1) });
  return {
    courseName: "Portmarnock Golf Club",
    teeName: "Blue",
    playedOn: "2026-10-11",
    live: true,
    formatLabel: "Stableford",
    card: CARD,
    rows: PLAYERS.map((p) => ({ id: p.id, name: p.name })),
    scores,
    board: buildBoard("stableford", CARD, PLAYERS, scores),
    strokeLike: false,
    siteUrl: "https://www.pinpals.ie",
    ...over,
  };
};

describe("live game share text", () => {
  it("heads with the course, date, format and how far the group has got", () => {
    const text = liveGameShareText(base());
    const lines = text.split("\n");
    expect(lines[0]).toBe("⛳ Portmarnock Golf Club · Blue tees");
    expect(lines[1]).toBe("Sun 11 Oct 2026 · Stableford · Live · thru 9");
  });

  it("lists the leaderboard in its own order with points and thru", () => {
    const text = liveGameShareText(base());
    expect(text).toMatch(/1\. Eire Byrne {2}\d+ pts \(thru 9\)/);
    expect(text).toMatch(/2\. Dave Morgan {2}\d+ pts \(thru 8\)/);
    expect(text.indexOf("Eire Byrne  ")).toBeLessThan(text.indexOf("Dave Morgan  "));
  });

  it("writes every row's card, with dots for holes not played and nine totals", () => {
    const text = liveGameShareText(base());
    expect(text).toContain("Out: 4 4 3 5 4 4 3 4 5  (36)");
    expect(text).toContain("In:  · · · · · · · · ·");
    expect(text).toContain("Out: 5 5 4 6 5 5 4 5 ·  (39)");
    expect(text).toContain("Par: 4 4 3 5 4 4 3 4 5  (36) | 4 4 3 5 4 4 3 4 5  (36)");
  });

  it("shows a pick-up as P and leaves it out of the stroke total", () => {
    const scores = sheet({ 1: [4, null, 3] });
    const text = liveGameShareText(base({ scores, rows: [{ id: 1, name: "Eire Byrne" }], board: buildBoard("stableford", CARD, [PLAYERS[0]], scores) }));
    expect(text).toContain("Eire Byrne — 7");
    expect(text).toContain("Out: 4 P 3 · · · · · ·  (7)");
  });

  it("ranks stroke play on net and gross", () => {
    const scores = sheet({ 1: PARS.map((p) => p + 1), 2: PARS.map((p) => p + 1) });
    const text = liveGameShareText(
      base({ live: false, formatLabel: "Stroke play", strokeLike: true, scores, board: buildBoard("stroke", CARD, PLAYERS, scores) })
    );
    expect(text.split("\n")[1]).toBe("Sun 11 Oct 2026 · Stroke play · Final");
    expect(text).toContain("Dave Morgan  E net · 90 gross");
    expect(text).toContain("Eire Byrne  +8 net · 90 gross");
    expect(text).not.toContain("thru 18");
  });

  it("gives a match its state instead of a leaderboard", () => {
    const text = liveGameShareText(base({ board: null, heading: "Club Classic · Match 2", match: { status: "Murphys 2 UP", detail: "thru 9 · 9 to play" } }));
    expect(text.split("\n")[0]).toBe("Club Classic · Match 2");
    expect(text).toContain("🏆 Murphys 2 UP · thru 9 · 9 to play");
    expect(text).not.toMatch(/pts \(thru/);
  });

  it("handles a nine-hole card with no back nine", () => {
    const nine = CARD.slice(0, 9);
    const scores = sheet({ 1: [4, 4, 3] });
    const text = liveGameShareText(base({ card: nine, scores, rows: [{ id: 1, name: "Eire Byrne" }], board: buildBoard("stableford", nine, [PLAYERS[0]], scores) }));
    expect(text).not.toContain("In:");
    expect(text).toContain("Par: 4 4 3 5 4 4 3 4 5  (36)\n");
  });

  it("signs off with the short site address", () => {
    expect(liveGameShareText(base()).endsWith("Scored live on PinPals · pinpals.ie")).toBe(true);
    expect(liveGameShareText(base({ siteUrl: null })).endsWith("Scored live on PinPals")).toBe(true);
  });
});
