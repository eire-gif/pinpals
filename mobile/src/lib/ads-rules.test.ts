import { describe, expect, it } from "vitest";
import {
  adsOf,
  feedAdFor,
  feedAdSlot,
  pickWeighted,
  rowToAd,
  takeoverBlockedAt,
  takeoverDue,
  takeoverFits,
  whyText,
  type AdRow,
} from "./ads-rules";

const row = (over: Partial<AdRow> = {}): AdRow => ({
  id: 7,
  format: "takeover",
  display_style: "artwork",
  countdown_seconds: 5,
  takeover_placement: "app_open",
  image_url: "https://cdn.example.com/a.jpg",
  image_wide_url: null,
  image_square_url: null,
  headline: null,
  body: null,
  button_text: null,
  link_url: "https://example.com",
  advertiser_name: "Algarve Golf",
  advertiser_logo_url: null,
  weight: 1,
  countries: [],
  regions: [],
  takeover_gap_hours: 4,
  ...over,
});

describe("rowToAd", () => {
  it("accepts a complete row and refuses unsafe or incomplete ones", () => {
    expect(rowToAd(row())?.id).toBe(7);
    expect(rowToAd(row({ link_url: "http://example.com" }))).toBeNull();
    expect(rowToAd(row({ link_url: "javascript:alert(1)" }))).toBeNull();
    expect(rowToAd(row({ image_url: null }))).toBeNull();
    expect(rowToAd(row({ format: "popup" }))).toBeNull();
    expect(rowToAd(row({ countdown_seconds: 9 }))?.countdownSeconds).toBe(5);
  });
});

describe("feed slots", () => {
  it("go after the 4th post, then every 12th, never after the last", () => {
    const slots = Array.from({ length: 40 }, (_, i) => feedAdSlot(i, 40));
    expect(slots.map((s, i) => (s == null ? null : i)).filter((i) => i != null)).toEqual([3, 15, 27]);
    expect(feedAdSlot(3, 4)).toBeNull();
    expect(feedAdSlot(15, 40)).toBe(1);
  });

  it("rotate through the adverts and skip hidden ones", () => {
    const a = rowToAd(row({ id: 1, format: "feed" }))!;
    const b = rowToAd(row({ id: 2, format: "feed" }))!;
    const list = adsOf([a, b, rowToAd(row({ id: 3 }))!], "feed", new Set([2]));
    expect(list.map((x) => x.id)).toEqual([1]);
    expect(feedAdFor([a, b], 0)?.id).toBe(1);
    expect(feedAdFor([a, b], 1)?.id).toBe(2);
    expect(feedAdFor([], 0)).toBeNull();
  });
});

describe("pickWeighted", () => {
  it("chooses in proportion to weight", () => {
    const items = [{ id: "a", weight: 1 }, { id: "b", weight: 3 }];
    expect(pickWeighted(items, 0)?.id).toBe("a");
    expect(pickWeighted(items, 0.24)?.id).toBe("a");
    expect(pickWeighted(items, 0.26)?.id).toBe("b");
    expect(pickWeighted(items, 0.99)?.id).toBe("b");
    expect(pickWeighted([], 0.5)).toBeNull();
  });
});

describe("takeover rules", () => {
  it("never covers live scoring, the hole map, checkout or onboarding", () => {
    expect(takeoverBlockedAt(["(tabs)"])).toBe(false);
    expect(takeoverBlockedAt(["(tabs)", "feed"])).toBe(false);
    expect(takeoverBlockedAt(["(tabs)", "live", "round", "[id]"])).toBe(true);
    expect(takeoverBlockedAt(["hole-map"])).toBe(true);
    expect(takeoverBlockedAt(["checkout"])).toBe(true);
    expect(takeoverBlockedAt(["web"])).toBe(true);
    expect(takeoverBlockedAt(["onboarding", "game"])).toBe(true);
    expect(takeoverBlockedAt(["scorecards", "new"])).toBe(true);
    expect(takeoverBlockedAt([])).toBe(true);
  });

  it("matches its placement and honours the gap", () => {
    const open = rowToAd(row())!;
    const both = rowToAd(row({ takeover_placement: "both" }))!;
    expect(takeoverFits(open, "app_open")).toBe(true);
    expect(takeoverFits(open, "after_round")).toBe(false);
    expect(takeoverFits(both, "after_round")).toBe(true);
    const now = Date.UTC(2026, 9, 13, 12);
    expect(takeoverDue(null, 4, now)).toBe(true);
    expect(takeoverDue(now - 3 * 3_600_000, 4, now)).toBe(false);
    expect(takeoverDue(now - 4 * 3_600_000, 4, now)).toBe(true);
  });
});

describe("why am I seeing this", () => {
  it("names the place the advert targets", () => {
    const me = { countryName: "Ireland", county: "Kerry" };
    expect(whyText({ countries: ["ireland"], regions: ["Kerry"] }, me)).toBe("Shown to golfers in Kerry. PinPals doesn't track you across other apps.");
    expect(whyText({ countries: ["ireland"], regions: [] }, me)).toMatch(/^Shown to golfers in Ireland\./);
    expect(whyText({ countries: [], regions: [] }, me)).toMatch(/^Shown to all PinPals golfers\./);
  });
});
