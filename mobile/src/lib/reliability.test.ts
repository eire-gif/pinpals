import { describe, it, expect } from "vitest";
import { byReliability, fromRow, reliabilityBadge, reliabilityDetail, verifiedLabel, type Reliability } from "./reliability";
import { cleanFlags, meetAtClubMessage, safetyWarning } from "./message-safety";

const r = (level: Reliability["level"], played: number, noShows = 0, lateCancels = 0): Reliability => ({
  memberId: level,
  played,
  noShows,
  lateCancels,
  level,
});

describe("reliabilityBadge", () => {
  it("says new for anyone without a record", () => {
    expect(reliabilityBadge(null)).toEqual({ label: "New to tee times", tone: "neutral" });
    expect(reliabilityBadge(r("new", 2))).toEqual({ label: "New to tee times", tone: "neutral" });
  });

  it("counts every round on record", () => {
    expect(reliabilityBadge(r("reliable", 18)).label).toBe("Reliable · 18 of 18 rounds");
    expect(reliabilityBadge(r("mostly", 15, 2, 1)).label).toBe("Usually turns up · 15 of 18 rounds");
    expect(reliabilityBadge(r("patchy", 6, 3, 1))).toEqual({ label: "Has missed rounds · 6 of 10 rounds", tone: "bad" });
  });
});

describe("fromRow", () => {
  it("reads the database row and falls back to new", () => {
    expect(fromRow({ member_id: "a", rounds_played: 4, no_shows: 0, late_cancels: 1, level: "mostly" })).toEqual({
      memberId: "a",
      played: 4,
      noShows: 0,
      lateCancels: 1,
      level: "mostly",
    });
    expect(fromRow({ member_id: "a", rounds_played: 0, no_shows: 0, late_cancels: 0, level: "odd" }).level).toBe("new");
  });
});

describe("reliabilityDetail", () => {
  it("spells out the record", () => {
    expect(reliabilityDetail(r("reliable", 12, 0, 1))).toBe("12 played · 0 no-shows · 1 late cancellation in the last 12 months.");
  });
});

describe("byReliability", () => {
  it("puts reliable golfers first and patchy last, otherwise keeping order", () => {
    const list = [r("patchy", 1), r("new", 0), r("reliable", 9), r("mostly", 5)];
    expect(byReliability(list, (x) => x).map((x) => x.level)).toEqual(["reliable", "mostly", "new", "patchy"]);
  });
});

describe("verifiedLabel", () => {
  it("adds the club when there is one", () => {
    expect(verifiedLabel("Portmarnock")).toBe("Verified golfer · Portmarnock");
    expect(verifiedLabel(null)).toBe("Verified golfer");
  });
});

describe("message safety", () => {
  it("shows the most serious warning and ignores unknown flags", () => {
    expect(cleanFlags(["link", "pay_first", "nonsense"])).toEqual(["pay_first", "link"]);
    expect(safetyWarning(["link", "pay_first"])).toMatch(/deposit/);
    expect(safetyWarning(null)).toBeNull();
  });

  it("suggests the club, or a club near you", () => {
    expect(meetAtClubMessage("The Island")).toMatch(/^Could we meet at The Island\?/);
    expect(meetAtClubMessage("")).toMatch(/a golf club near us/);
  });
});

describe("attendance marks", () => {
  it("reads a row and words it for the golfer", async () => {
    const { toMark, noShowLine, canStillMark } = await import("./reliability");
    const mark = toMark({ invite_id: 4, member_id: "m", outcome: "no_show", disputed_at: null, resolution: null });
    expect(mark).toEqual({ inviteId: 4, memberId: "m", outcome: "no_show", disputed: false, resolution: null });
    expect(noShowLine(mark)).toMatch(/host marked you/);
    expect(noShowLine({ ...mark, disputed: true })).toMatch(/doesn't count/);
    expect(canStillMark("2026-10-20", "2026-10-24")).toBe(true);
    expect(canStillMark("2026-10-10", "2026-10-24")).toBe(false);
    expect(canStillMark("2026-10-25", "2026-10-24")).toBe(false);
  });
});

describe("isLateNotice", () => {
  it("is late inside 24 hours of the tee time", async () => {
    const { isLateNotice } = await import("./reliability");
    const now = new Date("2026-11-10T09:00:00");
    expect(isLateNotice("2026-11-11", "08:30:00", now)).toBe(true);
    expect(isLateNotice("2026-11-11", "10:00:00", now)).toBe(false);
    expect(isLateNotice("2026-11-10", null, now)).toBe(true);
    expect(isLateNotice("2026-11-15", "10:00", now)).toBe(false);
  });
});
