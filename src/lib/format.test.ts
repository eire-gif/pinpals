import { describe, expect, it } from "vitest";
import {
  formatPrice,
  formatJoinedDate,
  initials,
  SELLER_ACCOUNT_STATUS_STYLES,
  sellerAccountStatusLabel,
  SELLER_ONBOARDING_STATUS_LABELS,
  SELLER_ONBOARDING_STATUS_STYLES,
} from "./format";
import type { SellerOnboardingStatus } from "./stripe/connect";

describe("initials", () => {
  it("takes the first letter of each word, uppercased", () => {
    expect(initials("Grace Walsh")).toBe("GW");
  });

  it("caps at two characters for a longer name", () => {
    expect(initials("Mary Kate O'Brien")).toBe("MK");
  });

  it("handles a single word", () => {
    expect(initials("Cher")).toBe("C");
  });
});

describe("formatPrice", () => {
  it("formats a whole euro amount with no decimal places", () => {
    expect(formatPrice(50)).toBe("€50");
  });

  it("formats a fractional euro amount with two decimal places", () => {
    expect(formatPrice(49.99)).toBe("€49.99");
  });
});

describe("sellerAccountStatusLabel", () => {
  it("labels a null account (onboarding never started) as not started", () => {
    expect(sellerAccountStatusLabel(null)).toBe("Not started");
  });

  it("labels an account that hasn't submitted details yet as incomplete", () => {
    expect(
      sellerAccountStatusLabel({
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        requirements_currently_due: ["individual.verification.document"],
        requirements_past_due: [],
      })
    ).toBe("Onboarding incomplete");
  });

  it("labels a submitted account still missing requirements as under review", () => {
    expect(
      sellerAccountStatusLabel({
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: true,
        requirements_currently_due: [],
        requirements_past_due: [],
      })
    ).toBe("Under review");
  });

  it("distinguishes a submitted account with requirements still due", () => {
    expect(
      sellerAccountStatusLabel({
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: true,
        requirements_currently_due: ["external_account"],
        requirements_past_due: [],
      })
    ).toBe("Under review — requirements due");
  });

  it("prioritises past-due requirements over everything else, even if payouts are enabled", () => {
    expect(
      sellerAccountStatusLabel({
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements_currently_due: [],
        requirements_past_due: ["individual.id_number"],
      })
    ).toBe("Action required — requirements past due");
  });

  it("labels a fully enabled account as payouts enabled", () => {
    expect(
      sellerAccountStatusLabel({
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements_currently_due: [],
        requirements_past_due: [],
      })
    ).toBe("Payouts enabled");
  });

  it("does not call an account payouts-enabled if only one of the two flags is true", () => {
    expect(
      sellerAccountStatusLabel({
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
        requirements_currently_due: [],
        requirements_past_due: [],
      })
    ).not.toBe("Payouts enabled");
  });

  it("has a style for every label sellerAccountStatusLabel can return", () => {
    const possibleLabels = [
      sellerAccountStatusLabel(null),
      "Onboarding incomplete",
      "Under review",
      "Under review — requirements due",
      "Action required — requirements past due",
      "Payouts enabled",
    ];
    for (const label of possibleLabels) {
      expect(SELLER_ACCOUNT_STATUS_STYLES).toHaveProperty(label);
    }
  });
});

describe("formatJoinedDate", () => {
  it("formats as month and year only, never the day", () => {
    expect(formatJoinedDate("2026-03-14T09:00:00Z")).toBe("Joined March 2026");
  });
});

describe("SELLER_ONBOARDING_STATUS_LABELS / STYLES", () => {
  const statuses: SellerOnboardingStatus[] = [
    "not_started",
    "requirements_due",
    "pending",
    "enabled",
    "restricted",
  ];

  it("has a label and a style for every SellerOnboardingStatus value", () => {
    for (const status of statuses) {
      expect(typeof SELLER_ONBOARDING_STATUS_LABELS[status]).toBe("string");
      expect(typeof SELLER_ONBOARDING_STATUS_STYLES[status]).toBe("string");
    }
  });
});
