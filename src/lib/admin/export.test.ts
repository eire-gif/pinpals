import { describe, expect, it } from "vitest";
import {
  EXPORT_MAX_ROWS,
  USER_EXPORT_ROLES,
  clipToExportLimit,
  csvFilename,
  csvList,
  exportTruncated,
} from "./export";
import { ADMIN_ACTIONS, AUDIT_TARGET_TYPES } from "./audit";
import { csvCell } from "./csv";

describe("csvFilename", () => {
  it("is dated, so several exports in a Downloads folder can be told apart", () => {
    expect(csvFilename("payout-ledger", new Date("2026-09-11T14:32:00Z"))).toBe(
      "pinpals-payout-ledger-2026-09-11.csv"
    );
  });

  it("never contains a space, which Content-Disposition would truncate at", () => {
    for (const dataset of ["listings", "seller-accounts", "payout-ledger", "tee-times", "reports"]) {
      expect(csvFilename(dataset, new Date("2026-09-11T00:00:00Z"))).not.toContain(" ");
    }
  });
});

describe("exportTruncated", () => {
  it("is false right up to the cap and true past it", () => {
    expect(exportTruncated(0)).toBe(false);
    expect(exportTruncated(EXPORT_MAX_ROWS)).toBe(false);
    expect(exportTruncated(EXPORT_MAX_ROWS + 1)).toBe(true);
  });
});

describe("csvList", () => {
  it("joins a Postgres text[] into one readable cell", () => {
    expect(csvList(["individual.verification.document", "company.tax_id"])).toBe(
      "individual.verification.document; company.tax_id"
    );
  });

  it("treats an empty array as an empty cell, not '[]'", () => {
    expect(csvList([])).toBeNull();
    expect(csvList(null)).toBeNull();
    expect(csvList(undefined)).toBeNull();
  });

  it("separates with semicolons so the cell never needs quoting", () => {
    const cell = csvList(["a", "b", "c"]);
    // The whole point of choosing ";" over "," — csvCell leaves it alone.
    expect(csvCell(cell)).toBe("a; b; c");
  });
});

describe("clipToExportLimit", () => {
  it("keeps everything when the list is under the cap", () => {
    const rows = [1, 2, 3];
    expect(clipToExportLimit(rows)).toEqual({ rows: [1, 2, 3], total: 3 });
  });

  it("clips to the cap but still reports the true total", () => {
    const rows = Array.from({ length: EXPORT_MAX_ROWS + 25 }, (_, i) => i);
    const result = clipToExportLimit(rows);
    expect(result.rows).toHaveLength(EXPORT_MAX_ROWS);
    // The total is what exportTruncated() then flags in the audit metadata —
    // a clipped file nobody noticed is the failure this guards against.
    expect(result.total).toBe(EXPORT_MAX_ROWS + 25);
    expect(exportTruncated(result.total)).toBe(true);
  });

  it("does not mutate the array it was given", () => {
    const rows = [1, 2, 3];
    clipToExportLimit(rows);
    expect(rows).toEqual([1, 2, 3]);
  });
});

describe("export audit vocabulary", () => {
  // Each export route passes one of these to recordAdminAction(); a typo in
  // either would only surface at runtime, as a thrown audit write on a route
  // that had already done its read.
  it("has an action string for every export route", () => {
    for (const action of [
      "export.listings",
      "export.orders",
      "export.users",
      "export.seller_accounts",
      "export.payouts",
      "export.reports",
      "export.reviews",
      "export.tee_times",
    ]) {
      expect(ADMIN_ACTIONS, action).toContain(action);
    }
  });

  it("has a target type for every export route", () => {
    for (const targetType of [
      "listing",
      "order",
      "user",
      "seller_account",
      "payout",
      "report",
      "review",
      "tee_time_invite",
    ]) {
      expect(AUDIT_TARGET_TYPES, targetType).toContain(targetType);
    }
  });
});

describe("USER_EXPORT_ROLES", () => {
  it("stays super_admin — it is the one export carrying every member's email", () => {
    expect(USER_EXPORT_ROLES).toEqual(["super_admin"]);
  });
});
