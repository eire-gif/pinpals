import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_CATEGORY,
  OPTIONAL_NOTIFICATION_CATEGORIES,
  categoryForType,
  shouldSendEmail,
  buildDedupeKey,
  notificationHref,
  isOptionalCategory,
} from "./notifications";

describe("categoryForType", () => {
  it("resolves every declared NotificationType to a category", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(categoryForType(type)).toBe(NOTIFICATION_TYPE_CATEGORY[type]);
    }
  });

  it("returns null for an unrecognised type", () => {
    expect(categoryForType("something_made_up")).toBeNull();
  });
});

describe("isOptionalCategory", () => {
  it("agrees with OPTIONAL_NOTIFICATION_CATEGORIES", () => {
    expect(isOptionalCategory("messages")).toBe(true);
    expect(isOptionalCategory("offers")).toBe(true);
    expect(isOptionalCategory("auctions")).toBe(true);
    expect(isOptionalCategory("reviews")).toBe(true);
  });

  it("is false for the two transactional categories", () => {
    expect(isOptionalCategory("payments")).toBe(false);
    expect(isOptionalCategory("disputes_refunds")).toBe(false);
  });

  it("matches OPTIONAL_NOTIFICATION_CATEGORIES exactly", () => {
    for (const category of OPTIONAL_NOTIFICATION_CATEGORIES) {
      expect(isOptionalCategory(category)).toBe(true);
    }
  });
});

describe("shouldSendEmail", () => {
  it("is always true for a transactional type, regardless of any passed-in preference", () => {
    expect(shouldSendEmail("payment_succeeded", false)).toBe(true);
    expect(shouldSendEmail("payment_failed", null)).toBe(true);
    expect(shouldSendEmail("refund_requested", false)).toBe(true);
    expect(shouldSendEmail("dispute_opened", false)).toBe(true);
  });

  it("defaults to true for an optional type with no stored preference row", () => {
    expect(shouldSendEmail("new_message", null)).toBe(true);
    expect(shouldSendEmail("offer_received", null)).toBe(true);
  });

  it("respects an explicit false preference for an optional type", () => {
    expect(shouldSendEmail("new_message", false)).toBe(false);
    expect(shouldSendEmail("outbid", false)).toBe(false);
  });

  it("respects an explicit true preference for an optional type", () => {
    expect(shouldSendEmail("review_available", true)).toBe(true);
  });

  it("is false for a type this app has never declared", () => {
    expect(shouldSendEmail("not_a_real_type", true)).toBe(false);
  });
});

describe("buildDedupeKey", () => {
  it("joins parts with '::'", () => {
    expect(buildDedupeKey(["offer", 42, "accepted", "buyer"])).toBe("offer::42::accepted::buyer");
  });

  it("stringifies numeric parts", () => {
    expect(buildDedupeKey([1, 2, 3])).toBe("1::2::3");
  });

  it("produces distinct keys for conceptually distinct events", () => {
    const a = buildDedupeKey(["offer", 1, "accepted", "buyer"]);
    const b = buildDedupeKey(["offer", 1, "accepted", "seller"]);
    expect(a).not.toBe(b);
  });
});

describe("notificationHref", () => {
  it("returns the stored href when present and absolute-path-shaped", () => {
    expect(notificationHref({ href: "/dashboard/orders/5" })).toBe("/dashboard/orders/5");
  });

  it("falls back to /dashboard when data is null/undefined", () => {
    expect(notificationHref(null)).toBe("/dashboard");
    expect(notificationHref(undefined)).toBe("/dashboard");
  });

  it("falls back to /dashboard when href is missing", () => {
    expect(notificationHref({})).toBe("/dashboard");
  });

  it("falls back to /dashboard when href isn't a leading-slash string (defends against an open redirect)", () => {
    expect(notificationHref({ href: "https://evil.example.com" })).toBe("/dashboard");
    expect(notificationHref({ href: 42 })).toBe("/dashboard");
    expect(notificationHref({ href: "relative/path" })).toBe("/dashboard");
  });
});
