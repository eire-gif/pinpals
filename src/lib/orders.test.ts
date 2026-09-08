import { describe, expect, it } from "vitest";
import {
  computeCheckoutTotal,
  formatAddress,
  ADDRESS_FIELD_LIMITS,
  DELIVERY_FEE_EUR,
  TAX_TREATMENT,
  buyerOrderNextAction,
  isSellerOrderAwaitingFulfilment,
  sellerFulfilmentLabel,
} from "./orders";

describe("computeCheckoutTotal", () => {
  it("charges no delivery fee for collection", () => {
    expect(computeCheckoutTotal(150, "collection")).toEqual({
      itemPriceEur: 150,
      fee: 10.5, // 7% of 150
      delivery: 0,
      total: 160.5,
    });
  });

  it("adds the flat delivery fee for post", () => {
    expect(computeCheckoutTotal(100, "post")).toEqual({
      itemPriceEur: 100,
      fee: 7,
      delivery: DELIVERY_FEE_EUR,
      total: 113,
    });
  });

  it("rounds the fee and total to the nearest cent rather than accumulating float drift", () => {
    // 19.99 * 0.07 = 1.3993 in floating point — must land on 1.40, not 1.3993.
    const result = computeCheckoutTotal(19.99, "collection");
    expect(result.fee).toBe(1.4);
    expect(result.total).toBe(21.39);
  });

  it("mirrors create_purchase_order()'s own math (0050) for a round-number case", () => {
    // amount_eur = 250, fee = round(250 * 0.07, 2) = 17.5, delivery = 6.00,
    // total = 250 + 17.5 + 6 = 273.5 — same figures that migration's
    // auction_with_buy_now test case (checkout.test.ts) asserts server-side.
    expect(computeCheckoutTotal(250, "post")).toEqual({
      itemPriceEur: 250,
      fee: 17.5,
      delivery: 6,
      total: 273.5,
    });
  });

  it("a zero item price still returns a well-formed breakdown, not NaN", () => {
    expect(computeCheckoutTotal(0, "post")).toEqual({
      itemPriceEur: 0,
      fee: 0,
      delivery: DELIVERY_FEE_EUR,
      total: DELIVERY_FEE_EUR,
    });
  });
});

describe("TAX_TREATMENT", () => {
  it("is a fixed, considered 'not applicable' rather than an omitted concept", () => {
    expect(TAX_TREATMENT).toBe("not_applicable");
  });
});

describe("formatAddress", () => {
  it("joins recipient, line1, city with commas when there's no line2/county/eircode", () => {
    expect(
      formatAddress({
        recipient_name: "Brian Buyer",
        line1: "1 Fairway Drive",
        line2: null,
        city: "Tralee",
        county: null,
        eircode: null,
      }),
    ).toBe("Brian Buyer, 1 Fairway Drive, Tralee");
  });

  it("inserts line2 right after line1 when present", () => {
    expect(
      formatAddress({
        recipient_name: "Brian Buyer",
        line1: "1 Fairway Drive",
        line2: "Apt 4",
        city: "Tralee",
        county: null,
        eircode: null,
      }),
    ).toBe("Brian Buyer, 1 Fairway Drive, Apt 4, Tralee");
  });

  it("appends county after a comma, and eircode after a space with no comma", () => {
    expect(
      formatAddress({
        recipient_name: "Brian Buyer",
        line1: "1 Fairway Drive",
        line2: null,
        city: "Tralee",
        county: "Kerry",
        eircode: "V92X1Y2",
      }),
    ).toBe("Brian Buyer, 1 Fairway Drive, Tralee, Kerry V92X1Y2");
  });

  it("includes eircode with no county present, still space-separated from city", () => {
    expect(
      formatAddress({
        recipient_name: "Brian Buyer",
        line1: "1 Fairway Drive",
        line2: null,
        city: "Tralee",
        county: null,
        eircode: "V92X1Y2",
      }),
    ).toBe("Brian Buyer, 1 Fairway Drive, Tralee V92X1Y2");
  });

  it("matches create_purchase_order()/finalize_offer_checkout()'s (0050) exact SQL concatenation with every field present", () => {
    // Same fixture values checkout.test.ts's RLS suite asserts server-side
    // for delivery_detail — this is the client-side mirror producing the
    // identical string before the order even exists.
    expect(
      formatAddress({
        recipient_name: "Brian Buyer",
        line1: "1 Fairway Drive",
        line2: "Apt 4",
        city: "Tralee",
        county: "Kerry",
        eircode: "V92X1Y2",
      }),
    ).toBe("Brian Buyer, 1 Fairway Drive, Apt 4, Tralee, Kerry V92X1Y2");
  });
});

describe("ADDRESS_FIELD_LIMITS", () => {
  it("mirrors the check constraints addresses' own migration (0050) enforces", () => {
    expect(ADDRESS_FIELD_LIMITS).toEqual({
      label: 60,
      recipientName: 120,
      line1: 200,
      line2: 200,
      city: 100,
      county: 100,
      eircode: 20,
      phone: 30,
    });
  });
});

// ============ marketplace-workspaces (this phase) ============

describe("buyerOrderNextAction", () => {
  const base = {
    id: 42,
    status: "pending" as const,
    payment_status: "unpaid" as const,
    checkout_completed_at: null as string | null,
    reservation_expires_at: "2099-01-01T00:00:00.000Z" as string | null,
  };

  it("is null once paid — nothing left for the buyer to do", () => {
    expect(buyerOrderNextAction({ ...base, payment_status: "paid" })).toBeNull();
  });

  it("is null once the order has left 'pending' (completed/cancelled/refunded)", () => {
    expect(buyerOrderNextAction({ ...base, status: "completed", payment_status: "paid" })).toBeNull();
    expect(buyerOrderNextAction({ ...base, status: "cancelled" })).toBeNull();
  });

  it("is null once the reservation deadline has passed — the sweep resolves it, not a buyer click", () => {
    expect(buyerOrderNextAction({ ...base, reservation_expires_at: "2000-01-01T00:00:00.000Z" })).toBeNull();
  });

  it("points to /checkout when checkout_completed_at is still null", () => {
    expect(buyerOrderNextAction(base)).toEqual({
      label: "Finish checkout",
      href: "/dashboard/orders/42/checkout",
      deadlineIso: base.reservation_expires_at,
    });
  });

  it("points to the order page to pay once checkout is finished", () => {
    expect(buyerOrderNextAction({ ...base, checkout_completed_at: "2026-01-01T00:00:00.000Z" })).toEqual({
      label: "Complete payment",
      href: "/dashboard/orders/42",
      deadlineIso: base.reservation_expires_at,
    });
  });

  it("says 'Try payment again' once a payment attempt has already failed", () => {
    expect(
      buyerOrderNextAction({
        ...base,
        checkout_completed_at: "2026-01-01T00:00:00.000Z",
        payment_status: "failed",
      })
    ).toEqual({
      label: "Try payment again",
      href: "/dashboard/orders/42",
      deadlineIso: base.reservation_expires_at,
    });
  });

  it("has no reservation deadline for an order that never had one — still actionable", () => {
    expect(buyerOrderNextAction({ ...base, reservation_expires_at: null })).toEqual({
      label: "Finish checkout",
      href: "/dashboard/orders/42/checkout",
      deadlineIso: null,
    });
  });
});

describe("isSellerOrderAwaitingFulfilment", () => {
  it("is true only for a completed, paid order", () => {
    expect(isSellerOrderAwaitingFulfilment({ status: "completed", payment_status: "paid" })).toBe(true);
  });

  it("is false for a pending, cancelled, or refunded order, or one that isn't actually paid", () => {
    expect(isSellerOrderAwaitingFulfilment({ status: "pending", payment_status: "paid" })).toBe(false);
    expect(isSellerOrderAwaitingFulfilment({ status: "completed", payment_status: "refunded" })).toBe(false);
    expect(isSellerOrderAwaitingFulfilment({ status: "cancelled", payment_status: "unpaid" })).toBe(false);
  });
});

describe("sellerFulfilmentLabel", () => {
  it("describes posting for 'post' and collection for 'collection'", () => {
    expect(sellerFulfilmentLabel({ delivery_method: "post" })).toBe("Post the item to the buyer");
    expect(sellerFulfilmentLabel({ delivery_method: "collection" })).toBe("Arrange collection with the buyer");
  });
});
