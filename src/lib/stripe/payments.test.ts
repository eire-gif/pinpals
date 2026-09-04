import { describe, expect, it } from "vitest";
import { centsFromEur, reconcilePaymentIntentAmount, truncateErrorMessage } from "./payments";

describe("centsFromEur", () => {
  it("converts a plain euro amount to cents", () => {
    expect(centsFromEur(42)).toBe(4200);
  });

  it("rounds to the nearest cent rather than truncating", () => {
    // Same rounding rule as computeOfferTotal() in src/lib/marketplace.ts —
    // this has to agree with what the checkout action actually charged, or
    // reconcilePaymentIntentAmount() would reject its own PaymentIntents.
    expect(centsFromEur(19.999)).toBe(2000);
    expect(centsFromEur(19.994)).toBe(1999);
  });
});

describe("truncateErrorMessage", () => {
  it("passes short messages through unchanged", () => {
    expect(truncateErrorMessage("Your card was declined.")).toBe("Your card was declined.");
  });

  it("trims surrounding whitespace", () => {
    expect(truncateErrorMessage("  Your card was declined.  ")).toBe("Your card was declined.");
  });

  it("returns null for null, undefined, or blank input", () => {
    expect(truncateErrorMessage(null)).toBeNull();
    expect(truncateErrorMessage(undefined)).toBeNull();
    expect(truncateErrorMessage("   ")).toBeNull();
  });

  it("caps very long messages rather than storing them unbounded", () => {
    const long = "x".repeat(1000);
    const result = truncateErrorMessage(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(500);
    expect(result!.endsWith("…")).toBe(true);
  });
});

describe("reconcilePaymentIntentAmount", () => {
  it("accepts a PaymentIntent that matches the order's total exactly", () => {
    expect(
      reconcilePaymentIntentAmount({ expectedTotalEur: 107.5, actualAmountCents: 10750, actualCurrency: "eur" })
    ).toEqual({ ok: true });
  });

  it("rejects a currency other than eur", () => {
    const result = reconcilePaymentIntentAmount({
      expectedTotalEur: 100,
      actualAmountCents: 10000,
      actualCurrency: "usd",
    });
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/currency mismatch/i);
  });

  it("rejects an amount that doesn't match the order's total", () => {
    const result = reconcilePaymentIntentAmount({
      expectedTotalEur: 100,
      actualAmountCents: 9999,
      actualCurrency: "eur",
    });
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/amount mismatch/i);
  });

  it("never trusts the browser — a caller can only supply the order's own total, never an arbitrary amount", () => {
    // This is what stands between "never trust price/fee values sent only
    // from the browser" and this function: it takes expectedTotalEur (from
    // the DB row) and actualAmountCents (from Stripe's own signed event),
    // never a value a checkout request itself could have supplied.
    const tampered = reconcilePaymentIntentAmount({
      expectedTotalEur: 50,
      actualAmountCents: 1, // what a manipulated client might have tried to pay
      actualCurrency: "eur",
    });
    expect(tampered.ok).toBe(false);
  });
});
