import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  LISTING_STATUS_LABELS,
  OFFER_STATUS_STYLES,
  personName,
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
