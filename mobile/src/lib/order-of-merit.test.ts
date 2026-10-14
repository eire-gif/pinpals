import { describe, expect, it } from "vitest";

import { DEFAULT_MERIT_RULES, meritSeason, orderOfMerit, type MeritEvent } from "./order-of-merit";

type Row = { key: string; name: string; memberIds: string[]; guest: boolean; status: string; position: number | null; positionLabel: string };

function event(id: number, playedOn: string, rows: Row[], team = false): MeritEvent {
  return {
    id,
    playedOn,
    results: {
      team,
      event: { title: `Event ${id}`, courseName: "Seapoint", playedOn },
      divisions: [{ label: "Overall", range: null, ranking: { basis: "stableford", rows, ties: [] } }],
    } as unknown as MeritEvent["results"],
  };
}
const r = (id: string, position: number | null, extra: Partial<Row> = {}): Row => ({ key: id, name: id.toUpperCase(), memberIds: [id], guest: false, status: "ok", position, positionLabel: position ? String(position) : "", ...extra });

describe("order of merit", () => {
  it("adds place and attendance points, and ignores guests and no returns", () => {
    const rows = orderOfMerit(
      [event(1, "2026-04-01", [r("a", 1), r("b", 2), r("g", 3, { guest: true }), r("c", null, { status: "nr" })]), event(2, "2026-05-01", [r("b", 1), r("a", 3)])],
      { ...DEFAULT_MERIT_RULES, points: [10, 6, 4], attendancePoints: 1 }
    );
    expect(rows.map((x) => [x.memberId, x.points, x.positionLabel])).toEqual([
      ["b", 18, "1"],
      ["a", 16, "2"],
    ]);
  });

  it("counts only the best N, and shares level places", () => {
    const rows = orderOfMerit(
      [event(1, "2026-04-01", [r("a", 1), r("b", 2)]), event(2, "2026-05-01", [r("a", 3), r("b", 1)]), event(3, "2026-06-01", [r("a", 2), r("b", 3)])],
      { ...DEFAULT_MERIT_RULES, points: [10, 6, 4], attendancePoints: 0, bestOf: 2 }
    );
    expect(rows.find((x) => x.memberId === "a")!.points).toBe(16);
    expect(rows.find((x) => x.memberId === "b")!.points).toBe(16);
    expect(rows.map((x) => x.positionLabel)).toEqual(["=1", "=1"]);
    expect(rows.find((x) => x.memberId === "a")!.scores.filter((s) => !s.counted)).toHaveLength(1);
  });

  it("scores each player in a team, unless team events are left out", () => {
    const team = event(1, "2026-04-01", [r("t1", 1, { memberIds: ["a", "b"] })], true);
    expect(orderOfMerit([team], { ...DEFAULT_MERIT_RULES, points: [10], attendancePoints: 0 }).map((x) => x.points)).toEqual([10, 10]);
    expect(orderOfMerit([team], { ...DEFAULT_MERIT_RULES, includeTeam: false })).toEqual([]);
  });

  it("knows its season", () => {
    expect(meritSeason(1, "2026-10-14")).toMatchObject({ season: 2026, from: "2026-01-01", label: "2026" });
    expect(meritSeason(4, "2027-02-01")).toMatchObject({ season: 2026, from: "2026-04-01", to: "2027-04-01", label: "2026–27" });
  });
});
