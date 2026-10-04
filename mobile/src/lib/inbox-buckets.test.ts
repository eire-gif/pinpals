import { describe, expect, it } from "vitest";

import { alertLook, dayBucket } from "./inbox-look";

describe("dayBucket", () => {
  const now = new Date(2026, 9, 4, 12, 0); // Sun 4 Oct 2026, noon local

  it("groups by calendar day in local time", () => {
    expect(dayBucket(new Date(2026, 9, 4, 0, 5).toISOString(), now)).toBe("today");
    expect(dayBucket(new Date(2026, 9, 3, 23, 59).toISOString(), now)).toBe("yesterday");
    expect(dayBucket(new Date(2026, 9, 1, 9, 0).toISOString(), now)).toBe("week");
    expect(dayBucket(new Date(2026, 8, 20, 9, 0).toISOString(), now)).toBe("earlier");
  });

  it("treats a bad timestamp as earlier rather than throwing", () => {
    expect(dayBucket("not a date", now)).toBe("earlier");
  });
});

describe("alertLook", () => {
  it("gives requests, likes, comments and offers their own colours", () => {
    const looks = ["tee_time_interest_received", "post_liked", "post_commented", "offer_received"].map(
      (t) => alertLook(t).fg
    );
    expect(new Set(looks).size).toBe(4);
  });

  it("falls back for an unknown type", () => {
    expect(alertLook("something_new").icon).toBe("notifications");
  });
});
