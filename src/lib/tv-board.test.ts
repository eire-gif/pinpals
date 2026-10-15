import { describe, expect, it } from "vitest";

import type { CardHole } from "@/lib/live-scoring";
import { buildTvPayload, holeOn, ninesFor, type TvGame, type TvPlayer, type TvRound } from "@/lib/tv-board";
import { normaliseTvCode, signTvToken, verifyTvToken } from "@/lib/tv-token";

const NOW = new Date("2026-10-15T14:30:00Z");
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const SI = [7, 15, 13, 1, 9, 5, 17, 11, 3, 12, 6, 16, 14, 2, 8, 18, 4, 10];
const CARD: CardHole[] = PARS.map((par, i) => ({ hole: i + 1, par, strokeIndex: SI[i] }));

const round = (over: Partial<TvRound>): TvRound => ({
  id: 1, matchNumber: null, format: "stableford", matchFormat: null, status: "live", courseName: "The Island", teeTime: null, scramble: null, ...over,
});
const player = (id: number, name: string, over: Partial<TvPlayer> = {}): TvPlayer => ({
  id, memberId: `m${id}`, name, club: null, playingHandicap: 0, courseHandicap: 0, side: null, position: id, ...over,
});

/** Scores hole by hole from `start`, a minute apart. */
function game(r: Partial<TvRound>, players: TvPlayer[], scores: Record<number, (number | null)[]>, start = 1): TvGame {
  const sheet = new Map<number, Map<number, number | null>>();
  const entries: TvGame["entries"] = [];
  for (const [id, list] of Object.entries(scores)) {
    const m = new Map<number, number | null>();
    list.forEach((s, i) => {
      const hole = ((start - 1 + i) % 18) + 1;
      m.set(hole, s);
      entries.push({ playerId: Number(id), hole, strokes: s, at: new Date(NOW.getTime() - (60 - i) * 60_000).toISOString() });
    });
    sheet.set(Number(id), m);
  }
  return { round: round(r), players, card: CARD, scores: sheet, entries };
}

describe("a society day on one board", () => {
  const g1 = game(
    { id: 11, matchNumber: 1, teeTime: "10:00" },
    [player(1, "Ciarán Byrne", { club: "The Island", playingHandicap: 12 }), player(2, "Niamh Kelly", { club: "Portmarnock", playingHandicap: 18 })],
    { 1: PARS.slice(0, 15).map((p, i) => (i === 14 ? p - 1 : p)), 2: PARS.slice(0, 15).map((p) => p + 1) }
  );
  const g2 = game(
    { id: 12, matchNumber: 2, teeTime: "10:10" },
    [player(3, "Ruth O'Neill", { memberId: null, playingHandicap: 22 })],
    { 3: PARS.map((p) => p + 1) },
  );
  const g3 = game({ id: 13, matchNumber: 3, teeTime: "10:20" }, [player(4, "Seán Murphy", { playingHandicap: 7 })], {});
  const p = buildTvPayload({ day: { id: 5, title: "Autumn Outing", teamNames: null, kind: "fourballs" }, games: [g1, g2, g3], published: false, now: NOW });

  it("ranks every group together by points, not-started last", () => {
    expect(p.kind).toBe("players");
    expect(p.title).toBe("Autumn Outing · The Island");
    expect(p.rows.map((r) => r.name)).toEqual(["Ciarán Byrne", "Ruth O'Neill", "Niamh Kelly", "Seán Murphy"]);
    expect(p.rows[0].pos).toBe("1");
    expect(p.rows[3].pos).toBe("");
  });

  it("shows club, handicap, the hole they're on, and both nines", () => {
    const c = p.rows[0];
    expect(c.sub).toBe("The Island");
    expect(c.hcp).toBe("12");
    expect(c.on).toBe("16");
    expect(c.out).toBe(String(ninesFor(CARD, 12, g1.scores.get(1)).out.points));
    const ruth = p.rows.find((r) => r.name === "Ruth O'Neill")!;
    expect(ruth.sub).toBe("Guest");
    expect(ruth.on).toBe("F");
    expect(ruth.done).toBe(true);
    expect(p.rows[3].on).toBe("10:20");
  });

  it("lists the birdie, credited and placed", () => {
    expect(p.highlights).toHaveLength(1);
    const h = p.highlights[0];
    expect(h.kind).toBe("birdie");
    expect(h.headline).toBe("Birdie!");
    expect(h.who).toBe("Ciarán Byrne");
    expect(h.hole).toBe(15);
    expect(h.rowKey).toBe("p1");
    expect(h.now).toBe("1");
    expect(h.points).toMatch(/^\+\d$/);
  });

  it("says how many are out and what's provisional", () => {
    expect(p.subtitle).toBe("Individual Stableford · Net · 4 players · 1 group out");
    expect(p.note).toMatch(/provisional/);
    expect(p.stats).toContainEqual({ label: "Cards in", value: "1 of 4" });
  });
});

describe("the hole a group is on", () => {
  it("follows a two-tee start from the 10th, wrapping to the 1st", () => {
    const g = game({}, [player(1, "A")], { 1: PARS.slice(9, 18).map((p) => p) }, 10);
    expect(holeOn(g, 9)).toBe("1");
  });
});

describe("a stroke play round", () => {
  const g = game({ id: 20, format: "stroke" }, [player(1, "A", { playingHandicap: 10 }), player(2, "B")], { 1: PARS.slice(0, 9).map((p) => p + 1), 2: PARS.slice(0, 9) });
  const p = buildTvPayload({ day: null, games: [g], published: false, now: NOW });
  it("ranks on net, with gross for each nine", () => {
    expect(p.scoreHeading).toBe("NET");
    expect(p.ninesHeading).toBe("GROSS");
    // A's ten shots give back five on the front nine: bogeys are net +4, B's pars level.
    expect(p.rows.map((r) => `${r.name} ${r.score}`)).toEqual(["B E", "A +4"]);
    expect(p.rows[0].out).toBe(String(PARS.slice(0, 9).reduce((a, b) => a + b, 0)));
    expect(p.rows[0].inn).toBe("–");
  });
});

describe("a match day", () => {
  const blues = (id: number, name: string) => player(id, name, { side: 1 });
  const golds = (id: number, name: string) => player(id, name, { side: 2 });
  const m1 = game({ id: 31, matchNumber: 1, format: "matchplay", matchFormat: "matchplay" }, [blues(1, "Eire Byrne"), golds(2, "Tom Walsh")], {
    1: PARS.slice(0, 11).map((p, i) => (i < 2 ? p - 1 : p)),
    2: PARS.slice(0, 11),
  });
  const m2 = game({ id: 32, matchNumber: 2, format: "matchplay", matchFormat: "matchplay", teeTime: "11:00" }, [blues(3, "Niamh"), golds(4, "Darragh")], {});
  const p = buildTvPayload({ day: { id: 9, title: "The Big Test", teamNames: ["Blues", "Golds"], kind: "match" }, games: [m1, m2], published: false, now: NOW });

  it("has the team totals, the projection and each match", () => {
    expect(p.kind).toBe("matches");
    expect(p.teams.map((t) => `${t.name} ${t.points}`)).toEqual(["Blues 0", "Golds 0"]);
    expect(p.projected).toEqual({ left: "1", right: "0" });
    expect(p.toWin).toBe("1½ to win");
    expect(p.matches[0]).toMatchObject({ label: "M1", left: "Eire", right: "Tom", status: "2 UP", side: 1, thru: "thru 11" });
    expect(p.matches[1]).toMatchObject({ status: "–", thru: "Tees off 11:00" });
  });

  it("flashes the birdies", () => {
    expect(p.highlights.map((h) => `${h.who} ${h.hole}`)).toEqual(["Eire Byrne 2", "Eire Byrne 1"]);
  });
});

describe("a scramble", () => {
  const team = (id: number, n: number, name: string | null) =>
    game({ id, matchNumber: n, format: "stroke", scramble: { teamName: name, teamNumber: n, teamHandicap: 4, foursomes: null } }, [player(id * 10, "Pat Doyle"), player(id * 10 + 1, "Bill Nolan")], {
      [id * 10]: PARS.slice(0, 6).map((p, i) => (i === 0 && n === 1 ? p - 1 : p)),
    });
  const p = buildTvPayload({ day: { id: 3, title: "Captain's Scramble", teamNames: null, kind: "scramble" }, games: [team(4, 1, "The Eagles"), team(5, 2, null)], published: true, now: NOW });
  it("ranks teams on net with the players listed", () => {
    expect(p.kind).toBe("teams");
    expect(p.rows.map((r) => r.name)).toEqual(["The Eagles", "Team 2"]);
    expect(p.rows[0].sub).toBe("Pat, Bill");
    expect(p.rows[0].hcp).toBe("4");
    expect(p.note).toMatch(/published/);
  });
  it("credits the team, not the player", () => {
    expect(p.highlights[0].who).toBe("The Eagles");
    expect(p.highlights[0].rowKey).toBe("t4");
  });
});

describe("TV links and codes", () => {
  const secret = "test-secret-test-secret-test-secret";
  it("opens only the game it was made for, until it expires", () => {
    const { token } = signTvToken({ kind: "day", id: 42 }, 1_000, secret);
    expect(verifyTvToken(token, 2_000, secret)).toEqual({ kind: "day", id: 42 });
    expect(verifyTvToken(token, 1_000 + 3 * 24 * 3600 * 1000 + 1, secret)).toBeNull();
    expect(verifyTvToken(token, 2_000, "another-secret-another-secret-xx")).toBeNull();
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, k: "d", i: 43, exp: 9e15 })).toString("base64url");
    expect(verifyTvToken(`${forged}.${sig}`, 2_000, secret)).toBeNull();
    expect(verifyTvToken(`${payload}.${sig}.x`, 2_000, secret)).toBeNull();
  });

  it("reads a code however it's typed, and refuses look-alikes", () => {
    expect(normaliseTvCode("k7q 4mp")).toBe("K7Q4MP");
    expect(normaliseTvCode("K7Q-4MP")).toBe("K7Q4MP");
    expect(normaliseTvCode("K7Q4M0")).toBeNull();
    expect(normaliseTvCode("K7Q4M")).toBeNull();
    expect(normaliseTvCode(123456)).toBeNull();
  });
});
