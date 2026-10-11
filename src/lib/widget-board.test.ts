import { describe, expect, it } from "vitest";

import type { CardHole } from "@/lib/live-scoring";
import { buildWidgetPayload, emptyPayload, ordinal, type WidgetGame, type WidgetPlayer, type WidgetRound } from "@/lib/widget-board";
import { signWidgetToken, verifyWidgetToken } from "@/lib/widget-token";

const NOW = new Date("2026-10-11T12:00:00Z");
const ME = "11111111-1111-4111-8111-111111111111";
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const SI = [7, 15, 13, 1, 9, 5, 17, 11, 3, 12, 6, 16, 14, 2, 8, 18, 4, 10];
const CARD: CardHole[] = PARS.map((par, i) => ({ hole: i + 1, par, strokeIndex: SI[i] }));

const round = (over: Partial<WidgetRound>): WidgetRound => ({
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

describe("ordinal", () => {
  it("writes places the way a golfer says them", () => {
    expect(["1", "2", "3", "4", "11", "12", "13", "21", "22", "T3", ""].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "T3", "–"]);
  });
});

describe("a Stableford round", () => {
  const g = game(
    { id: 7 },
    [player(1, "Eire Byrne", { memberId: ME }), player(2, "Dave Morgan"), player(3, "Tom Walsh")],
    { 1: PARS.slice(0, 9).map((p) => p + 1), 2: PARS.slice(0, 9).map((p) => p), 3: PARS.slice(0, 6).map((p) => p + 2) }
  );
  const p = buildWidgetPayload({ me: ME, focus: g, day: null, games: [g], now: NOW });

  it("is a points leaderboard with me marked, linking to the round", () => {
    expect(p.state).toBe("live");
    expect(p.url).toBe("pinpals://live/round/7");
    expect(p.board?.heading).toBe("PTS");
    expect(p.board?.rows.map((r) => r.name)).toEqual(["Dave Morgan", "Eire · You", "Tom Walsh"]);
    expect(p.board?.rows[1].mine).toBe(true);
    expect(p.board?.rows[0].thru).toBe("9");
  });

  it("gives the small widget my place and the leader", () => {
    expect(p.mine?.big).toBe("2nd");
    expect(p.mine?.line1).toMatch(/^\d+ pts · thru 9$/);
    expect(p.mine?.line2).toMatch(/^Leader: Dave \d+$/);
  });
});

describe("a stroke round that's over", () => {
  const g = game({ id: 8, format: "stroke", status: "finished" }, [player(1, "Eire Byrne", { memberId: ME, playingHandicap: 18 })], { 1: PARS.map((p) => p + 1) });
  const p = buildWidgetPayload({ me: ME, focus: g, day: null, games: [g], now: NOW });
  it("shows net to par, F for finished, and Final", () => {
    expect(p.state).toBe("final");
    expect(p.title).toBe("Portmarnock Links · Net");
    expect(p.board?.rows[0]).toMatchObject({ thru: "F", score: "E", mine: true });
    expect(p.mine?.line2).toBe("You're leading");
  });
});

describe("a match day", () => {
  const m1 = game(
    { id: 21, matchDayId: 5, matchNumber: 1, format: "matchplay", matchFormat: "fourball" },
    [
      player(1, "Eire Byrne", { memberId: ME, side: 1, position: 1 }),
      player(2, "Tom Walsh", { side: 1, position: 2 }),
      player(3, "Ciarán Ryan", { side: 2, position: 3 }),
      player(4, "Ruth Kelly", { side: 2, position: 4 }),
    ],
    // Side 1 wins holes 1 and 2, then all level to 11: 2 UP thru 11.
    { 1: [3, 3, ...PARS.slice(2, 11)], 2: PARS.slice(0, 11), 3: PARS.slice(0, 11), 4: PARS.slice(0, 11) }
  );
  const m2 = game(
    { id: 22, matchDayId: 5, matchNumber: 2, format: "matchplay", matchFormat: "matchplay" },
    [player(5, "Niamh Doyle", { side: 1, position: 1 }), player(6, "Darragh Shaw", { side: 2, position: 2 })],
    { 5: PARS.slice(0, 9), 6: [3, ...PARS.slice(1, 9)] }
  );
  const m3 = game(
    { id: 23, matchDayId: 5, matchNumber: 3, format: "matchplay", matchFormat: "matchplay", teeTime: "10:40" },
    [player(7, "Geoff Walsh", { side: 1, position: 1 }), player(8, "Sean Pat", { side: 2, position: 2 })],
    {}
  );
  const day = { id: 5, title: "Big Test", teamNames: ["Blues", "Golds"] as [string, string], kind: "match" as const };
  const p = buildWidgetPayload({ me: ME, focus: m1, day, games: [m2, m3, m1], now: NOW });

  it("totals the teams as things stand", () => {
    expect(p.eyebrow).toBe("PINPALS · BIG TEST");
    expect(p.teams).toEqual([
      { name: "Blues", points: "1", side: 1 },
      { name: "Golds", points: "1", side: 2 },
    ]);
  });

  it("lists matches in order with names, status and my match marked", () => {
    expect(p.matches.map((m) => m.label)).toEqual(["M1", "M2", "M3"]);
    expect(p.matches[0]).toMatchObject({ names: "Eire & Tom v Ciarán & Ruth", status: "2 UP · 11", side: 1, mine: true });
    expect(p.matches[1]).toMatchObject({ names: "Niamh v Darragh", status: "1 UP · 9", side: 2, mine: false });
    expect(p.matches[2]).toMatchObject({ status: "10:40", side: 0 });
    expect(p.url).toBe("pinpals://live/day/5");
  });

  it("gives the small widget my match", () => {
    expect(p.mine).toEqual({ eyebrow: "YOUR MATCH", title: "Match 1", big: "2 UP", line1: "Blues · thru 11", line2: "Eire & Tom v Ciarán & Ruth" });
  });
});

describe("a scramble", () => {
  const team = (id: number, name: string, scores: (number | null)[], mine = false) =>
    game(
      { id, matchDayId: 9, matchNumber: id, format: "stroke", scramble: { teamName: name, teamNumber: id, teamHandicap: 0 } },
      [player(id * 10, `${name} Lead`, { memberId: mine ? ME : null, position: 1 })],
      { [id * 10]: scores }
    );
  const eagles = team(1, "The Eagles", PARS.slice(0, 13).map((p, i) => (i < 8 ? p - 1 : p)));
  const bandits = team(2, "The Bandits", PARS.slice(0, 12).map((p, i) => (i < 6 ? p - 1 : p)), true);
  const late = team(3, "Team 3", []);
  const day = { id: 9, title: "Captain's Scramble", teamNames: null, kind: "scramble" as const };
  const p = buildWidgetPayload({ me: ME, focus: bandits, day, games: [late, bandits, eagles], now: NOW });

  it("ranks teams by net with mine marked and the not-started last", () => {
    expect(p.board?.rows.map((r) => [r.pos, r.name, r.thru, r.score])).toEqual([
      ["1", "The Eagles", "13", "-8"],
      ["2", "The Bandits · You", "12", "-6"],
      ["–", "Team 3", "–", "–"],
    ]);
    expect(p.title).toBe("Portmarnock Links · Net");
  });

  it("gives the small widget my team's place and the leader", () => {
    expect(p.mine).toEqual({ eyebrow: "SCRAMBLE", title: "The Bandits", big: "2nd", line1: "Net -6 · thru 12", line2: "Leader: The Eagles -8" });
  });
});

describe("nothing on", () => {
  it("says so and opens Live Scoring", () => {
    expect(emptyPayload(NOW)).toMatchObject({ state: "none", url: "pinpals://live", mine: null, board: null });
  });
});

describe("widget token", () => {
  const SECRET = "test-secret";
  it("round-trips the member id and refuses tampering, expiry and junk", () => {
    const { token, expiresAt } = signWidgetToken(ME, 1000, SECRET);
    expect(verifyWidgetToken(token, 2000, SECRET)).toBe(ME);
    expect(verifyWidgetToken(token, expiresAt + 1, SECRET)).toBeNull();
    expect(verifyWidgetToken(token, 2000, "other")).toBeNull();
    expect(verifyWidgetToken(token.replace(/^./, "x"), 2000, SECRET)).toBeNull();
    expect(verifyWidgetToken(undefined, 2000, SECRET)).toBeNull();
    expect(verifyWidgetToken("a.b.c", 2000, SECRET)).toBeNull();
  });
});
