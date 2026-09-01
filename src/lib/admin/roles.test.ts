import { describe, expect, it } from "vitest";
import { canAccess, STAFF_ROLES, type StaffRecord } from "./roles";

function staff(overrides: Partial<StaffRecord> = {}): StaffRecord {
  return { user_id: "user-1", role: "support", status: "active", ...overrides };
}

describe("canAccess", () => {
  it("denies a non-staff user (no staff_roles row)", () => {
    expect(canAccess(null)).toBe(false);
    expect(canAccess(null, ["support"])).toBe(false);
  });

  it("denies a disabled staff member regardless of role", () => {
    for (const role of STAFF_ROLES) {
      expect(canAccess(staff({ role, status: "disabled" }))).toBe(false);
      expect(canAccess(staff({ role, status: "disabled" }), [role])).toBe(false);
    }
  });

  it("allows any active staff role when no roles are specified", () => {
    for (const role of STAFF_ROLES) {
      expect(canAccess(staff({ role, status: "active" }))).toBe(true);
    }
  });

  it("treats an empty allowed-roles array the same as 'unspecified'", () => {
    expect(canAccess(staff({ role: "support" }), [])).toBe(true);
  });

  it("allows an active staff member whose role is in the allowed list", () => {
    expect(canAccess(staff({ role: "finance", status: "active" }), ["finance", "admin"])).toBe(true);
  });

  it("denies an active staff member whose role is not in the allowed list", () => {
    expect(canAccess(staff({ role: "support", status: "active" }), ["finance", "admin"])).toBe(false);
  });
});
