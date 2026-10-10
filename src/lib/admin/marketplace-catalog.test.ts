import { describe, expect, it } from "vitest";
import {
  changedFields,
  isHttpsUrl,
  parseAffiliateProductForm,
  parseBannerForm,
  parseOptionalEur,
} from "./marketplace-catalog";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("isHttpsUrl", () => {
  it("accepts absolute https URLs only", () => {
    expect(isHttpsUrl("https://example.com/driver?tag=pinpals")).toBe(true);
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("https://")).toBe(false);
    expect(isHttpsUrl("//example.com")).toBe(false);
  });
});

describe("parseOptionalEur", () => {
  it("parses blank as null and rejects bad amounts as undefined", () => {
    expect(parseOptionalEur("")).toBeNull();
    expect(parseOptionalEur("349.99")).toBe(349.99);
    expect(parseOptionalEur("€20")).toBe(20);
    expect(parseOptionalEur("-5")).toBeUndefined();
    expect(parseOptionalEur("1.234")).toBeUndefined();
  });
});

describe("parseAffiliateProductForm", () => {
  const valid = {
    title: "TaylorMade Qi35 Driver",
    retailer: "Golf Store",
    url: "https://shop.example.com/qi35?aff=pinpals",
    price_eur: "549",
    was_price_eur: "",
    sort_order: "2",
    active: "on",
  };

  it("accepts a valid product", () => {
    const result = parseAffiliateProductForm(form(valid));
    expect(result).toEqual({
      ok: true,
      value: {
        title: "TaylorMade Qi35 Driver",
        brand: null,
        category: null,
        price_eur: 549,
        was_price_eur: null,
        image_url: null,
        retailer: "Golf Store",
        url: "https://shop.example.com/qi35?aff=pinpals",
        sort_order: 2,
        active: true,
      },
    });
  });

  it("rejects a non-https product link server-side", () => {
    const result = parseAffiliateProductForm(form({ ...valid, url: "http://shop.example.com" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a non-https image URL", () => {
    expect(parseAffiliateProductForm(form({ ...valid, image_url: "data:image/png;base64,xx" })).ok).toBe(false);
  });

  it("treats a missing active checkbox as inactive", () => {
    const { active: _active, ...rest } = valid;
    void _active;
    const result = parseAffiliateProductForm(form(rest));
    expect(result.ok && result.value.active).toBe(false);
  });
});

describe("parseBannerForm", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const valid = {
    title: "Autumn fitting days",
    sponsor: "Acme Golf",
    link_url: "https://acme.example.com/fitting",
    placement: "new_gear",
    starts_at: "2026-10-12T09:00",
    ends_at: "2026-10-19T09:00",
    fee_eur: "250",
    active: "on",
  };

  it("accepts a valid banner", () => {
    const result = parseBannerForm(form(valid), now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.fee_eur).toBe(250);
      expect(result.value.placement).toBe("new_gear");
      expect(result.value.starts_at).toBe("2026-10-12T09:00:00.000Z");
      expect(result.value.ends_at).toBe("2026-10-19T09:00:00.000Z");
    }
  });

  it("defaults the start to now and allows an open end", () => {
    const result = parseBannerForm(form({ ...valid, starts_at: "", ends_at: "" }), now);
    expect(result.ok && result.value.starts_at).toBe(now.toISOString());
    expect(result.ok && result.value.ends_at).toBeNull();
  });

  it("rejects an end before the start, a non-https link, and an unknown placement", () => {
    expect(parseBannerForm(form({ ...valid, ends_at: "2026-10-11T09:00" }), now).ok).toBe(false);
    expect(parseBannerForm(form({ ...valid, link_url: "ftp://acme.example.com" }), now).ok).toBe(false);
    expect(parseBannerForm(form({ ...valid, placement: "homepage" }), now).ok).toBe(false);
  });
});

describe("changedFields", () => {
  it("compares numerics and timestamps by value, not representation", () => {
    expect(
      changedFields(
        { title: "A", fee_eur: "250.00" as unknown as number, starts_at: "2026-10-12T09:00:00+00:00", active: true },
        { title: "B", fee_eur: 250, starts_at: "2026-10-12T09:00:00.000Z", active: false }
      )
    ).toEqual(["title", "active"]);
  });
});
