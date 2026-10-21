import { describe, expect, it } from "vitest";

import { holeInPlay, myRoundLabel, onMyRoundScreen, pickMyRound, type MyRoundCandidate } from "./my-round-rules";

const TODAY = new Date(2026, 9, 21, 14, 30); // 21 Oct 2026, local
const round = (over: Partial<MyRoundCandidate>): MyRoundCandidate => ({
  id: 1,
  status: "live",
  playedOn: "2026-10-21",
  holes: 18,
  startHole: null,
  ...over,
});

describe("pickMyRound", () => {
  it("shows nothing when you're in no live round", () => {
    expect(pickMyRound([], TODAY)).toBeNull();
    expect(pickMyRound([round({ status: "finished" })], TODAY)).toBeNull();
  });

  it("ignores a round nobody finished last week", () => {
    expect(pickMyRound([round({ playedOn: "2026-10-14" })], TODAY)).toBeNull();
  });

  it("keeps a twilight round that ran past midnight", () => {
    expect(pickMyRound([round({ playedOn: "2026-10-20" })], TODAY)?.id).toBe(1);
  });

  it("picks today's over yesterday's, then the newest", () => {
    const picked = pickMyRound(
      [round({ id: 4, playedOn: "2026-10-20" }), round({ id: 7 }), round({ id: 9 }), round({ id: 12, status: "finished" })],
      TODAY
    );
    expect(picked?.id).toBe(9);
  });
});

describe("holeInPlay", () => {
  it("is the 1st before a score goes in", () => {
    expect(holeInPlay(18, null, [])).toBe(1);
  });

  it("is the first hole nobody has scored", () => {
    expect(holeInPlay(18, null, [1, 2, 3, 4, 5, 6])).toBe(7);
  });

  it("follows a shotgun start round the course", () => {
    expect(holeInPlay(18, 7, [])).toBe(7);
    expect(holeInPlay(18, 16, [16, 17, 18])).toBe(1);
  });

  it("stays on the last hole once every hole is in", () => {
    const all = Array.from({ length: 18 }, (_, i) => i + 1);
    expect(holeInPlay(18, null, all)).toBe(18);
    expect(holeInPlay(18, 7, all)).toBe(6);
  });

  it("knows a nine-hole round", () => {
    expect(holeInPlay(9, null, [1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(9);
    expect(holeInPlay(9, 12, [])).toBe(1); // a start hole off the card: from the 1st
  });
});

describe("myRoundLabel", () => {
  it("reads MY ROUND · H7, or H7 on a busy bar", () => {
    expect(myRoundLabel({ id: 1, hole: 7 }, false)).toEqual({ text: "MY ROUND", detail: "H7" });
    expect(myRoundLabel({ id: 1, hole: 7 }, true)).toEqual({ text: "H7", detail: null });
  });
});

describe("onMyRoundScreen", () => {
  it("goes still only on that round's own scoring screen", () => {
    expect(onMyRoundScreen("/live/round/12", 12)).toBe(true);
    expect(onMyRoundScreen("/live/round/12/", 12)).toBe(true);
    expect(onMyRoundScreen("/live/round/120", 12)).toBe(false);
    expect(onMyRoundScreen("/live", 12)).toBe(false);
    expect(onMyRoundScreen(null, 12)).toBe(false);
  });
});
