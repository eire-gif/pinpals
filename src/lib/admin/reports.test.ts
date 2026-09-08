import { describe, expect, it } from "vitest";
import {
  ESCALATION_ROLES,
  LISTING_REPORT_CATEGORIES,
  ORDER_REPORT_CATEGORIES,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABELS,
  REPORT_PRIORITIES,
  REPORT_PRIORITY_LABELS,
  REPORT_PRIORITY_STYLES,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  REPORT_STATUS_STYLES,
  REPORT_TARGET_TYPES,
  REPORT_TARGET_TYPE_LABELS,
  USER_REPORT_CATEGORIES,
  parseEvidenceRefs,
} from "./reports";

// These are the vocab lists the reports table's own check constraints (see
// supabase/migrations/0016_admin_reports.sql) and every UI dropdown that
// filters/sets a report's status/priority/category/target type are built
// from. The real risk with this kind of file is a label map silently
// falling out of sync with its own vocab array (e.g. a new status added to
// REPORT_STATUSES without a matching REPORT_STATUS_LABELS entry) — these
// tests exist to catch exactly that, not to pin the vocab's exact values.

describe("report status vocab", () => {
  it("has a label and a style for every status", () => {
    for (const status of REPORT_STATUSES) {
      expect(REPORT_STATUS_LABELS[status]).toBeTruthy();
      expect(REPORT_STATUS_STYLES[status]).toBeTruthy();
    }
  });
});

describe("report priority vocab", () => {
  it("has a label and a style for every priority", () => {
    for (const priority of REPORT_PRIORITIES) {
      expect(REPORT_PRIORITY_LABELS[priority]).toBeTruthy();
      expect(REPORT_PRIORITY_STYLES[priority]).toBeTruthy();
    }
  });
});

describe("report category vocab", () => {
  it("has a label for every category", () => {
    for (const category of REPORT_CATEGORIES) {
      expect(REPORT_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });
});

describe("report target type vocab", () => {
  it("has a label for every target type, including the forward-declared message/conversation ones", () => {
    for (const type of REPORT_TARGET_TYPES) {
      expect(REPORT_TARGET_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("includes message and conversation even though no messaging system exists yet", () => {
    expect(REPORT_TARGET_TYPES).toContain("message");
    expect(REPORT_TARGET_TYPES).toContain("conversation");
  });

  it("includes order (marketplace-trust-safety)", () => {
    expect(REPORT_TARGET_TYPES).toContain("order");
  });
});

describe("per-form category subsets", () => {
  it("every subset only contains real categories", () => {
    for (const subset of [LISTING_REPORT_CATEGORIES, USER_REPORT_CATEGORIES, ORDER_REPORT_CATEGORIES]) {
      for (const category of subset) {
        expect(REPORT_CATEGORIES).toContain(category);
      }
    }
  });

  it("the order report form offers the order-shaped categories", () => {
    expect(ORDER_REPORT_CATEGORIES).toEqual(
      expect.arrayContaining(["item_not_as_described", "item_not_received", "payment_issue"])
    );
  });
});

describe("ESCALATION_ROLES", () => {
  it("excludes support (escalating to the entry tier isn't a real escalation)", () => {
    expect(ESCALATION_ROLES).not.toContain("support");
  });

  it("includes every role above support", () => {
    expect(ESCALATION_ROLES).toEqual(["moderator", "finance", "admin", "super_admin"]);
  });
});

describe("parseEvidenceRefs", () => {
  it("splits one reference per line, trimming whitespace", () => {
    expect(parseEvidenceRefs("  first ref  \nsecond ref\n")).toEqual(["first ref", "second ref"]);
  });

  it("drops blank lines", () => {
    expect(parseEvidenceRefs("a\n\n\nb\n   \nc")).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseEvidenceRefs("")).toEqual([]);
    expect(parseEvidenceRefs("   \n  \n")).toEqual([]);
  });

  it("caps the number of references at 10", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `ref ${i}`);
    expect(parseEvidenceRefs(lines.join("\n"))).toHaveLength(10);
  });

  it("truncates an over-long single reference rather than dropping it", () => {
    const long = "x".repeat(500);
    const [result] = parseEvidenceRefs(long);
    expect(result).toHaveLength(300);
  });
});
