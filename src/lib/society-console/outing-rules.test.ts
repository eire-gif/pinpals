import { describe, expect, it } from "vitest";

import { closesLabel, entriesCloseAt, entriesOpen, feeLabel, irishToday, isOutingDay, outingDateLabel, outingPast, parseFee } from "./outing-rules";

describe("entries close at midnight at the start of the day, Irish time", () => {
  it("in summer (IST, UTC+1) and winter (GMT)", () => {
    expect(entriesCloseAt("2026-07-01").toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(entriesCloseAt("2026-12-01").toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("on the days the clocks change", () => {
    expect(entriesCloseAt("2026-03-29").toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(entriesCloseAt("2026-10-25").toISOString()).toBe("2026-10-24T23:00:00.000Z");
  });

  it("is open up to the last minute of the evening before", () => {
    expect(entriesOpen("2026-10-20", new Date("2026-10-19T22:59:00Z"))).toBe(true); // 23:59 Irish time
    expect(entriesOpen("2026-10-20", new Date("2026-10-19T23:00:00Z"))).toBe(false); // midnight
  });
});

describe("days", () => {
  it("knows today in Ireland, not in UTC", () => {
    expect(irishToday(new Date("2026-10-19T23:30:00Z"))).toBe("2026-10-20");
    expect(isOutingDay("2026-10-20", new Date("2026-10-19T23:30:00Z"))).toBe(true);
    expect(outingPast("2026-10-19", new Date("2026-10-19T23:30:00Z"))).toBe(true);
  });

  it("writes the date and the closing time for people", () => {
    expect(outingDateLabel("2026-10-20")).toBe("Tue 20 Oct");
    expect(closesLabel("2026-10-20", new Date("2026-10-12T10:00:00Z"))).toBe("Join or cancel until midnight on Mon 19 Oct");
    expect(closesLabel("2026-10-01", new Date("2026-10-12T10:00:00Z"))).toBe("Entries closed");
  });
});

describe("fees", () => {
  it("reads and writes euro amounts", () => {
    expect(parseFee("60")).toBe(6000);
    expect(parseFee("€60,50")).toBe(6050);
    expect(parseFee("")).toBeNull();
    expect(parseFee("abc")).toBeUndefined();
    expect(parseFee("2000")).toBeUndefined();
    expect(feeLabel(6000)).toBe("€60");
    expect(feeLabel(6050)).toBe("€60.50");
    expect(feeLabel(0)).toBe("Free");
    expect(feeLabel(null)).toBeNull();
  });
});
