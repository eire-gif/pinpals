import { describe, expect, it } from "vitest";
import {
  MOCK_LISTINGS,
  getMockListingBySlug,
  listMockListings,
  listMockListingsBySeller,
} from "./marketplace-fixtures";

describe("listMockListings", () => {
  it("returns every listing, newest first, with no filters", () => {
    const result = listMockListings();
    expect(result).toHaveLength(MOCK_LISTINGS.length);
    for (let i = 1; i < result.length; i++) {
      expect(new Date(result[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(result[i].createdAt).getTime()
      );
    }
  });

  it("filters by category", () => {
    const result = listMockListings({ category: "Putters" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((l) => l.category === "Putters")).toBe(true);
  });

  it("filters by county", () => {
    const result = listMockListings({ county: "Kerry" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((l) => l.county === "Kerry")).toBe(true);
  });

  it("matches search text against title and description, case-insensitively", () => {
    const result = listMockListings({ q: "PUTTER" });
    expect(result.length).toBeGreaterThan(0);
    expect(
      result.every(
        (l) => l.title.toLowerCase().includes("putter") || l.description.toLowerCase().includes("putter")
      )
    ).toBe(true);
  });

  it("returns an empty array when nothing matches", () => {
    expect(listMockListings({ q: "definitely-not-a-real-listing" })).toEqual([]);
  });

  it("sorts by price ascending and descending", () => {
    const low = listMockListings({ sort: "price_low" });
    const high = listMockListings({ sort: "price_high" });
    for (let i = 1; i < low.length; i++) {
      expect(low[i - 1].priceEur).toBeLessThanOrEqual(low[i].priceEur);
    }
    for (let i = 1; i < high.length; i++) {
      expect(high[i - 1].priceEur).toBeGreaterThanOrEqual(high[i].priceEur);
    }
  });

  it("combines filters", () => {
    const result = listMockListings({ category: "Wedges", county: "Kerry" });
    expect(result.every((l) => l.category === "Wedges" && l.county === "Kerry")).toBe(true);
  });
});

describe("getMockListingBySlug", () => {
  it("finds a listing by its exact slug", () => {
    const first = MOCK_LISTINGS[0];
    expect(getMockListingBySlug(first.slug)?.id).toBe(first.id);
  });

  it("returns undefined for an unknown slug", () => {
    expect(getMockListingBySlug("not-a-real-slug")).toBeUndefined();
  });
});

describe("listMockListingsBySeller", () => {
  it("excludes the listing being viewed", () => {
    const listing = MOCK_LISTINGS[0];
    const others = listMockListingsBySeller(listing.seller.name, listing.slug);
    expect(others.some((l) => l.slug === listing.slug)).toBe(false);
  });

  it("only returns listings from the named seller", () => {
    const listing = MOCK_LISTINGS[0];
    const others = listMockListingsBySeller(listing.seller.name, listing.slug);
    expect(others.every((l) => l.seller.name === listing.seller.name)).toBe(true);
  });
});
