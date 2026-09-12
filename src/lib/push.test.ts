import { describe, expect, it } from "vitest";
import {
  DEAD_SUBSCRIPTION_STATUSES,
  PUSH_PAYLOAD_MAX_BYTES,
  buildPushPayload,
  describeDevice,
  isDeadSubscriptionStatus,
  isPushPayloadTooLarge,
  pushPayloadBytes,
  truncateForPush,
} from "./push";

describe("isDeadSubscriptionStatus", () => {
  it("is true for the two statuses that mean the device is gone for good", () => {
    for (const status of DEAD_SUBSCRIPTION_STATUSES) {
      expect(isDeadSubscriptionStatus(status)).toBe(true);
    }
  });

  it("is false for transient failures, which must be retried rather than pruned", () => {
    expect(isDeadSubscriptionStatus(429)).toBe(false);
    expect(isDeadSubscriptionStatus(500)).toBe(false);
    expect(isDeadSubscriptionStatus(503)).toBe(false);
  });

  it("is false when no status came back at all (a network error, not a verdict)", () => {
    expect(isDeadSubscriptionStatus(null)).toBe(false);
    expect(isDeadSubscriptionStatus(undefined)).toBe(false);
  });
});

describe("truncateForPush", () => {
  it("leaves a short body untouched", () => {
    expect(truncateForPush("2 spots left")).toBe("2 spots left");
  });

  it("collapses whitespace, so a body built from multiple fields doesn't render ragged", () => {
    expect(truncateForPush("Sat 19 Sep,   08:40\n\nPortmarnock")).toBe("Sat 19 Sep, 08:40 Portmarnock");
  });

  it("truncates on a word boundary and appends an ellipsis", () => {
    const result = truncateForPush("Portmarnock Links championship course", 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith("…")).toBe(true);
    expect(result).not.toContain("champio");
  });

  it("hard-cuts rather than losing most of the string to one very long word", () => {
    const result = truncateForPush("a Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch", 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith("…")).toBe(true);
  });

  it("doesn't leave dangling punctuation before the ellipsis", () => {
    expect(truncateForPush("Sat 19 Sep, 08:40 at Portmarnock", 20)).not.toContain(",…");
  });
});

describe("buildPushPayload", () => {
  const base = {
    type: "tee_time_posted",
    title: "Declan invited you to a fourball",
    body: "Sat 19 Sep, 08:40 · Portmarnock Links — 2 spots left",
    href: "/tee-times/42",
  };

  it("carries the notification through intact when it's within the limits", () => {
    const payload = buildPushPayload(base);
    expect(payload.title).toBe(base.title);
    expect(payload.body).toBe(base.body);
    expect(payload.href).toBe("/tee-times/42");
    expect(payload.type).toBe("tee_time_posted");
  });

  it("uses the dedupe key as the OS tag, so a retried event replaces rather than stacks", () => {
    const payload = buildPushPayload({ ...base, dedupeKey: "invite::42::posted::7" });
    expect(payload.tag).toBe("invite::42::posted::7");
  });

  it("falls back to the type as the tag when there's no dedupe key", () => {
    expect(buildPushPayload(base).tag).toBe("tee_time_posted");
    expect(buildPushPayload({ ...base, dedupeKey: "" }).tag).toBe("tee_time_posted");
    expect(buildPushPayload({ ...base, dedupeKey: null }).tag).toBe("tee_time_posted");
  });

  it("refuses an off-site href, defending the service worker against an open redirect", () => {
    expect(buildPushPayload({ ...base, href: "https://evil.example.com" }).href).toBe("/dashboard");
    expect(buildPushPayload({ ...base, href: "relative/path" }).href).toBe("/dashboard");
  });

  it("truncates an over-long title rather than letting the OS cut it mid-word", () => {
    const payload = buildPushPayload({ ...base, title: "x".repeat(200) });
    expect(payload.title.length).toBeLessThanOrEqual(80);
  });
});

describe("pushPayloadBytes", () => {
  it("counts bytes, not characters — a euro sign is three where an ASCII letter is one", () => {
    // Same character count in both bodies, so the only difference measured
    // is the encoding width: € is 3 bytes, E is 1. If this counted
    // characters the two would be equal.
    const ascii = buildPushPayload({ type: "offer_received", title: "Offer", body: "E180", href: "/x" });
    const euro = buildPushPayload({ type: "offer_received", title: "Offer", body: "€180", href: "/x" });
    expect(euro.body.length).toBe(ascii.body.length);
    expect(pushPayloadBytes(euro)).toBe(pushPayloadBytes(ascii) + 2);
  });

  it("passes a realistic notification comfortably", () => {
    const payload = buildPushPayload({
      type: "offer_received",
      title: "€180 offer on your Stealth 2 driver",
      body: "Sarah M. offered €180. You're asking €225. Expires in 24 hours.",
      href: "/dashboard/selling",
      dedupeKey: "offer::918::received::seller",
    });
    expect(isPushPayloadTooLarge(payload)).toBe(false);
    expect(pushPayloadBytes(payload)).toBeLessThan(PUSH_PAYLOAD_MAX_BYTES);
  });
});

describe("describeDevice", () => {
  it("names the common cases", () => {
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(describeDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBe("iPad");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8 Mobile)")).toBe("Android phone");
    expect(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows PC");
  });

  it("checks iPad before Mac, since iPadOS claims to be a Mac", () => {
    expect(describeDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit")).toBe("iPad");
  });

  it("falls back rather than guessing", () => {
    expect(describeDevice(null)).toBe("Unknown device");
    expect(describeDevice("")).toBe("Unknown device");
    expect(describeDevice("something-nobody-has-heard-of")).toBe("Unknown device");
  });
});
