import { describe, expect, it } from "vitest";

import { appointConfirm, canRemove, committeeByOffice, isMembershipFilter, matchesSearch, parseCourseNumber } from "./people-rules";
import { GROUP_OFFICES } from "./rules";

describe("canRemove (remove_group_member's rule)", () => {
  const owner = { id: "o", role: "owner" as const };
  const admin = { id: "a", role: "admin" as const };
  const member = { id: "m", role: "member" as const };
  it("never offers the owner or yourself", () => {
    expect(canRemove(owner, owner)).toBe(false);
    expect(canRemove(admin, owner)).toBe(false);
    expect(canRemove(admin, admin)).toBe(false);
  });
  it("lets the owner remove anyone else, and admins only ordinary members", () => {
    expect(canRemove(owner, admin)).toBe(true);
    expect(canRemove(owner, member)).toBe(true);
    expect(canRemove(admin, member)).toBe(true);
    expect(canRemove(admin, { id: "a2", role: "admin" })).toBe(false);
    expect(canRemove(member, { id: "m2", role: "member" })).toBe(false);
  });
});

describe("matchesSearch", () => {
  it("needs every word, in any field", () => {
    expect(matchesSearch("", "Anne Byrne")).toBe(true);
    expect(matchesSearch("anne portmarnock", "Anne Byrne", "Portmarnock GC")).toBe(true);
    expect(matchesSearch("anne howth", "Anne Byrne", "Portmarnock GC")).toBe(false);
    expect(matchesSearch("  ", null)).toBe(true);
  });
});

describe("committeeByOffice", () => {
  it("lists every office in order with its holders", () => {
    const rows = committeeByOffice([
      { id: "1", name: "Zoe", office: "event_organiser" as const },
      { id: "2", name: "Al", office: "event_organiser" as const },
      { id: "3", name: "Cat", office: "captain" as const },
      { id: "4", name: "Ed", office: null },
    ]);
    expect(rows.map((r) => r.office)).toEqual([...GROUP_OFFICES]);
    expect(rows[0].holders.map((h) => h.name)).toEqual(["Cat"]);
    expect(rows.find((r) => r.office === "event_organiser")?.holders.map((h) => h.name)).toEqual(["Al", "Zoe"]);
    expect(rows.find((r) => r.office === "event_organiser")?.single).toBe(false);
    expect(rows[0].single).toBe(true);
  });
});

describe("appointConfirm", () => {
  it("warns when a single office changes hands", () => {
    expect(appointConfirm("captain", { id: "x", name: "Mary" }, "me")).toBe("Mary stands down as captain. Appoint the new captain?");
    expect(appointConfirm("secretary", { id: "me", name: "Me" }, "me")).toBe("You stand down as secretary. Appoint the new secretary?");
    expect(appointConfirm("captain", null, "me")).toBeUndefined();
    expect(appointConfirm("event_organiser", { id: "x", name: "Mary" }, "me")).toBeUndefined();
  });
});

describe("parseCourseNumber / isMembershipFilter", () => {
  it("reads numbers in range", () => {
    expect(parseCourseNumber("71,2", 25, 85)).toBe(71.2);
    expect(parseCourseNumber("200", 55, 155)).toBeNull();
    expect(parseCourseNumber("", 55, 155)).toBeNull();
    expect(parseCourseNumber("abc", 55, 155)).toBeNull();
  });
  it("knows the filters", () => {
    expect(isMembershipFilter("paid")).toBe(true);
    expect(isMembershipFilter("nope")).toBe(false);
  });
});
