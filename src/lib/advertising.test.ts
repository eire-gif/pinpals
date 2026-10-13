import { describe, expect, it } from "vitest";
import {
  campaignView,
  changedKeys,
  checkCreativeDimensions,
  matchesFilter,
  parseAdvertiserForm,
  parseCampaignForm,
  parseEuro,
  parseUtcInput,
  parseDublinInput,
  toInputDublin,
} from "./advertising";

function form(fields: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  return fd;
}

const base = {
  advertiser_id: "3",
  name: "Algarve spring",
  category: "golf_travel",
  format: "feed",
  display_style: "artwork",
  link_url: "https://example.com/algarve",
  starts_at: "2026-11-01T00:00",
  ends_at: "2026-12-01T00:00",
  pricing_model: "flat",
  rate_eur: "450",
};

describe("creative dimensions", () => {
  it("accepts the recommended sizes and the same shape at the minimum width", () => {
    expect(checkCreativeDimensions("takeover", 1080, 1920)).toBeNull();
    expect(checkCreativeDimensions("takeover", 720, 1280)).toBeNull();
    expect(checkCreativeDimensions("banner", 1200, 300)).toBeNull();
    expect(checkCreativeDimensions("feed", 1080, 1080)).toBeNull();
    expect(checkCreativeDimensions("logo", 200, 200)).toBeNull();
  });

  it("rejects the wrong shape or too small", () => {
    expect(checkCreativeDimensions("takeover", 1080, 1080)).toMatch(/9:16/);
    expect(checkCreativeDimensions("takeover", 540, 960)).toMatch(/at least 720/);
    expect(checkCreativeDimensions("banner", 1200, 400)).toMatch(/4:1/);
    expect(checkCreativeDimensions("logo", 120, 120)).toMatch(/at least 200/);
  });
});

describe("campaign view", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("derives live / scheduled / ended from an approved campaign's dates", () => {
    const c = { status: "approved" as const, starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" };
    expect(campaignView(c, now)).toBe("live");
    expect(campaignView({ ...c, starts_at: "2026-10-20T00:00:00Z" }, now)).toBe("scheduled");
    expect(campaignView({ ...c, ends_at: "2026-10-10T00:00:00Z" }, now)).toBe("ended");
    expect(campaignView(c, now, true)).toBe("ended");
    expect(campaignView({ ...c, status: "pending_approval" }, now)).toBe("pending");
    expect(matchesFilter("live", "all")).toBe(true);
    expect(matchesFilter("paused", "live")).toBe(false);
  });
});

describe("campaign form", () => {
  it("parses a good draft", () => {
    const r = parseCampaignForm(form({ ...base, countries: ["ireland", "spain"], regions: "Kerry, Cork" }), { forSubmit: false });
    expect("value" in r && r.value).toMatchObject({
      advertiser_id: 3,
      rate_eur: 450,
      countries: ["ireland", "spain"],
      regions: ["Kerry", "Cork"],
      starts_at: "2026-11-01T00:00:00.000Z",
      headline: null,
    });
  });

  it("drops headline text for the artwork style", () => {
    const r = parseCampaignForm(form({ ...base, headline: "Ignored" }), { forSubmit: false });
    expect("value" in r && r.value.headline).toBeNull();
  });

  it("insists on https links, an end for flat deals, and an end after the start", () => {
    expect(parseCampaignForm(form({ ...base, link_url: "http://example.com" }), { forSubmit: false })).toEqual({ error: expect.stringMatching(/https/) });
    expect(parseCampaignForm(form({ ...base, ends_at: "" }), { forSubmit: false })).toEqual({ error: expect.stringMatching(/end date/) });
    expect(parseCampaignForm(form({ ...base, ends_at: "2026-10-01T00:00" }), { forSubmit: false })).toEqual({ error: expect.stringMatching(/after it starts/) });
  });

  it("asks for the finished pieces only when submitting", () => {
    expect("value" in parseCampaignForm(form(base), { forSubmit: false })).toBe(true);
    expect(parseCampaignForm(form(base), { forSubmit: true })).toEqual({ error: expect.stringMatching(/Upload/) });
    const withImage = { ...base, image_url: "https://x.supabase.co/storage/v1/object/public/ad-creatives/a.jpg" };
    expect(parseCampaignForm(form({ ...withImage, display_style: "photo_headline" }), { forSubmit: true })).toEqual({ error: expect.stringMatching(/headline/) });
    expect(parseCampaignForm(form({ ...withImage, format: "course_partner" }), { forSubmit: true })).toEqual({ error: expect.stringMatching(/course/) });
    expect("value" in parseCampaignForm(form(withImage), { forSubmit: true })).toBe(true);
  });

  it("reads euro amounts", () => {
    expect(parseEuro("1,250.50")).toBe(1250.5);
    expect(parseEuro("€12")).toBe(12);
    expect(parseEuro("12.345")).toBeNull();
    expect(parseEuro("-3")).toBeNull();
    expect(parseUtcInput("2026-10-14T09:00")).toBe("2026-10-14T09:00:00.000Z");
  });

  it("reads and writes the form's times as Irish time", () => {
    // Summer (IST, UTC+1) and winter (GMT, UTC+0).
    expect(parseDublinInput("2026-10-13T21:10")).toBe("2026-10-13T20:10:00.000Z");
    expect(parseDublinInput("2026-12-01T09:00")).toBe("2026-12-01T09:00:00.000Z");
    // Either side of the clocks going back (25 Oct 2026, 02:00 IST -> 01:00 GMT).
    expect(parseDublinInput("2026-10-25T00:30")).toBe("2026-10-24T23:30:00.000Z");
    expect(parseDublinInput("2026-10-25T03:00")).toBe("2026-10-25T03:00:00.000Z");
    expect(parseDublinInput("2026-10-14T09:00Z")).toBe("2026-10-14T09:00:00.000Z");
    expect(parseDublinInput("")).toBeNull();
    expect(parseDublinInput("nonsense")).toBeNull();
    expect(toInputDublin("2026-10-13T20:10:00.000Z")).toBe("2026-10-13T21:10");
    expect(toInputDublin("2026-12-01T09:00:00.000Z")).toBe("2026-12-01T09:00");
    expect(toInputDublin(null)).toBe("");
  });
});

describe("advertiser form", () => {
  it("validates", () => {
    expect(parseAdvertiserForm(form({ name: "Atlantic Golf Travel", email: "sales@atlantic.ie" }))).toMatchObject({ value: { name: "Atlantic Golf Travel" } });
    expect(parseAdvertiserForm(form({ name: "A" }))).toEqual({ error: expect.any(String) });
    expect(parseAdvertiserForm(form({ name: "Atlantic", email: "nope" }))).toEqual({ error: expect.any(String) });
  });
});

describe("changedKeys", () => {
  it("compares arrays, timestamps and numeric strings by value", () => {
    const before = { countries: ["ireland"], club_ids: ["12"], rate_eur: "450.00", starts_at: "2026-11-01T00:00:00+00:00", headline: null };
    const after = { countries: ["ireland"], club_ids: [12], rate_eur: 450, starts_at: "2026-11-01T00:00:00.000Z", headline: null };
    expect(changedKeys(before, after)).toEqual([]);
    expect(changedKeys(before, { ...after, countries: ["ireland", "spain"], rate_eur: 500 })).toEqual(["countries", "rate_eur"]);
  });
});
