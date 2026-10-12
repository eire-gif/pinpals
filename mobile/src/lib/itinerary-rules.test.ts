import { describe, expect, it } from "vitest";

import {
  addDays,
  addMinutes,
  bySlot,
  checkOutDate,
  countdownLabel,
  dayHeading,
  dayTab,
  dealIntoSlots,
  itemKindsFor,
  myLineFor,
  sortItems,
  teeTimeFor,
  tripBadge,
  tripDays,
  tripLengthLabel,
  tripRangeLabel,
} from "./itinerary-rules";

describe("trip dates", () => {
  it("lists every day, across a month end", () => {
    expect(tripDays("2027-05-13", "2027-05-16")).toEqual(["2027-05-13", "2027-05-14", "2027-05-15", "2027-05-16"]);
    expect(tripDays("2027-04-30", "2027-05-02")).toEqual(["2027-04-30", "2027-05-01", "2027-05-02"]);
    // Clocks going forward (28 Mar 2027) don't drop or double a day.
    expect(tripDays("2027-03-27", "2027-03-29")).toHaveLength(3);
  });

  it("labels the range, length and each day", () => {
    expect(tripRangeLabel("2027-05-13", "2027-05-16")).toBe("Thu 13 – Sun 16 May");
    expect(tripRangeLabel("2027-04-30", "2027-05-03")).toBe("Fri 30 Apr – Mon 3 May");
    expect(tripLengthLabel("2027-05-13", "2027-05-16")).toBe("4 days · 3 nights");
    expect(tripLengthLabel("2027-03-06", "2027-03-07")).toBe("2 days · 1 night");
    expect(dayTab("2027-05-14")).toEqual({ week: "FRI", day: "14" });
    expect(dayHeading("2027-05-13", "2027-05-13")).toBe("Day 1 · Thursday 13 May");
    expect(dayHeading("2027-05-13", "2027-05-16")).toBe("Day 4 · Sunday 16 May");
    expect(tripBadge("abroad", "2027-05-13", "2027-05-16")).toBe("ABROAD · 4 DAYS");
    expect(tripBadge("day", "2027-05-13", null)).toBe("DAY OUT");
  });

  it("counts down", () => {
    expect(countdownLabel("2027-05-13", "2027-05-16", "2026-10-12")).toBe("213 days to go");
    expect(countdownLabel("2027-05-13", "2027-05-16", "2027-05-12")).toBe("Tomorrow");
    expect(countdownLabel("2027-05-13", "2027-05-16", "2027-05-13")).toBe("Today");
    expect(countdownLabel("2027-05-13", "2027-05-16", "2027-05-15")).toBe("Under way");
    expect(countdownLabel("2027-05-13", "2027-05-16", "2027-05-17")).toBe("Done");
  });

  it("works out check-out", () => {
    expect(checkOutDate("2027-05-13", 3)).toBe("2027-05-16");
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
  });
});

describe("rounds", () => {
  it("spaces the groups from the first tee", () => {
    expect(teeTimeFor("14:10:00", 10, 1)).toBe("14:10");
    expect(teeTimeFor("14:10", 10, 3)).toBe("14:30");
    expect(teeTimeFor("23:55", 10, 2)).toBe("00:05");
    expect(teeTimeFor(null, 10, 2)).toBeNull();
    expect(addMinutes("bad", 5)).toBeNull();
  });

  it("deals people into even groups, bigger first", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
    const slots = dealIntoSlots(ids, 4);
    const sizes = [1, 2, 3].map((g) => [...slots.values()].filter((s) => s === g).length);
    expect(sizes).toEqual([4, 3, 3]);
    expect(dealIntoSlots([], 4).size).toBe(0);
  });

  it("groups people by slot in order", () => {
    const out = bySlot([
      { memberId: "b", slot: 2, position: 1 },
      { memberId: "c", slot: 1, position: 2 },
      { memberId: "a", slot: 1, position: 1 },
      { memberId: "x", slot: null, position: null },
    ]);
    expect(out.map(([s, list]) => [s, list.map((p) => p.memberId)])).toEqual([
      [1, ["a", "c"]],
      [2, ["b"]],
    ]);
  });
});

describe("the day", () => {
  it("sorts by date, then time, untimed last", () => {
    const items = [
      { id: 3, onDate: "2027-05-13", startsAt: null },
      { id: 2, onDate: "2027-05-13", startsAt: "14:10:00" },
      { id: 1, onDate: "2027-05-13", startsAt: "06:40:00" },
      { id: 4, onDate: "2027-05-12", startsAt: "20:00:00" },
    ];
    expect(sortItems(items).map((i) => i.id)).toEqual([4, 1, 2, 3]);
  });

  it("offers flights only abroad", () => {
    expect(itemKindsFor("abroad")).toContain("flight");
    expect(itemKindsFor("overnight")).not.toContain("flight");
  });

  it("says where you are", () => {
    expect(myLineFor({ kind: "round", startsAt: "14:10", teeInterval: 10 }, { slot: 2 }, ["Niamh", "Geoff"])).toBe("You: 14:20 · group 2 with Niamh, Geoff");
    expect(myLineFor({ kind: "stay", startsAt: null, teeInterval: null }, { slot: 1 }, ["Tom"])).toBe("You: room 1, sharing with Tom");
    expect(myLineFor({ kind: "flight", startsAt: "06:40", teeInterval: null }, { slot: null }, [])).toBe("You're on this");
    expect(myLineFor({ kind: "flight", startsAt: "06:40", teeInterval: null }, null, [])).toBeNull();
  });
});
