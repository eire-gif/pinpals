import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_CATEGORY,
  OPTIONAL_NOTIFICATION_CATEGORIES,
  categoryForType,
  shouldSendEmail,
  shouldSendPush,
  buildDedupeKey,
  notificationHref,
  isOptionalCategory,
  NOTIFICATION_CHANNELS,
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

describe("tee_time_posted", () => {
  it("is a known type routed to the tee_times category", () => {
    expect(NOTIFICATION_TYPES).toContain("tee_time_posted");
    expect(categoryForType("tee_time_posted")).toBe("tee_times");
  });

  it("is silenceable — tee_times is an optional category, not a transactional one", () => {
    // The point of the whole category. This is the app's first broadcast
    // notification: one member posting reaches every connection they have,
    // so it must be possible to turn off. Payments and disputes are the
    // opposite and deliberately cannot be.
    expect(OPTIONAL_NOTIFICATION_CATEGORIES).toContain("tee_times");
    expect(shouldSendEmail("tee_time_posted", false)).toBe(false);
  });

  it("defaults to on when a member has never touched the setting", () => {
    expect(shouldSendEmail("tee_time_posted", null)).toBe(true);
    expect(shouldSendEmail("tee_time_posted", true)).toBe(true);
  });
});

describe("shouldSendPush", () => {
  // 0075 added push as a second channel. Its rule is identical to email's by
  // design — the tests below are the guard against the two drifting apart,
  // because the failure mode of divergence is a member who can silence
  // payment push but not payment email (or worse, the reverse).

  it("is always true for a transactional type, regardless of any passed-in preference", () => {
    expect(shouldSendPush("payment_succeeded", false)).toBe(true);
    expect(shouldSendPush("payment_failed", null)).toBe(true);
    expect(shouldSendPush("refund_requested", false)).toBe(true);
    expect(shouldSendPush("dispute_opened", false)).toBe(true);
  });

  it("defaults to true for an optional type with no stored preference row", () => {
    expect(shouldSendPush("new_message", null)).toBe(true);
    expect(shouldSendPush("tee_time_posted", null)).toBe(true);
  });

  it("respects an explicit false preference for an optional type", () => {
    expect(shouldSendPush("new_message", false)).toBe(false);
    expect(shouldSendPush("tee_time_posted", false)).toBe(false);
  });

  it("is false for a type this app has never declared", () => {
    expect(shouldSendPush("not_a_real_type", true)).toBe(false);
  });

  it("agrees with shouldSendEmail for every declared type and every preference value", () => {
    for (const type of NOTIFICATION_TYPES) {
      for (const enabled of [true, false, null]) {
        expect(shouldSendPush(type, enabled)).toBe(shouldSendEmail(type, enabled));
      }
    }
  });
});

describe("the tee-time interest loop (0077)", () => {
  // Before 0077 the only tee-time notification was the broadcast. Every
  // one-to-one step — someone asks to join, the host offers a place, the
  // golfer confirms — happened in silence.
  const LOOP_TYPES = [
    "tee_time_interest_received",
    "tee_time_place_offered",
    "tee_time_interest_declined",
    "tee_time_place_confirmed",
    "tee_time_place_withdrawn",
    "tee_time_cancelled",
  ] as const;

  it("declares every step of the loop", () => {
    for (const type of LOOP_TYPES) {
      expect(NOTIFICATION_TYPES).toContain(type);
    }
  });

  it("routes them all to the tee_times category", () => {
    for (const type of LOOP_TYPES) {
      expect(categoryForType(type)).toBe("tee_times");
    }
  });

  it("makes them silenceable on both channels, and on by default", () => {
    // tee_times is optional, not transactional — a member who finds tee-time
    // traffic noisy must be able to turn it off without losing payment mail.
    for (const type of LOOP_TYPES) {
      expect(shouldSendEmail(type, false)).toBe(false);
      expect(shouldSendPush(type, false)).toBe(false);
      expect(shouldSendEmail(type, null)).toBe(true);
      expect(shouldSendPush(type, null)).toBe(true);
    }
  });
});

describe("NOTIFICATION_CHANNELS", () => {
  it("names exactly the two columns notification_preferences carries", () => {
    // If a third channel is ever added, this list, the migration, the
    // settings form's field names and notifyUser()'s dispatch all have to
    // move together.
    expect([...NOTIFICATION_CHANNELS]).toEqual(["email", "push"]);
  });
});
