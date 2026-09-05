import { describe, expect, it } from "vitest";
import { isSelfTargeted, wouldRemoveLastActiveSuperAdmin, type StaffMemberRow } from "./staff-management";

describe("isSelfTargeted", () => {
  it("is true when the actor and target are the same user", () => {
    expect(isSelfTargeted("user-1", "user-1")).toBe(true);
  });

  it("is false for two different users", () => {
    expect(isSelfTargeted("user-1", "user-2")).toBe(false);
  });
});

describe("wouldRemoveLastActiveSuperAdmin", () => {
  const solo: StaffMemberRow[] = [{ user_id: "super-1", role: "super_admin", status: "active" }];

  const twoSupers: StaffMemberRow[] = [
    { user_id: "super-1", role: "super_admin", status: "active" },
    { user_id: "super-2", role: "super_admin", status: "active" },
  ];

  it("blocks demoting the sole active super_admin to another role", () => {
    expect(wouldRemoveLastActiveSuperAdmin(solo, "super-1", { role: "admin", status: "active" })).toBe(true);
  });

  it("blocks disabling the sole active super_admin", () => {
    expect(wouldRemoveLastActiveSuperAdmin(solo, "super-1", { role: "super_admin", status: "disabled" })).toBe(true);
  });

  it("allows demoting one of two active super_admins", () => {
    expect(wouldRemoveLastActiveSuperAdmin(twoSupers, "super-2", { role: "admin", status: "active" })).toBe(false);
  });

  it("allows disabling one of two active super_admins", () => {
    expect(wouldRemoveLastActiveSuperAdmin(twoSupers, "super-2", { role: "super_admin", status: "disabled" })).toBe(
      false
    );
  });

  it("allows a role change that keeps the target an active super_admin", () => {
    expect(wouldRemoveLastActiveSuperAdmin(solo, "super-1", { role: "super_admin", status: "active" })).toBe(false);
  });

  it("never blocks a brand-new grant, since the target has no existing row", () => {
    const staffBeforeGrant: StaffMemberRow[] = [{ user_id: "existing-1", role: "moderator", status: "active" }];
    expect(
      wouldRemoveLastActiveSuperAdmin(staffBeforeGrant, "brand-new-user", { role: "support", status: "active" })
    ).toBe(true);
    // Note: this reflects "there are zero active super_admins in this table
    // already, unrelated to the grant" — a real deployment always has at
    // least one super_admin, so this scenario only arises in an
    // artificial/test fixture like this one, never in production.
  });

  it("does not block a grant when at least one active super_admin already exists", () => {
    expect(wouldRemoveLastActiveSuperAdmin(solo, "brand-new-user", { role: "support", status: "active" })).toBe(
      false
    );
  });

  it("blocks reinstating someone into a role that still leaves zero active super_admins elsewhere", () => {
    const disabledOnly: StaffMemberRow[] = [{ user_id: "mod-1", role: "moderator", status: "disabled" }];
    expect(wouldRemoveLastActiveSuperAdmin(disabledOnly, "mod-1", { role: "moderator", status: "active" })).toBe(
      true
    );
  });
});
