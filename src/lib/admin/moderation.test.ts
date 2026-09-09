import { describe, expect, it } from "vitest";
import {
  LISTING_REMOVAL_ROLES,
  MODERATION_ROLES,
  checkListingForceRemoval,
  resolveRestoreStatus,
} from "./moderation";

describe("LISTING_REMOVAL_ROLES", () => {
  it("is super_admin alone", () => {
    expect(LISTING_REMOVAL_ROLES).toEqual(["super_admin"]);
  });

  it("is stricter than the everyday moderation roles", () => {
    for (const role of LISTING_REMOVAL_ROLES) {
      expect(MODERATION_ROLES).toContain(role);
    }
    expect(LISTING_REMOVAL_ROLES.length).toBeLessThan(MODERATION_ROLES.length);
  });
});

describe("checkListingForceRemoval", () => {
  it("refuses a listing that is already removed", () => {
    expect(checkListingForceRemoval("removed")).toEqual({
      allowed: false,
      reason: "This listing is already removed.",
    });
  });

  it("allows the statuses hideListing() cannot reach, without a warning", () => {
    for (const status of ["draft", "pending_review", "expired"]) {
      expect(checkListingForceRemoval(status)).toEqual({ allowed: true, warning: null });
    }
  });

  it("allows an active listing without a warning", () => {
    expect(checkListingForceRemoval("active")).toEqual({ allowed: true, warning: null });
  });

  it("warns, but still allows, when a transaction is attached", () => {
    const reserved = checkListingForceRemoval("reserved");
    expect(reserved.allowed).toBe(true);
    expect(reserved.allowed && reserved.warning).toMatch(/sale is in progress/i);

    const sold = checkListingForceRemoval("sold");
    expect(sold.allowed).toBe(true);
    expect(sold.allowed && sold.warning).toMatch(/has sold/i);
  });

  it("allows an unrecognised status rather than blocking on it", () => {
    // A status this build doesn't know about should not lock a super-admin
    // out of taking the listing down — the whole point of the action.
    expect(checkListingForceRemoval("something_new")).toEqual({ allowed: true, warning: null });
  });
});

describe("resolveRestoreStatus", () => {
  it("returns the status the listing was removed from", () => {
    expect(resolveRestoreStatus({ previousStatus: "draft", newStatus: "removed" })).toBe("draft");
    expect(resolveRestoreStatus({ previousStatus: "sold" })).toBe("sold");
    expect(resolveRestoreStatus({ previousStatus: "pending_review" })).toBe("pending_review");
  });

  it("falls back to active when there is nothing usable to read", () => {
    expect(resolveRestoreStatus(null)).toBe("active");
    expect(resolveRestoreStatus(undefined)).toBe("active");
    expect(resolveRestoreStatus({})).toBe("active");
    expect(resolveRestoreStatus("draft")).toBe("active");
    expect(resolveRestoreStatus({ previousStatus: 42 })).toBe("active");
  });

  it("never restores a listing back to removed", () => {
    expect(resolveRestoreStatus({ previousStatus: "removed" })).toBe("active");
  });

  it("ignores a status that isn't in the database's check constraint", () => {
    expect(resolveRestoreStatus({ previousStatus: "archived" })).toBe("active");
  });
});
