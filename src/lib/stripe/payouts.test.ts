import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { mapStripePayoutToRow, orderPayoutStatusForPayout, stripePayoutDashboardUrl } from "./payouts";

// Minimal fixtures — only the fields mapStripePayoutToRow() reads, same
// "cast through unknown rather than construct a full Stripe.Payout" reasoning
// as connect.test.ts's fakeAccount().
function fakePayout(overrides: Record<string, unknown> = {}): Stripe.Payout {
  return {
    id: "po_test123",
    amount: 4250,
    currency: "eur",
    status: "paid",
    failure_code: null,
    failure_message: null,
    arrival_date: 1_700_000_000,
    method: "standard",
    type: "bank_account",
    created: 1_699_900_000,
    ...overrides,
  } as unknown as Stripe.Payout;
}

const INPUT = { userId: "user-1", stripeAccountId: "acct_seller1", livemode: false };

describe("mapStripePayoutToRow", () => {
  it("maps a paid payout, converting cents to euros and unix seconds to ISO", () => {
    const row = mapStripePayoutToRow(fakePayout(), INPUT);
    expect(row).toEqual({
      user_id: "user-1",
      stripe_account_id: "acct_seller1",
      stripe_payout_id: "po_test123",
      amount_eur: 42.5,
      currency: "eur",
      status: "paid",
      failure_code: null,
      failure_message: null,
      arrival_date: new Date(1_700_000_000 * 1000).toISOString(),
      method: "standard",
      type: "bank_account",
      livemode: false,
      stripe_created_at: new Date(1_699_900_000 * 1000).toISOString(),
    });
  });

  it("carries through a failure code/message for a failed payout", () => {
    const row = mapStripePayoutToRow(
      fakePayout({ status: "failed", failure_code: "account_closed", failure_message: "The bank account has been closed" }),
      INPUT
    );
    expect(row.status).toBe("failed");
    expect(row.failure_code).toBe("account_closed");
    expect(row.failure_message).toBe("The bank account has been closed");
  });

  it("treats a null arrival_date as not yet known, not a crash", () => {
    const row = mapStripePayoutToRow(fakePayout({ arrival_date: null }), INPUT);
    expect(row.arrival_date).toBeNull();
  });

  it("stamps whichever connected account and livemode the caller passes in, not anything read off the payout itself", () => {
    const row = mapStripePayoutToRow(fakePayout(), { userId: "user-2", stripeAccountId: "acct_other", livemode: true });
    expect(row.user_id).toBe("user-2");
    expect(row.stripe_account_id).toBe("acct_other");
    expect(row.livemode).toBe(true);
  });
});

describe("orderPayoutStatusForPayout", () => {
  it("maps a paid payout to paid_out", () => {
    expect(orderPayoutStatusForPayout("paid")).toBe("paid_out");
  });

  it("maps a failed or canceled payout to failed", () => {
    expect(orderPayoutStatusForPayout("failed")).toBe("failed");
    expect(orderPayoutStatusForPayout("canceled")).toBe("failed");
  });

  it("returns null for a still-in-flight payout — nothing to reconcile yet", () => {
    expect(orderPayoutStatusForPayout("pending")).toBeNull();
    expect(orderPayoutStatusForPayout("in_transit")).toBeNull();
  });
});

describe("stripePayoutDashboardUrl", () => {
  it("links into the connected account's own payout view", () => {
    expect(stripePayoutDashboardUrl("acct_seller1", "po_test123", true)).toBe(
      "https://dashboard.stripe.com/connect/accounts/acct_seller1/payouts/po_test123"
    );
  });

  it("uses the test-mode dashboard host when livemode is false", () => {
    expect(stripePayoutDashboardUrl("acct_seller1", "po_test123", false)).toBe(
      "https://dashboard.stripe.com/test/connect/accounts/acct_seller1/payouts/po_test123"
    );
  });
});
