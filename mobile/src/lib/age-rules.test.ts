import { describe, expect, it } from "vitest";

import {
  FALLBACK_ACCESS,
  ageOn,
  askParentByAlert,
  askParentOutcome,
  canForBand,
  canUse,
  gateFor,
  isMinor,
  isUnder16,
  maskEmail,
  openWhileWaiting,
  parentStatusLine,
  parseAgeAccess,
  parseStoreMemo,
  parseStoreSignal,
  signupAge,
  signupLockedUntil,
  storeSignalDue,
  wantsStoreSignal,
  SIGNUP_LOCK_MS,
  type AgeAccess,
} from "./age-rules";

/** The shape my_age_access() returns for a 14 year old waiting for a parent. */
const PENDING = {
  band: "junior_pending",
  age: 14,
  dateOfBirth: "2012-03-02",
  needsDateOfBirth: false,
  underReview: false,
  parent: { status: "pending", email: "mary.byrne@gmail.com", invitedAt: "2026-10-16T10:00:00Z", approvedAt: null, consentedAt: null },
  can: {
    liveScoring: false,
    shareLive: false,
    teeTimes: false,
    social: false,
    chat: false,
    marketplace: "browse",
    createGroups: false,
    groupOfficer: false,
    joinGroups: "none",
    connections: false,
    playWith: "none",
    personalisedAds: false,
  },
};

const access = (band: AgeAccess["band"], extra: Partial<AgeAccess> = {}): AgeAccess => ({
  ...FALLBACK_ACCESS,
  band,
  can: canForBand(band),
  ...extra,
});

describe("reading my_age_access()", () => {
  it("parses the full answer", () => {
    const a = parseAgeAccess(PENDING)!;
    expect(a.band).toBe("junior_pending");
    expect(a.age).toBe(14);
    expect(a.dateOfBirth).toBe("2012-03-02");
    expect(a.parent).toEqual({ status: "pending", email: "mary.byrne@gmail.com", invitedAt: "2026-10-16T10:00:00Z", approvedAt: null });
    expect(a.can.marketplace).toBe("browse");
    expect(a.can.playWith).toBe("none");
  });

  it("refuses anything that isn't an answer", () => {
    expect(parseAgeAccess(null)).toBeNull();
    expect(parseAgeAccess("adult")).toBeNull();
    expect(parseAgeAccess({ band: "toddler" })).toBeNull();
    expect(parseAgeAccess([])).toBeNull();
  });

  it("fills missing permissions from the band, never as allowed for a minor", () => {
    const a = parseAgeAccess({ band: "youth" })!;
    expect(a.can.teeTimes).toBe(false);
    expect(a.can.connections).toBe(true);
    expect(a.can.marketplace).toBe("browse");
    const j = parseAgeAccess({ band: "junior", can: { chat: "yes" } })!;
    expect(j.can.chat).toBe(false);
    expect(j.can.playWith).toBe("approved");
  });

  it("a member with no date of birth needs one", () => {
    expect(parseAgeAccess({ band: "unknown", dateOfBirth: null })!.needsDateOfBirth).toBe(true);
    expect(parseAgeAccess({ band: "unknown", needsDateOfBirth: true })!.needsDateOfBirth).toBe(true);
  });

  it("the band table matches the database's", () => {
    expect(canForBand("adult")).toMatchObject({ teeTimes: true, social: true, chat: true, marketplace: "full", connections: true, playWith: "all" });
    expect(canForBand("unknown")).toMatchObject({ teeTimes: true, marketplace: "full", joinGroups: "all" });
    expect(canForBand("youth")).toMatchObject({ teeTimes: false, social: false, chat: false, connections: true, joinGroups: "all", playWith: "all", liveScoring: true });
    expect(canForBand("junior")).toMatchObject({ connections: false, joinGroups: "parent", playWith: "approved", liveScoring: true });
    expect(canForBand("junior_pending")).toMatchObject({ liveScoring: false, shareLive: false, joinGroups: "none", playWith: "none" });
  });
});

describe("what a screen shows", () => {
  it("canUse follows the answer", () => {
    expect(canUse(access("adult"), "teeTimes")).toBe(true);
    expect(canUse(access("youth"), "teeTimes")).toBe(false);
    expect(canUse(access("youth"), "connections")).toBe(true);
    expect(canUse(access("junior"), "connections")).toBe(false);
    expect(canUse(access("youth"), "sell")).toBe(false);
    expect(canUse(access("youth"), "buy")).toBe(false);
    expect(canUse(access("adult"), "buy")).toBe(true);
  });

  it("the parent dashboard is for adults", () => {
    expect(canUse(access("adult"), "parentDashboard")).toBe(true);
    expect(canUse(access("unknown"), "parentDashboard")).toBe(true);
    expect(canUse(access("youth"), "parentDashboard")).toBe(false);
    expect(canUse(access("junior"), "parentDashboard")).toBe(false);
  });

  it("knows who is a minor", () => {
    expect(isMinor(access("youth"))).toBe(true);
    expect(isMinor(access("adult"))).toBe(false);
    expect(isMinor(FALLBACK_ACCESS)).toBe(false);
    expect(isUnder16(access("junior_pending"))).toBe(true);
    expect(isUnder16(access("youth"))).toBe(false);
  });

  it("holds members at the right screen", () => {
    expect(gateFor(access("unknown", { needsDateOfBirth: true }))).toBe("dateOfBirth");
    expect(gateFor(access("junior_pending"))).toBe("waiting");
    expect(gateFor(access("junior"))).toBeNull();
    expect(gateFor(FALLBACK_ACCESS)).toBeNull();
  });

  it("lets a waiting junior read the rules and the course directory", () => {
    expect(openWhileWaiting("rules")).toBe(true);
    expect(openWhileWaiting("courses")).toBe(true);
    expect(openWhileWaiting("course")).toBe(true);
    expect(openWhileWaiting("age")).toBe(true);
    expect(openWhileWaiting("(tabs)")).toBe(false);
    expect(openWhileWaiting(undefined)).toBe(false);
  });

  it("masks the parent's email", () => {
    expect(maskEmail("mary.byrne@gmail.com")).toBe("ma•••••@gmail.com");
    expect(maskEmail("jo@eir.ie")).toBe("j•••@eir.ie");
    expect(maskEmail("bad")).toBe("•••••");
  });

  it("describes the parent link", () => {
    expect(parentStatusLine(null)).toMatch(/No parent/);
    expect(parentStatusLine({ status: "pending", email: "a@b.ie", invitedAt: null, approvedAt: null })).toMatch(/Waiting/);
    expect(parentStatusLine({ status: "declined", email: "a@b.ie", invitedAt: null, approvedAt: null })).toMatch(/said no/);
  });
});

describe("sign-up", () => {
  const today = new Date(2026, 9, 16);

  it("works out an age, birthday or not", () => {
    expect(ageOn("2010-10-16", today)).toBe(16);
    expect(ageOn("2010-10-17", today)).toBe(15);
    expect(ageOn("2027-01-01", today)).toBeNull();
    expect(ageOn("2010-02-30", today)).toBeNull();
    expect(ageOn("16/10/2010", today)).toBeNull();
  });

  it("sorts a date into a sign-up path", () => {
    expect(signupAge("2014-01-01", today)).toBe("under13");
    expect(signupAge("2013-10-16", today)).toBe("under16");
    expect(signupAge("2010-10-16", today)).toBe("over16");
    expect(signupAge("1979-06-14", today)).toBe("over16");
    expect(signupAge("", today)).toBeNull();
  });

  it("keeps the form shut for a day, and no longer", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(signupLockedUntil(null, now)).toBeNull();
    expect(signupLockedUntil("nonsense", now)).toBeNull();
    expect(signupLockedUntil("2026-10-16T11:00:00Z", now)).toBeNull();
    expect(signupLockedUntil("2026-10-17T10:00:00Z", now)?.toISOString()).toBe("2026-10-17T10:00:00.000Z");
    expect(signupLockedUntil("2030-01-01T00:00:00Z", now)?.getTime()).toBe(now.getTime() + SIGNUP_LOCK_MS);
  });
});

describe("app store age signals", () => {
  it("reads the native answer", () => {
    expect(parseStoreSignal(null)).toBeNull();
    expect(parseStoreSignal({})).toBeNull();
    expect(parseStoreSignal({ lowerBound: 13, upperBound: 15, status: "sharing" })).toEqual({ lower: 13, upper: 15, status: "sharing" });
    expect(parseStoreSignal({ lowerBound: 18, upperBound: null, status: "sharing" })).toEqual({ lower: 18, upper: null, status: "sharing" });
    expect(parseStoreSignal({ status: "declined" })).toEqual({ lower: null, upper: null, status: "declined" });
    expect(parseStoreSignal({ lowerBound: -3, upperBound: 1.5 })).toBeNull();
  });

  it("asks once a day, once a month after a no", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(storeSignalDue(null, now)).toBe(true);
    expect(storeSignalDue({ at: "2026-10-16T08:00:00Z", declined: false }, now)).toBe(false);
    expect(storeSignalDue({ at: "2026-10-15T11:00:00Z", declined: false }, now)).toBe(true);
    expect(storeSignalDue({ at: "2026-10-01T12:00:00Z", declined: true }, now)).toBe(false);
    expect(storeSignalDue({ at: "2026-09-01T12:00:00Z", declined: true }, now)).toBe(true);
    expect(storeSignalDue({ at: "2027-01-01T00:00:00Z", declined: false }, now)).toBe(true);
  });

  it("remembers when it last asked", () => {
    expect(parseStoreMemo(null)).toBeNull();
    expect(parseStoreMemo("{")).toBeNull();
    expect(parseStoreMemo('{"at":"2026-10-16T08:00:00Z","declined":true}')).toEqual({ at: "2026-10-16T08:00:00Z", declined: true });
  });

  it("only checks accounts that say they're adults", () => {
    expect(wantsStoreSignal(access("adult"))).toBe(true);
    expect(wantsStoreSignal(access("unknown"))).toBe(true);
    expect(wantsStoreSignal(access("youth"))).toBe(false);
    expect(wantsStoreSignal(access("junior"))).toBe(false);
  });
});

describe("Ask a parent", () => {
  it("sends it to an under 16's parent, shares otherwise", () => {
    expect(askParentByAlert(access("junior"))).toBe(true);
    expect(askParentByAlert(access("youth"))).toBe(false);
    expect(askParentOutcome({ sent: true })).toBe("sent");
    expect(askParentOutcome({ sent: false })).toBe("share");
    expect(askParentOutcome(null)).toBe("share");
  });
});
