import { describe, expect, it } from "vitest";
import { canSeeFinanceMetrics, FINANCE_ROLES, UNAVAILABLE_METRICS } from "./overview";
import { STAFF_ROLES, type StaffRole } from "./roles";

describe("canSeeFinanceMetrics", () => {
  it("denies a non-staff user", () => {
    expect(canSeeFinanceMetrics(null)).toBe(false);
  });

  it("denies a disabled staff member regardless of role", () => {
    for (const role of FINANCE_ROLES) {
      expect(canSeeFinanceMetrics({ role, status: "disabled" })).toBe(false);
    }
  });

  it("allows finance, admin, and super_admin", () => {
    for (const role of FINANCE_ROLES) {
      expect(canSeeFinanceMetrics({ role, status: "active" })).toBe(true);
    }
  });

  it("denies support and moderator", () => {
    const nonFinanceRoles = STAFF_ROLES.filter(
      (role): role is StaffRole => !(FINANCE_ROLES as readonly string[]).includes(role)
    );
    expect(nonFinanceRoles).toEqual(["support", "moderator"]);
    for (const role of nonFinanceRoles) {
      expect(canSeeFinanceMetrics({ role, status: "active" })).toBe(false);
    }
  });
});

describe("UNAVAILABLE_METRICS", () => {
  it("has a unique key per entry", () => {
    const keys = UNAVAILABLE_METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never leaves label or reason blank", () => {
    for (const metric of UNAVAILABLE_METRICS) {
      expect(metric.label.trim().length).toBeGreaterThan(0);
      expect(metric.reason.trim().length).toBeGreaterThan(0);
    }
  });
});
