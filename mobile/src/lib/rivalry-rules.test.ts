import { describe, expect, it } from "vitest";

import type { CardHole } from "./live-scoring";
import { bestWins, guestKey, meetingsIn, recordLine, rivalLine, rivalries, streak, type RivalRound, type RivalRoundPlayer } from "./rivalry-rules";

const ME = "me";
const DAVE = "dave";
const CIARAN = "ciaran";

const card: CardHole[] = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }));

const player = (id: number, memberId: string | null, name: string, ch = 10, side: number | null = null, position = id): RivalRoundPlayer => ({
  id,
  memberId,
  name,
  side,
  courseHandicap: ch,
  playingHandicap: ch,
  position,
});

/** Every player scores `gross(playerId, hole)` on every hole. */
function round(id: number, playedOn: string, players: RivalRoundPlayer[], gross: (p: number, h: number) => number | null, extra: Partial<RivalRound> = {}): RivalRound {
  const scores = new Map<number, Map<number, number | null>>();
  for (const p of players) scores.set(p.id, new Map(card.map((h) => [h.hole, gross(p.id, h.hole)])));
  return { id, playedOn, courseName: "Portmarnock", finished: true, format: "stableford", matchFormat: null, teamCard: false, card, players, scores, ...extra };
}

describe("own balls in the same group", () => {
  it("is a net singles match between each two, stopping when decided", () => {
    // Level handicaps; I make 4s, Dave 5s: I win every hole, 10&8.
    const r = round(1, "2026-10-24", [player(1, ME, "Eire"), player(2, DAVE, "Dave")], (p) => (p === 1 ? 4 : 5));
    const [m] = meetingsIn(r, ME);
    expect(m.opponent.memberId).toBe(DAVE);
    expect(m.meeting).toMatchObject({ outcome: "won", margin: "10&8", how: "Stableford" });
  });

  it("gives the higher handicap the difference", () => {
    // Dave gets 18 shots: his 5s are net 4s, so every hole is halved.
    const r = round(1, "2026-10-24", [player(1, ME, "Eire", 2), player(2, DAVE, "Dave", 20)], (p) => (p === 1 ? 4 : 5));
    expect(meetingsIn(r, ME)[0].meeting).toMatchObject({ outcome: "halved", margin: "Halved" });
  });

  it("needs the round finished and enough holes from both", () => {
    const players = [player(1, ME, "Eire"), player(2, DAVE, "Dave")];
    expect(meetingsIn(round(1, "2026-10-24", players, () => 4, { finished: false }), ME)).toEqual([]);
    // Dave only did 9 holes, level: not decided.
    const short = round(1, "2026-10-24", players, (p, h) => (p === 2 && h > 9 ? null : 4));
    short.scores.get(2)!.forEach((_, h) => h > 9 && (short.scores.get(2) as Map<number, number | null>).delete(h));
    expect(meetingsIn(short, ME)).toEqual([]);
  });

  it("never counts a team card", () => {
    expect(meetingsIn(round(1, "2026-10-24", [player(1, ME, "Eire"), player(2, DAVE, "Dave")], () => 4, { teamCard: true }), ME)).toEqual([]);
  });
});

describe("matches", () => {
  const fourball = (gross: (p: number, h: number) => number | null) =>
    round(
      1,
      "2026-10-03",
      [player(1, ME, "Eire", 10, 1, 1), player(2, CIARAN, "Ciarán", 10, 1, 2), player(3, DAVE, "Dave", 10, 2, 3), player(4, null, "Shane (guest)", 10, 2, 4)],
      gross,
      { format: "matchplay", matchFormat: "fourball" }
    );

  it("counts the match's result against each player on the other side, never a partner", () => {
    // Side 1 wins every hole: 10&8.
    const ms = meetingsIn(fourball((p) => (p <= 2 ? 4 : 5)), ME);
    expect(ms.map((m) => m.opponent.name)).toEqual(["Dave", "Shane (guest)"]);
    expect(ms[0].meeting).toMatchObject({ outcome: "won", margin: "10&8", how: "Fourball, opposite sides" });
  });

  it("a lost match is lost to them", () => {
    expect(meetingsIn(fourball((p) => (p <= 2 ? 5 : 4)), ME)[0].meeting.outcome).toBe("lost");
  });

  it("no side, no head-to-head", () => {
    const r = fourball(() => 4);
    r.players[0].side = null;
    expect(meetingsIn(r, ME)).toEqual([]);
  });
});

describe("rivalries", () => {
  const vsDave = (id: number, on: string, mine: number, his: number) => round(id, on, [player(1, ME, "Eire"), player(2, DAVE, "Dave")], (p) => (p === 1 ? mine : his));
  const rounds = [
    vsDave(1, "2026-09-19", 5, 4), // lost
    vsDave(2, "2026-10-03", 4, 4), // halved
    vsDave(3, "2026-10-11", 4, 5), // won
    vsDave(4, "2026-10-24", 4, 5), // won
    vsDave(5, "2025-06-01", 4, 5), // won, last year
    round(6, "2026-10-01", [player(1, ME, "Eire"), player(2, null, "Shane (guest)")], (p) => (p === 1 ? 4 : 5)),
    round(7, "2026-08-01", [player(1, ME, "Eire"), player(2, null, "shane")], (p) => (p === 1 ? 4 : 5)),
  ];

  it("adds them up per opponent, the most played first, guests by name", () => {
    const list = rivalries(rounds, ME);
    expect(list.map((r) => [r.name, recordLine(r)])).toEqual([
      ["Dave", "3–1–1"],
      ["Shane", "2–0"],
    ]);
    expect(list[1].key).toBe(guestKey("Shane"));
    expect(list[1].lastPlayerId).toBe(2);
  });

  it("keeps to a season", () => {
    expect(recordLine(rivalries(rounds, ME, 2026)[0])).toBe("2–1–1");
  });

  it("streaks, best wins and the line under a rival", () => {
    const dave = rivalries(rounds, ME, 2026)[0];
    expect(streak(dave)).toEqual({ outcome: "won", count: 2 });
    expect(bestWins(dave).mine?.margin).toBe("10&8");
    expect(bestWins(dave).theirs?.margin).toBe("10&8");
    expect(rivalLine(dave)).toBe("You lead · won the last 2");
    expect(rivalLine({ ...dave, won: 1, lost: 1, meetings: dave.meetings.slice(0, 1) })).toBe("All square");
  });
});
