import { describe, expect, it } from "vitest";

import { parseMeritDraft, toMeritDraft } from "./merit-form";
import { DEFAULT_MERIT_RULES } from "./order-of-merit";

describe("merit rules form", () => {
  it("round-trips the defaults", () => {
    expect(parseMeritDraft(toMeritDraft(DEFAULT_MERIT_RULES))).toEqual(DEFAULT_MERIT_RULES);
  });
  it("reads spaces or commas, blank attendance and best of", () => {
    expect(parseMeritDraft({ points: "10 5,3", attendance: "", bestOf: "", includeTeam: false, startMonth: "4" })).toEqual({
      points: [10, 5, 3],
      attendancePoints: 0,
      bestOf: null,
      includeTeam: false,
      seasonStartMonth: 4,
    });
  });
  it("says what's wrong", () => {
    expect(parseMeritDraft({ points: "", attendance: "2", bestOf: "", includeTeam: true, startMonth: "1" })).toBe("Give points for at least 1st place.");
    expect(parseMeritDraft({ points: "25, 2.5", attendance: "2", bestOf: "", includeTeam: true, startMonth: "1" })).toBe("Points must be whole numbers, like 25, 20, 16.");
    expect(parseMeritDraft({ points: "25", attendance: "-1", bestOf: "", includeTeam: true, startMonth: "1" })).toBe("Attendance points must be a whole number.");
    expect(parseMeritDraft({ points: "25", attendance: "2", bestOf: "0", includeTeam: true, startMonth: "1" })).toBe("Best of must be a whole number, or blank for every event.");
    expect(typeof parseMeritDraft({ points: "25", attendance: "2", bestOf: "", includeTeam: true, startMonth: "0" })).toBe("string");
  });
});
