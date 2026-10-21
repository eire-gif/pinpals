import { describe, expect, it } from "vitest";

import { holeInPlay, irishDay, pickMyRound } from "./my-round";

const NOW = new Date("2026-10-21T13:30:00Z");
const r = (id: number, playedOn: string, status: "live" | "finished" = "live") => ({ id, status, playedOn, holes: 18, startHole: null });

describe("MY ROUND on the website", () => {
  it("uses the Irish date", () => {
    expect(irishDay(new Date("2026-10-21T23:30:00Z"))).toBe("2026-10-22"); // IST, after midnight in Dublin
    expect(irishDay(NOW, 1)).toBe("2026-10-20");
  });

  it("picks today's live round, newest first, never an old or finished one", () => {
    expect(pickMyRound([r(3, "2026-10-14")], NOW)).toBeNull();
    expect(pickMyRound([r(3, "2026-10-21", "finished")], NOW)).toBeNull();
    expect(pickMyRound([r(2, "2026-10-20"), r(5, "2026-10-21"), r(8, "2026-10-21")], NOW)?.id).toBe(8);
  });

  it("works out the hole in play, shotgun starts included", () => {
    expect(holeInPlay(18, null, [1, 2, 3])).toBe(4);
    expect(holeInPlay(18, 17, [17, 18])).toBe(1);
  });
});
