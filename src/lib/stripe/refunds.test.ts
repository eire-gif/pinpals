import { describe, expect, it } from "vitest";
import { computeRefundableAmountEur, isOrderRefundable, mapStripeRefundStatus, stripeDisputeDashboardUrl } from "./refunds";

describe("computeRefundableAmountEur", () => {
  it("returns the full total when there are no refunds yet", () => {
    expect(computeRefundableAmountEur({ total_eur: 100 }, [])).toBe(100);
  });

  it("subtracts pending, requires_action, and succeeded refunds", () => {
    expect(
      computeRefundableAmountEur({ total_eur: 100 }, [
        { amount_eur: 20, status: "pending" },
        { amount_eur: 10, status: "requires_action" },
        { amount_eur: 15, status: "succeeded" },
      ])
    ).toBe(55);
  });

  it("does not subtract failed or canceled refunds", () => {
    expect(
      computeRefundableAmountEur({ total_eur: 100 }, [
        { amount_eur: 40, status: "failed" },
        { amount_eur: 40, status: "canceled" },
      ])
    ).toBe(100);
  });

  it("never goes negative even if refunds somehow exceed the total", () => {
    expect(computeRefundableAmountEur({ total_eur: 50 }, [{ amount_eur: 80, status: "succeeded" }])).toBe(0);
  });
});

describe("isOrderRefundable", () => {
  it("is true for a paid order with a payment reference", () => {
    expect(isOrderRefundable({ payment_status: "paid", payment_reference: "pi_123" })).toBe(true);
  });

  it("is true for a partially-refunded order with a payment reference", () => {
    expect(isOrderRefundable({ payment_status: "refunded", payment_reference: "pi_123" })).toBe(true);
  });

  it("is false without a payment reference", () => {
    expect(isOrderRefundable({ payment_status: "paid", payment_reference: null })).toBe(false);
  });

  it("is false for unpaid/pending/failed orders", () => {
    expect(isOrderRefundable({ payment_status: "unpaid", payment_reference: "pi_123" })).toBe(false);
    expect(isOrderRefundable({ payment_status: "pending", payment_reference: "pi_123" })).toBe(false);
    expect(isOrderRefundable({ payment_status: "failed", payment_reference: "pi_123" })).toBe(false);
  });
});

describe("mapStripeRefundStatus", () => {
  it("passes through every known Stripe refund status", () => {
    expect(mapStripeRefundStatus("pending")).toBe("pending");
    expect(mapStripeRefundStatus("requires_action")).toBe("requires_action");
    expect(mapStripeRefundStatus("succeeded")).toBe("succeeded");
    expect(mapStripeRefundStatus("failed")).toBe("failed");
    expect(mapStripeRefundStatus("canceled")).toBe("canceled");
  });

  it("falls back to pending for anything unrecognised", () => {
    // Stripe's own Refund.status type is `string | null`, not a closed
    // union, so this is a legitimate runtime input to guard against, not
    // just a type-system exercise.
    expect(mapStripeRefundStatus("something_new")).toBe("pending");
  });

  it("falls back to pending for null", () => {
    expect(mapStripeRefundStatus(null)).toBe("pending");
  });
});

describe("stripeDisputeDashboardUrl", () => {
  it("builds a live-mode dashboard URL", () => {
    expect(stripeDisputeDashboardUrl("dp_123", true)).toBe("https://dashboard.stripe.com/disputes/dp_123");
  });

  it("builds a test-mode dashboard URL", () => {
    expect(stripeDisputeDashboardUrl("dp_123", false)).toBe("https://dashboard.stripe.com/test/disputes/dp_123");
  });
});
