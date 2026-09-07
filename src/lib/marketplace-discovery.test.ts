import { describe, expect, it } from "vitest";
import {
  parseMarketplaceFilters,
  marketplaceFiltersToSearchParams,
  sanitizeSearchTerm,
  encodeMarketplaceCursor,
  decodeMarketplaceCursor,
  EMPTY_MARKETPLACE_FILTERS,
} from "./marketplace-discovery";

describe("parseMarketplaceFilters", () => {
  it("defaults to an empty filter set with 'newest' sort", () => {
    expect(parseMarketplaceFilters({})).toEqual(EMPTY_MARKETPLACE_FILTERS);
  });

  it("accepts a valid category/county/condition/saleType/delivery/sort combination", () => {
    const filters = parseMarketplaceFilters({
      category: "Drivers",
      county: "Cork",
      condition: "Good",
      saleType: "auction",
      delivery: "post",
      sort: "price_low",
    });
    expect(filters.category).toBe("Drivers");
    expect(filters.county).toBe("Cork");
    expect(filters.condition).toBe("Good");
    expect(filters.saleType).toBe("auction");
    expect(filters.delivery).toBe("post");
    expect(filters.sort).toBe("price_low");
  });

  it("drops values outside the closed vocabularies rather than trusting them", () => {
    const filters = parseMarketplaceFilters({
      category: "Fishing rods",
      county: "Narnia",
      condition: "Mint",
      saleType: "steal_it",
      delivery: "teleport",
      sort: "cheapest_first",
    });
    expect(filters).toEqual(EMPTY_MARKETPLACE_FILTERS);
  });

  it("only keeps a subcategory that belongs to the selected category", () => {
    const matching = parseMarketplaceFilters({ category: "Drivers", subcategory: "Left-handed" });
    expect(matching.subcategory).toBe("Left-handed");

    // "Blade" is a Putters subcategory, not a Drivers one.
    const mismatched = parseMarketplaceFilters({ category: "Drivers", subcategory: "Blade" });
    expect(mismatched.subcategory).toBe("");

    // No valid category at all -> subcategory can never survive either.
    const orphaned = parseMarketplaceFilters({ subcategory: "Blade" });
    expect(orphaned.subcategory).toBe("");
  });

  it("parses min/max price into integer cents", () => {
    const filters = parseMarketplaceFilters({ minPrice: "10", maxPrice: "99.5" });
    expect(filters.minPriceCents).toBe(1000);
    expect(filters.maxPriceCents).toBe(9950);
  });

  it("ignores a garbage price rather than throwing", () => {
    const filters = parseMarketplaceFilters({ minPrice: "banana", maxPrice: "-5" });
    expect(filters.minPriceCents).toBeNull();
    expect(filters.maxPriceCents).toBeNull();
  });

  it("swaps min/max when max is lower than min", () => {
    const filters = parseMarketplaceFilters({ minPrice: "100", maxPrice: "20" });
    expect(filters.minPriceCents).toBe(2000);
    expect(filters.maxPriceCents).toBe(10000);
  });

  it("takes the first value when a param repeats", () => {
    const filters = parseMarketplaceFilters({ category: ["Drivers", "Irons"] });
    expect(filters.category).toBe("Drivers");
  });

  it("truncates a very long search string", () => {
    const filters = parseMarketplaceFilters({ q: "a".repeat(500) });
    expect(filters.q).toHaveLength(100);
  });
});

describe("marketplaceFiltersToSearchParams", () => {
  it("produces an empty query string for the default filter set", () => {
    expect(marketplaceFiltersToSearchParams(EMPTY_MARKETPLACE_FILTERS).toString()).toBe("");
  });

  it("round-trips through parseMarketplaceFilters", () => {
    const filters = parseMarketplaceFilters({
      q: "driver",
      category: "Drivers",
      subcategory: "Left-handed",
      county: "Cork",
      condition: "Good",
      saleType: "auction",
      delivery: "post",
      minPrice: "10",
      maxPrice: "200",
      sort: "price_high",
    });
    const params = marketplaceFiltersToSearchParams(filters);
    const roundTripped = parseMarketplaceFilters(Object.fromEntries(params.entries()));
    expect(roundTripped).toEqual(filters);
  });

  it("omits 'newest' since it's the default sort", () => {
    const filters = parseMarketplaceFilters({ sort: "newest" });
    expect(marketplaceFiltersToSearchParams(filters).has("sort")).toBe(false);
  });
});

describe("sanitizeSearchTerm", () => {
  it("strips ILIKE wildcard characters", () => {
    expect(sanitizeSearchTerm("50%_off")).toBe("50off");
  });

  it("keeps plain words and hyphens/apostrophes", () => {
    expect(sanitizeSearchTerm("  Ping G430  ")).toBe("Ping G430");
  });
});

describe("marketplace cursor", () => {
  it("round-trips through encode/decode for the matching sort", () => {
    const cursor = { sort: "newest" as const, id: 42, createdAt: "2026-01-01T00:00:00.000Z", priceCents: null };
    const encoded = encodeMarketplaceCursor(cursor);
    expect(decodeMarketplaceCursor(encoded, "newest")).toEqual(cursor);
  });

  it("refuses a cursor encoded for a different sort", () => {
    const encoded = encodeMarketplaceCursor({ sort: "newest", id: 1, createdAt: null, priceCents: null });
    expect(decodeMarketplaceCursor(encoded, "price_low")).toBeNull();
  });

  it("treats a missing cursor as 'no cursor', not an error", () => {
    expect(decodeMarketplaceCursor(undefined, "newest")).toBeNull();
  });

  it("treats a malformed cursor as 'no cursor', not an error", () => {
    expect(decodeMarketplaceCursor("not-valid-base64url-json", "newest")).toBeNull();
  });
});
