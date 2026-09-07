import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  mapStripeAccountToRow,
  sellerOnboardingStatus,
  isSellerPaymentReady,
  type StripeConnectAccountRow,
} from "./connect";

// Minimal fixtures — only the fields mapStripeAccountToRow() reads. Cast
// through `unknown` rather than constructing a full Stripe.Account (dozens
// of unrelated required fields) since this function only touches a handful
// of them; that's the point of keeping it pure and narrowly typed.
function fakeAccount(overrides: Record<string, unknown> = {}): Stripe.Account {
  return {
    id: "acct_test123",
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    requirements: null,
    ...overrides,
  } as unknown as Stripe.Account;
}

describe("mapStripeAccountToRow", () => {
  it("maps a brand-new account with nothing enabled yet", () => {
    expect(mapStripeAccountToRow(fakeAccount())).toEqual({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements_currently_due: [],
      requirements_past_due: [],
      disabled_reason: null,
    });
  });

  it("maps a fully enabled account", () => {
    const row = mapStripeAccountToRow(
      fakeAccount({
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements: {
          currently_due: [],
          past_due: [],
          disabled_reason: null,
        } as unknown as Stripe.Account.Requirements,
      })
    );
    expect(row.charges_enabled).toBe(true);
    expect(row.payouts_enabled).toBe(true);
    expect(row.details_submitted).toBe(true);
    expect(row.requirements_currently_due).toEqual([]);
  });

  it("carries through requirement codes, never their values", () => {
    const row = mapStripeAccountToRow(
      fakeAccount({
        requirements: {
          currently_due: ["individual.verification.document", "external_account"],
          past_due: ["individual.id_number"],
          disabled_reason: "requirements.past_due",
        } as unknown as Stripe.Account.Requirements,
      })
    );
    expect(row.requirements_currently_due).toEqual([
      "individual.verification.document",
      "external_account",
    ]);
    expect(row.requirements_past_due).toEqual(["individual.id_number"]);
    expect(row.disabled_reason).toBe("requirements.past_due");
  });

  it("treats a null requirements hash as nothing outstanding, not a crash", () => {
    const row = mapStripeAccountToRow(fakeAccount({ requirements: null }));
    expect(row.requirements_currently_due).toEqual([]);
    expect(row.requirements_past_due).toEqual([]);
    expect(row.disabled_reason).toBeNull();
  });

  it("treats null currently_due/past_due arrays within requirements as empty", () => {
    const row = mapStripeAccountToRow(
      fakeAccount({
        requirements: {
          currently_due: null,
          past_due: null,
          disabled_reason: null,
        } as unknown as Stripe.Account.Requirements,
      })
    );
    expect(row.requirements_currently_due).toEqual([]);
    expect(row.requirements_past_due).toEqual([]);
  });
});

function fakeRow(overrides: Partial<StripeConnectAccountRow> = {}): StripeConnectAccountRow {
  return {
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    requirements_currently_due: [],
    requirements_past_due: [],
    disabled_reason: null,
    ...overrides,
  };
}

describe("sellerOnboardingStatus", () => {
  it("is not_started when no row exists yet", () => {
    expect(sellerOnboardingStatus(null)).toBe("not_started");
  });

  it("is restricted when Stripe has disabled the account, even if flags still read enabled", () => {
    expect(
      sellerOnboardingStatus(
        fakeRow({ charges_enabled: true, payouts_enabled: true, disabled_reason: "rejected.fraud" })
      )
    ).toBe("restricted");
  });

  it("is restricted when a requirement is now past due, even if flags still read enabled", () => {
    expect(
      sellerOnboardingStatus(
        fakeRow({
          charges_enabled: true,
          payouts_enabled: true,
          requirements_past_due: ["individual.verification.document"],
        })
      )
    ).toBe("restricted");
  });

  it("is requirements_due when something is currently due, even if flags still read enabled", () => {
    expect(
      sellerOnboardingStatus(
        fakeRow({
          charges_enabled: true,
          payouts_enabled: true,
          requirements_currently_due: ["individual.verification.document"],
        })
      )
    ).toBe("requirements_due");
  });

  it("is enabled once charges and payouts are both on and nothing is outstanding", () => {
    expect(
      sellerOnboardingStatus(fakeRow({ charges_enabled: true, payouts_enabled: true }))
    ).toBe("enabled");
  });

  it("is pending once submitted with nothing due but Stripe hasn't enabled charges/payouts yet", () => {
    expect(sellerOnboardingStatus(fakeRow({ details_submitted: true }))).toBe("pending");
  });

  it("is requirements_due for a freshly created account with no requirements reported yet", () => {
    expect(sellerOnboardingStatus(fakeRow())).toBe("requirements_due");
  });
});

describe("isSellerPaymentReady", () => {
  it("is true only for enabled", () => {
    expect(isSellerPaymentReady("enabled")).toBe(true);
    expect(isSellerPaymentReady("not_started")).toBe(false);
    expect(isSellerPaymentReady("requirements_due")).toBe(false);
    expect(isSellerPaymentReady("pending")).toBe(false);
    expect(isSellerPaymentReady("restricted")).toBe(false);
  });
});
