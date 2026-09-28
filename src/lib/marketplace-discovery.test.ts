import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseMarketplaceFilters,
  marketplaceFiltersToSearchParams,
  sanitizeSearchTerm,
  encodeMarketplaceCursor,
  decodeMarketplaceCursor,
  fetchMarketplaceListings,
  decodeMarketplaceCursor as decodeCursor,
  EMPTY_MARKETPLACE_FILTERS,
  RESULTS_PAGE_SIZE,
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

describe("brand filters", () => {
  it("accepts repeated and comma-joined brand params alike", () => {
    expect(parseMarketplaceFilters({ brand: ["taylormade", "ping"] }).brands).toEqual(["ping", "taylormade"]);
    expect(parseMarketplaceFilters({ brand: "taylormade,ping" }).brands).toEqual(["ping", "taylormade"]);
  });

  it("sorts and deduplicates, so the same selection is always the same URL", () => {
    expect(parseMarketplaceFilters({ brand: ["ping", "taylormade", "ping"] }).brands).toEqual([
      "ping",
      "taylormade",
    ]);
  });

  it("drops brands that don't exist", () => {
    expect(parseMarketplaceFilters({ brand: ["taylormade", "not-a-brand"] }).brands).toEqual(["taylormade"]);
  });

  it("drops a brand that doesn't belong to the chosen category", () => {
    // A stale shared link should degrade to a plain category browse, not a
    // guaranteed-empty result set.
    const filters = parseMarketplaceFilters({ category: "Putters", brand: ["motocaddy", "odyssey"] });
    expect(filters.brands).toEqual(["odyssey"]);
  });

  it("drops a brand that doesn't belong to the chosen subcategory", () => {
    const filters = parseMarketplaceFilters({
      category: "Balls & accessories",
      subcategory: "Golf balls",
      brand: ["bushnell", "titleist"],
    });
    expect(filters.brands).toEqual(["titleist"]);
  });

  it("keeps a category-less brand filter, since there's no category to contradict", () => {
    expect(parseMarketplaceFilters({ brand: "motocaddy" }).brands).toEqual(["motocaddy"]);
  });

  it("round-trips through the query string as repeated keys", () => {
    const filters = parseMarketplaceFilters({ category: "Irons", brand: ["mizuno", "srixon"] });
    const params = marketplaceFiltersToSearchParams(filters);
    expect(params.getAll("brand")).toEqual(["mizuno", "srixon"]);
    expect(parseMarketplaceFilters(Object.fromEntries([["category", "Irons"], ["brand", params.getAll("brand")]]))).toEqual(
      filters
    );
  });

  it("leaves no brand key in the URL when nothing is selected", () => {
    const params = marketplaceFiltersToSearchParams(EMPTY_MARKETPLACE_FILTERS);
    expect(params.has("brand")).toBe(false);
  });
});


/**
 * Paging.
 *
 * These exist because it was broken and nothing noticed. `p_limit` was passed
 * unincremented while `hasMore` tested `rows.length > limit` — which the SQL's
 * own `limit v_limit` makes unsatisfiable. nextCursor was always null, the
 * Load more button never rendered, and the marketplace stopped at the first
 * 24 listings however many were for sale.
 *
 * The stub is the thinnest thing that can answer the question: how many rows
 * did we ask for, and what did we do with what came back.
 */
describe("fetchMarketplaceListings paging", () => {
  function stub(rowCount: number) {
    const calls: Record<string, unknown>[] = [];
    const rows = Array.from({ length: rowCount }, (_, i) => ({
      id: 1000 - i,
      sale_type: "fixed_price",
      created_at: `2026-09-${String(28 - i).padStart(2, "0")}T10:00:00Z`,
      price_cents: 10_000 + i,
    }));

    const client = {
      rpc: (_name: string, args: Record<string, unknown>) => {
        calls.push(args);
        return Promise.resolve({ data: rows, error: null });
      },
      from: () => ({
        select: () => ({
          in: () => Promise.resolve({ data: [] }),
          eq: () => ({ in: () => Promise.resolve({ data: [] }) }),
        }),
      }),
    } as unknown as SupabaseClient;

    return { client, calls };
  }

  it("asks the database for one row more than it intends to show", async () => {
    const { client, calls } = stub(3);
    await fetchMarketplaceListings(client, EMPTY_MARKETPLACE_FILTERS, null, null, 10);
    expect(calls[0].p_limit).toBe(11);
  });

  it("returns a cursor when there is another page, and trims the extra row", async () => {
    // 11 rows back for a page of 10: one page plus the probe.
    const { client } = stub(11);
    const result = await fetchMarketplaceListings(client, EMPTY_MARKETPLACE_FILTERS, null, null, 10);

    expect(result.listings).toHaveLength(10);
    expect(result.nextCursor).not.toBeNull();

    // The cursor points at the last row SHOWN, not the probe row.
    const cursor = decodeCursor(result.nextCursor!, "newest");
    expect(cursor?.id).toBe(result.listings[9].id);
  });

  it("returns no cursor on the last page", async () => {
    const { client } = stub(4);
    const result = await fetchMarketplaceListings(client, EMPTY_MARKETPLACE_FILTERS, null, null, 10);
    expect(result.listings).toHaveLength(4);
    expect(result.nextCursor).toBeNull();
  });

  it("returns no cursor when the page is exactly full and nothing follows", async () => {
    const { client } = stub(10);
    const result = await fetchMarketplaceListings(client, EMPTY_MARKETPLACE_FILTERS, null, null, 10);
    expect(result.listings).toHaveLength(10);
    expect(result.nextCursor).toBeNull();
  });

  it("defaults to the page size the marketplace actually uses", async () => {
    const { client, calls } = stub(1);
    await fetchMarketplaceListings(client, EMPTY_MARKETPLACE_FILTERS, null, null);
    expect(calls[0].p_limit).toBe(RESULTS_PAGE_SIZE + 1);
  });
});
