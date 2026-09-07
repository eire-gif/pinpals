import { describe, expect, it } from "vitest";
import { computeCheckoutTotal, formatAddress, ADDRESS_FIELD_LIMITS, DELIVERY_FEE_EUR, TAX_TREATMENT } from "./orders";

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
