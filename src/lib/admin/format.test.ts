import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  LISTING_STATUS_LABELS,
  OFFER_STATUS_STYLES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STYLES,
  PAYMENT_STATUS_LABELS,
  PAYOUT_STATUS_LABELS,
  personName,
  sellerStatusLabel,
  statusLabel,
  statusStyle,
} from "./format";

describe("statusLabel", () => {
  it("looks up a known status", () => {
    expect(statusLabel(LISTING_STATUS_LABELS, "active")).toBe("Active");
  });

  it("falls back to the raw status string for anything unrecognised", () => {
    expect(statusLabel(LISTING_STATUS_LABELS, "archived")).toBe("archived");
  });
});

describe("statusStyle", () => {
  it("looks up a known status", () => {
    expect(statusStyle(OFFER_STATUS_STYLES, "accepted")).toBe("bg-green-100 text-green-800");
  });

  it("falls back to a neutral style for anything unrecognised, never throwing", () => {
    expect(statusStyle(OFFER_STATUS_STYLES, "refunded")).toBe("bg-cream-100 text-ink-900");
  });
});

describe("order status/payment status/payout status vocab", () => {
  // /admin/orders (src/app/admin/orders/) renders every value of
  // OrderStatus/PaymentStatus/PayoutStatus (src/lib/types.ts) through these
  // maps via StatusBadge — a value missing a label or style would silently
  // render as the raw string / a fallback style rather than fail loudly, so
  // pin every status to its expected label here the same way
  // reports.test.ts pins the report vocab.
  it("has a label for every order status", () => {
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual(
      ["cancelled", "completed", "pending", "refunded"].sort()
    );
  });

  it("has a style for every order status", () => {
    for (const status of Object.keys(ORDER_STATUS_LABELS)) {
      expect(ORDER_STATUS_STYLES).toHaveProperty(status);
    }
  });

  it("has a label for every payment status", () => {
    expect(Object.keys(PAYMENT_STATUS_LABELS).sort()).toEqual(
      ["failed", "paid", "pending", "refunded", "unpaid"].sort()
    );
  });

  it("has a label for every payout status", () => {
    expect(Object.keys(PAYOUT_STATUS_LABELS).sort()).toEqual(
      ["held", "not_started", "paid_out", "pending"].sort()
    );
  });
});

describe("personName", () => {
  it("joins first and last name", () => {
    expect(personName({ first_name: "Grace", last_name: "Walsh" })).toBe("Grace Walsh");
  });

  it("labels a null profile rather than rendering blank", () => {
    expect(personName(null)).toBe("Unknown member");
  });
});

describe("formatDateTime", () => {
  it("formats an ISO timestamp as a short Irish-locale date and time", () => {
    // en-IE renders day before month; assert on the pieces rather than one
    // exact string so this doesn't break on a Node ICU minor-version tweak.
    const formatted = formatDateTime("2026-09-01T14:50:12.000Z");
    expect(formatted).toContain("2026");
    expect(formatted).toMatch(/Sep/);
  });
});

describe("sellerStatusLabel", () => {
  it("labels a member with no listings as not selling", () => {
    expect(sellerStatusLabel([])).toBe("Not selling — no listings");
  });

  it("labels a member with an active listing as an active seller", () => {
    expect(sellerStatusLabel([{ status: "active" }])).toContain("Active seller");
  });

  it("counts reserved listings as active (sale agreed, not yet paid)", () => {
    expect(sellerStatusLabel([{ status: "reserved" }, { status: "active" }])).toContain("2 live");
  });

  it("labels a member whose only listings are sold/removed as an inactive seller", () => {
    expect(sellerStatusLabel([{ status: "sold" }, { status: "removed" }])).toBe(
      "Inactive seller — no active listings"
    );
  });

  it("uses singular wording for exactly one live listing", () => {
    expect(sellerStatusLabel([{ status: "active" }])).toBe("Active seller — 1 live listing");
  });
});
