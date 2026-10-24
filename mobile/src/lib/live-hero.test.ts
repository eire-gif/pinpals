import { describe, expect, it } from "vitest";

import { heroSummary, type HeroInput } from "./live-hero";
import { blankCard, type ScoreSheet } from "./live-scoring";

const card = blankCard(18).map((h) => ({ ...h, par: 4, strokeIndex: h.hole }));
const players = [
  { id: 1, name: "Ann Byrne", playingHandicap: 0, position: 1, memberId: "me" },
  { id: 2, name: "Bob Kelly", playingHandicap: 0, position: 2, memberId: "b" },
  { id: 3, name: "Cian Ryan", playingHandicap: 0, position: 3, memberId: null },
  { id: 4, name: "Dan Walsh", playingHandicap: 0, position: 4, memberId: "d" },
];

/** Everyone scored `holes` holes; strokes per player id. */
function sheet(holes: number[], strokes: Record<number, number>): ScoreSheet {
  return new Map(players.map((p) => [p.id, new Map(holes.map((h) => [h, strokes[p.id]]))]));
}

const base = (scores: ScoreSheet, extra: Partial<HeroInput> = {}): HeroInput => ({
  format: "stableford",
  matchFormat: null,
  scramble: false,
  startHole: null,
  card,
  players,
  scores,
  ...extra,
});

const first11 = Array.from({ length: 11 }, (_, i) => i + 1);

describe("heroSummary", () => {
  it("counts the holes in and points at the next one", () => {
    const s = heroSummary(base(sheet(first11, { 1: 4, 2: 4, 3: 5, 4: 6 })), "me");
    expect(s.thru).toBe(11);
    expect(s.total).toBe(18);
    expect(s.next).toEqual({ hole: 12, par: 4 });
    expect(s.holes.filter((h) => h.state === "done")).toHaveLength(11);
    expect(s.holes.find((h) => h.state === "next")?.hole).toBe(12);
  });

  it("follows a shotgun start's playing order", () => {
    const s = heroSummary(base(sheet([7, 8, 9], { 1: 4, 2: 4, 3: 4, 4: 4 }), { startHole: 7 }), "me");
    expect(s.holes[0].hole).toBe(7);
    expect(s.next?.hole).toBe(10);
  });

  it("names you, and keeps you on the board when you're not top three", () => {
    const s = heroSummary(base(sheet(first11, { 1: 7, 2: 4, 3: 4, 4: 5 })), "me");
    expect(s.board).toHaveLength(4);
    expect(s.board?.[3]).toMatchObject({ name: "You", me: true });
    expect(s.board?.[0].value).toBe("22 pts");
  });

  it("shows net to par for stroke play", () => {
    const s = heroSummary(base(sheet([1, 2], { 1: 3, 2: 4, 3: 5, 4: 5 }), { format: "stroke" }), "me");
    expect(s.board?.[0]).toMatchObject({ name: "You", value: "-2" });
  });

  it("leaves the board to the round screen for matches and scrambles", () => {
    expect(heroSummary(base(sheet([1], { 1: 4, 2: 4, 3: 4, 4: 4 }), { format: "matchplay", matchFormat: "matchplay" }), "me").board).toBeNull();
    expect(heroSummary(base(sheet([1], { 1: 4, 2: 4, 3: 4, 4: 4 }), { format: "scramble", scramble: true }), "me").board).toBeNull();
  });

  it("has no next hole once every hole is in", () => {
    const all = Array.from({ length: 18 }, (_, i) => i + 1);
    const s = heroSummary(base(sheet(all, { 1: 4, 2: 4, 3: 4, 4: 4 })), "me");
    expect(s.thru).toBe(18);
    expect(s.next).toBeNull();
  });
});
