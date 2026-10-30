import { describe, expect, it } from "vitest";

import { dayLabel, mondayOf, myLine, netName, scoreFor, weekLabel, type BoardRow } from "./course-board-rules";

const row = (place: number, points: number, isMe = false): BoardRow => ({
  place,
  memberId: `m${place}-${points}`,
  name: "X",
  avatarUrl: null,
  avatarColor: null,
  handicap: null,
  playedOn: "2026-10-27",
  points,
  gross: 72 + (36 - points),
  netToPar: 36 - points,
  isMe,
});

describe("course board words", () => {
  it("weeks run Monday to Sunday", () => {
    expect(mondayOf(new Date(2026, 9, 30))).toBe("2026-10-26");
    expect(mondayOf(new Date(2026, 10, 1))).toBe("2026-10-26");
    expect(mondayOf(new Date(2026, 10, 2))).toBe("2026-11-02");
    expect(weekLabel("2026-10-26")).toBe("26 Oct – 1 Nov");
    expect(dayLabel("2026-10-27")).toBe("Tue");
  });

  it("the score shown for each board", () => {
    const r = row(1, 38);
    expect(scoreFor(r, "stableford")).toBe("38");
    expect(scoreFor(r, "net")).toBe("-2");
    expect(scoreFor({ ...r, netToPar: 0 }, "net")).toBe("E");
    expect(scoreFor({ ...r, netToPar: 3 }, "net")).toBe("+3");
    expect(scoreFor(r, "gross")).toBe("70");
    expect(netName(-1)).toBe("BIRDIE");
    expect(netName(-2)).toBe("EAGLE");
    expect(netName(0)).toBe("PAR");
  });

  it("how far off the top 5 the viewer is", () => {
    const rows = [row(1, 41), row(2, 39), row(3, 38), row(4, 37), row(5, 36), row(7, 34, true)];
    expect(myLine(rows, "stableford")).toBe("2 pts off the top 5");
    expect(myLine([row(1, 40, true), row(2, 38)], "stableford")).toBe("Leading this week");
    expect(myLine([row(1, 40), row(2, 38, true)], "stableford")).toBeNull();
    expect(myLine([row(1, 40)], "stableford")).toBeNull();
  });
});
