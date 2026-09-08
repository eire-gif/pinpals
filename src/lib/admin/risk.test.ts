import { describe, expect, it } from "vitest";
import {
  FRAUD_FLAG_SEVERITIES,
  FRAUD_FLAG_SEVERITY_LABELS,
  FRAUD_FLAG_SEVERITY_STYLES,
  FRAUD_FLAG_STATUSES,
  FRAUD_FLAG_STATUS_LABELS,
  FRAUD_FLAG_STATUS_STYLES,
  FRAUD_FLAG_TARGET_TYPES,
  FRAUD_FLAG_TARGET_TYPE_LABELS,
  FRAUD_FLAG_TYPES,
  FRAUD_FLAG_TYPE_LABELS,
} from "./risk";

// Same "catch a label map falling out of sync with its own vocab array"
// purpose as reports.test.ts — not pinning exact values.

describe("fraud flag type vocab", () => {
  it("has a label for every flag type", () => {
    for (const type of FRAUD_FLAG_TYPES) {
      expect(FRAUD_FLAG_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});

describe("fraud flag severity vocab", () => {
  it("has a label and a style for every severity", () => {
    for (const severity of FRAUD_FLAG_SEVERITIES) {
      expect(FRAUD_FLAG_SEVERITY_LABELS[severity]).toBeTruthy();
      expect(FRAUD_FLAG_SEVERITY_STYLES[severity]).toBeTruthy();
    }
  });
});

describe("fraud flag status vocab", () => {
  it("has a label and a style for every status", () => {
    for (const status of FRAUD_FLAG_STATUSES) {
      expect(FRAUD_FLAG_STATUS_LABELS[status]).toBeTruthy();
      expect(FRAUD_FLAG_STATUS_STYLES[status]).toBeTruthy();
    }
  });
});

describe("fraud flag target type vocab", () => {
  it("has a label for every target type", () => {
    for (const type of FRAUD_FLAG_TARGET_TYPES) {
      expect(FRAUD_FLAG_TARGET_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("only covers user/listing/order — matching fraud_flags.target_type's own check constraint", () => {
    expect([...FRAUD_FLAG_TARGET_TYPES].sort()).toEqual(["listing", "order", "user"]);
  });
});
