import { describe, expect, it } from "vitest";
import {
  ageBlockFor,
  ageFromIso,
  bandFromFacts,
  checkDateOfBirth,
  checkParentEmail,
  dateFromParts,
  maskEmail,
  parseAgeAccess,
  signupAgeOutcome,
} from "./junior";

const now = new Date("2026-10-16T12:00:00Z");

describe("checkDateOfBirth", () => {
  it("accepts a real past date", () => {
    expect(checkDateOfBirth("2011-04-07", now)).toEqual({ ok: true, date: "2011-04-07" });
    expect(checkDateOfBirth("2026-10-16", now).ok).toBe(true); // today
  });

  it("refuses impossible, future, pre-1900 and malformed dates", () => {
    expect(checkDateOfBirth("2011-02-31", now).ok).toBe(false);
    expect(checkDateOfBirth("2011-13-01", now).ok).toBe(false);
    expect(checkDateOfBirth("2026-10-17", now).ok).toBe(false);
    expect(checkDateOfBirth("1899-12-31", now).ok).toBe(false);
    expect(checkDateOfBirth("7/4/2011", now).ok).toBe(false);
    expect(checkDateOfBirth("", now).ok).toBe(false);
    expect(checkDateOfBirth(undefined, now).ok).toBe(false);
  });

  it("allows 29 February only in a leap year", () => {
    expect(checkDateOfBirth("2012-02-29", now).ok).toBe(true);
    expect(checkDateOfBirth("2013-02-29", now).ok).toBe(false);
  });
});

describe("dateFromParts", () => {
  it("joins three selects into YYYY-MM-DD", () => {
    expect(dateFromParts("7", "4", "2011")).toBe("2011-04-07");
  });
  it("is empty while any part is missing", () => {
    expect(dateFromParts("", "4", "2011")).toBe("");
    expect(dateFromParts("7", null, "2011")).toBe("");
  });
});

describe("ageFromIso and the sign-up bands", () => {
  it("ticks over on the birthday itself", () => {
    expect(ageFromIso("2013-10-16", now)).toBe(13);
    expect(ageFromIso("2013-10-17", now)).toBe(12);
    expect(ageFromIso("2010-10-16", now)).toBe(16);
    expect(ageFromIso("2010-10-17", now)).toBe(15);
  });

  it("turns away under 13, asks 13–15 for a parent, lets 16+ through", () => {
    expect(signupAgeOutcome(12)).toBe("under_13");
    expect(signupAgeOutcome(13)).toBe("needs_parent");
    expect(signupAgeOutcome(15)).toBe("needs_parent");
    expect(signupAgeOutcome(16)).toBe("ok");
    expect(signupAgeOutcome(40)).toBe("ok");
  });
});

describe("checkParentEmail", () => {
  it("needs a plausible email different from the member's own", () => {
    expect(checkParentEmail("Mum@Example.ie", "kid@example.ie")).toEqual({ ok: true, email: "mum@example.ie" });
    expect(checkParentEmail("", "kid@example.ie").ok).toBe(false);
    expect(checkParentEmail("not an email", "kid@example.ie").ok).toBe(false);
    expect(checkParentEmail("KID@example.ie ", "kid@example.ie").ok).toBe(false);
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("jane.doe@gmail.com")).toBe("j***@gmail.com");
    expect(maskEmail("a@b.ie")).toBe("a***@b.ie");
  });
  it("hides anything that isn't an email", () => {
    expect(maskEmail("nonsense")).toBe("***");
  });
});

describe("parseAgeAccess / ageBlockFor", () => {
  const junior = parseAgeAccess({
    band: "junior",
    age: 14,
    needsDateOfBirth: false,
    underReview: false,
    parent: { status: "approved", email: "mum@example.ie" },
    can: { teeTimes: false, social: false, chat: false, marketplace: "browse", createGroups: false, connections: false, liveScoring: true },
  });

  it("reads a junior's limits", () => {
    expect(junior?.band).toBe("junior");
    expect(ageBlockFor(junior, "teeTimes")).toBe("under_18");
    expect(ageBlockFor(junior, "marketplaceSell")).toBe("under_18");
    expect(ageBlockFor(junior, "directory")).toBe("under_16");
  });

  it("puts a junior waiting for a parent on the waiting panel for everything", () => {
    const pending = parseAgeAccess({ band: "junior_pending", can: { teeTimes: false } });
    expect(ageBlockFor(pending, "teeTimes")).toBe("waiting_for_parent");
    expect(ageBlockFor(pending, "connections")).toBe("waiting_for_parent");
  });

  it("treats missing keys as an adult's, and no access as no block", () => {
    const sparse = parseAgeAccess({ band: "adult" });
    expect(sparse?.can.marketplace).toBe("full");
    expect(ageBlockFor(sparse, "social")).toBeNull();
    expect(ageBlockFor(null, "social")).toBeNull();
    expect(parseAgeAccess(null)).toBeNull();
    expect(parseAgeAccess({ band: "martian" })?.band).toBe("unknown");
  });
});

describe("bandFromFacts (mirrors age_band_of)", () => {
  it("matches the database's bands", () => {
    expect(bandFromFacts({ dateOfBirth: null, parentApproved: false, openFlag: false }, now)).toBe("unknown");
    expect(bandFromFacts({ dateOfBirth: null, parentApproved: false, openFlag: true }, now)).toBe("youth");
    expect(bandFromFacts({ dateOfBirth: "2012-01-01", parentApproved: false, openFlag: false }, now)).toBe("junior_pending");
    expect(bandFromFacts({ dateOfBirth: "2012-01-01", parentApproved: true, openFlag: false }, now)).toBe("junior");
    expect(bandFromFacts({ dateOfBirth: "2009-01-01", parentApproved: false, openFlag: false }, now)).toBe("youth");
    expect(bandFromFacts({ dateOfBirth: "1980-01-01", parentApproved: false, openFlag: false }, now)).toBe("adult");
    expect(bandFromFacts({ dateOfBirth: "1980-01-01", parentApproved: false, openFlag: true }, now)).toBe("youth");
  });
});
