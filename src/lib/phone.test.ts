import { describe, it, expect } from "vitest";
import { normalisePhone, formatPhoneForDisplay, isPhoneRegion } from "./phone";

describe("normalisePhone", () => {
  it("treats an empty field as a valid absence, not an error", () => {
    expect(normalisePhone("", "IE")).toEqual({ ok: true, e164: null });
    expect(normalisePhone("   ", "IE")).toEqual({ ok: true, e164: null });
  });

  it("drops the national trunk zero and applies the region's dial code", () => {
    expect(normalisePhone("087 123 4567", "IE")).toEqual({ ok: true, e164: "+353871234567" });
    expect(normalisePhone("07700 900123", "GB")).toEqual({ ok: true, e164: "+447700900123" });
  });

  it("accepts the same number written the way people actually write it", () => {
    const expected = { ok: true, e164: "+353871234567" };
    expect(normalisePhone("0871234567", "IE")).toEqual(expected);
    expect(normalisePhone("(087) 123-4567", "IE")).toEqual(expected);
    expect(normalisePhone("+353 87 123 4567", "IE")).toEqual(expected);
    expect(normalisePhone("00353 87 123 4567", "IE")).toEqual(expected);
  });

  it("ignores the region when the member typed a country code themselves", () => {
    // Someone in Ireland entering a French number with IE still selected.
    expect(normalisePhone("+33 6 12 34 56 78", "IE")).toEqual({ ok: true, e164: "+33612345678" });
  });

  it("requires a country code when the region is 'somewhere else'", () => {
    const result = normalisePhone("612345678", "INT");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("country code");
  });

  it("accepts a full international number under the 'somewhere else' region", () => {
    expect(normalisePhone("+1 415 555 0132", "INT")).toEqual({ ok: true, e164: "+14155550132" });
  });

  it("rejects anything that isn't shaped like a phone number", () => {
    expect(normalisePhone("not a number", "IE").ok).toBe(false);
    expect(normalisePhone("12", "IE").ok).toBe(false);
    // Longer than E.164 permits.
    expect(normalisePhone("+3538712345678901234", "IE").ok).toBe(false);
  });

  it("rejects a number whose country code would start with zero", () => {
    expect(normalisePhone("+0123456789", "INT").ok).toBe(false);
  });

  it("always produces something the database CHECK constraint accepts", () => {
    const constraint = /^\+[1-9][0-9]{6,14}$/;
    const inputs: [string, "IE" | "GB" | "INT"][] = [
      ["087 123 4567", "IE"],
      ["01 234 5678", "IE"],
      ["07700 900123", "GB"],
      ["+44 20 7946 0958", "GB"],
      ["+1 415 555 0132", "INT"],
    ];
    for (const [raw, region] of inputs) {
      const result = normalisePhone(raw, region);
      expect(result.ok, `${raw} (${region})`).toBe(true);
      if (result.ok && result.e164) expect(constraint.test(result.e164), result.e164).toBe(true);
    }
  });
});

describe("formatPhoneForDisplay", () => {
  it("returns an empty string for no number", () => {
    expect(formatPhoneForDisplay(null)).toBe("");
  });

  it("spaces Irish and UK numbers, and leaves others alone", () => {
    expect(formatPhoneForDisplay("+353871234567")).toBe("+353 87 123 4567");
    expect(formatPhoneForDisplay("+447700900123")).toBe("+44 7700 900123");
    expect(formatPhoneForDisplay("+14155550132")).toBe("+14155550132");
  });
});

describe("isPhoneRegion", () => {
  it("accepts the three supported regions and nothing else", () => {
    expect(isPhoneRegion("IE")).toBe(true);
    expect(isPhoneRegion("GB")).toBe(true);
    expect(isPhoneRegion("INT")).toBe(true);
    expect(isPhoneRegion("FR")).toBe(false);
    expect(isPhoneRegion("")).toBe(false);
  });
});
