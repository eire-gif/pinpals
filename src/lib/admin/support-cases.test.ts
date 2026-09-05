import { describe, expect, it } from "vitest";
import {
  isSupportCaseOpen,
  OPEN_SUPPORT_CASE_STATUSES,
  SUPPORT_CASE_CATEGORIES,
  SUPPORT_CASE_CATEGORY_LABELS,
  SUPPORT_CASE_LINKED_TARGET_TYPES,
  SUPPORT_CASE_LINKED_TARGET_TYPE_LABELS,
  SUPPORT_CASE_PRIORITIES,
  SUPPORT_CASE_PRIORITY_LABELS,
  SUPPORT_CASE_PRIORITY_STYLES,
  SUPPORT_CASE_STATUSES,
  SUPPORT_CASE_STATUS_LABELS,
  SUPPORT_CASE_STATUS_STYLES,
} from "./support-cases";

// Same reasoning as reports.test.ts: the real risk with this kind of file is
// a label map silently falling out of sync with its own vocab array (e.g. a
// new status added to SUPPORT_CASE_STATUSES without a matching
// SUPPORT_CASE_STATUS_LABELS entry) — these tests exist to catch exactly
// that, not to pin the vocab's exact values.

describe("support case status vocab", () => {
  it("has a label and a style for every status", () => {
    for (const status of SUPPORT_CASE_STATUSES) {
      expect(SUPPORT_CASE_STATUS_LABELS[status]).toBeTruthy();
      expect(SUPPORT_CASE_STATUS_STYLES[status]).toBeTruthy();
    }
  });
});

describe("support case priority vocab", () => {
  it("has a label and a style for every priority", () => {
    for (const priority of SUPPORT_CASE_PRIORITIES) {
      expect(SUPPORT_CASE_PRIORITY_LABELS[priority]).toBeTruthy();
      expect(SUPPORT_CASE_PRIORITY_STYLES[priority]).toBeTruthy();
    }
  });
});

describe("support case category vocab", () => {
  it("has a label for every category", () => {
    for (const category of SUPPORT_CASE_CATEGORIES) {
      expect(SUPPORT_CASE_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });
});

describe("support case linked target type vocab", () => {
  it("has a label for every linked target type, including conversation", () => {
    for (const type of SUPPORT_CASE_LINKED_TARGET_TYPES) {
      expect(SUPPORT_CASE_LINKED_TARGET_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("includes conversation, deliberately never resolved into a link (see resolveLinkedTargetSummaries())", () => {
    expect(SUPPORT_CASE_LINKED_TARGET_TYPES).toContain("conversation");
  });
});

describe("isSupportCaseOpen", () => {
  it("agrees with OPEN_SUPPORT_CASE_STATUSES for every status in the vocab", () => {
    for (const status of SUPPORT_CASE_STATUSES) {
      expect(isSupportCaseOpen(status)).toBe((OPEN_SUPPORT_CASE_STATUSES as readonly string[]).includes(status));
    }
  });

  it("treats resolved and closed as not open", () => {
    expect(isSupportCaseOpen("resolved")).toBe(false);
    expect(isSupportCaseOpen("closed")).toBe(false);
  });

  it("treats open, claimed, and waiting_on_member as open", () => {
    expect(isSupportCaseOpen("open")).toBe(true);
    expect(isSupportCaseOpen("claimed")).toBe(true);
    expect(isSupportCaseOpen("waiting_on_member")).toBe(true);
  });
});
