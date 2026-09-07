import type { SupabaseClient } from "@supabase/supabase-js";
import type { Listing, Auction, Bid } from "./types";
import { CATEGORIES, SUBCATEGORIES, CONDITIONS, SALE_TYPES, DELIVERY_OPTIONS } from "./marketplace";
import { COUNTIES } from "./clubs";

// ============ sort ============

export const MARKETPLACE_SORTS = ["newest", "price_low", "price_high"] as const;
export type MarketplaceSort = (typeof MARKETPLACE_SORTS)[number];

function isMarketplaceSort(value: string): value is MarketplaceSort {
  return (MARKETPLACE_SORTS as readonly string[]).includes(value);
}

export const MARKETPLACE_SORT_LABELS: Record<MarketplaceSort, string> = {
  newest: "Newest first",
  price_low: "Price: low to high",
  price_high: "Price: high to low",
};

/** One page of the marketplace grid. 24 divides evenly into the 2/3/4-column
 * responsive grid (src/app/marketplace/page.tsx) with no ragged last row at
 * any breakpoint. */
export const RESULTS_PAGE_SIZE = 24;

// ============ filters ============
// Everything the /marketplace page can filter or sort on, already validated
// against this app's closed vocabularies (CATEGORIES, COUNTIES, ...) — a
// stray/tampered query string (?category=drop-table) just gets dropped back
// to "no filter" rather than reaching the database. `location`/`radius`
// (this phase's spec: "location/radius if supported") is deliberately just
// `county` — there's no geocoded lat/lng anywhere in this schema (COUNTIES
// in src/lib/clubs.ts is a flat name list), so a true radius search isn't
// something this phase can honestly build; exact-match county is the
// supported subset.

export type MarketplaceFilters = {
  q: string;
  category: string;
  subcategory: string;
  county: string;
  condition: string;
  saleType: string;
  delivery: string;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  sort: MarketplaceSort;
};

export const EMPTY_MARKETPLACE_FILTERS: MarketplaceFilters = {
  q: "",
  category: "",
  subcategory: "",
  county: "",
  condition: "",
  saleType: "",
  delivery: "",
  minPriceCents: null,
  maxPriceCents: null,
  sort: "newest",
};

function firstValue(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

/** Parses a non-negative euro amount from a raw query-string value into
 * integer cents, or `null` if it's absent/blank/not a sane positive number.
 * Never throws — a garbled `?minPrice=banana` just behaves like no filter. */
function parsePriceCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const eur = Number(trimmed);
  if (!Number.isFinite(eur) || eur < 0) return null;
  return Math.round(eur * 100);
}

/**
 * Query string (Next's `searchParams`, already resolved) -> validated
 * filters. This is the one place that decides what counts as a legal
 * category/county/condition/sale type/sort — every call site (the server
 * page, marketplace-controls.tsx's own client-side echo of the current
 * state) goes through it, so the URL is always the single source of truth
 * and can never drift into an unvalidated value slipping through to the DB.
 */
export function parseMarketplaceFilters(
  raw: Record<string, string | string[] | undefined>
): MarketplaceFilters {
  const category = firstValue(raw.category);
  const subcategory = firstValue(raw.subcategory);
  const validCategory = (CATEGORIES as readonly string[]).includes(category) ? category : "";
  // A subcategory only makes sense paired with the category it belongs to —
  // if the category was dropped (invalid, or since changed) or the
  // subcategory isn't one of that category's own values, drop it too rather
  // than silently filtering on an orphaned subcategory from a stale URL.
  const validSubcategory =
    validCategory && (SUBCATEGORIES[validCategory as keyof typeof SUBCATEGORIES] as readonly string[])?.includes(subcategory)
      ? subcategory
      : "";

  const county = firstValue(raw.county);
  const condition = firstValue(raw.condition);
  const saleType = firstValue(raw.saleType);
  const delivery = firstValue(raw.delivery);
  const sort = firstValue(raw.sort);

  const minPriceCents = parsePriceCents(firstValue(raw.minPrice));
  const maxPriceCentsRaw = parsePriceCents(firstValue(raw.maxPrice));
  // A user who types a lower "max" than "min" almost certainly just hasn't
  // finished editing yet, not asked for an impossible range — swap rather
  // than silently returning zero results.
  const swap = minPriceCents !== null && maxPriceCentsRaw !== null && maxPriceCentsRaw < minPriceCents;

  return {
    q: firstValue(raw.q).trim().slice(0, 100),
    category: validCategory,
    subcategory: validSubcategory,
    county: (COUNTIES as readonly string[]).includes(county) ? county : "",
    condition: (CONDITIONS as readonly string[]).includes(condition) ? condition : "",
    saleType: (SALE_TYPES as readonly string[]).includes(saleType) ? saleType : "",
    delivery: (DELIVERY_OPTIONS as readonly string[]).includes(delivery) ? delivery : "",
    minPriceCents: swap ? maxPriceCentsRaw : minPriceCents,
    maxPriceCents: swap ? minPriceCents : maxPriceCentsRaw,
    sort: isMarketplaceSort(sort) ? sort : "newest",
  };
}

/** The inverse of parsing — filters -> a URLSearchParams a caller can turn
 * into an href/query string. Drops every empty/default field so the URL
 * stays clean (no `?category=&sort=newest` noise) — shareable links only
 * carry the filters actually in effect. */
export function marketplaceFiltersToSearchParams(filters: MarketplaceFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.subcategory) params.set("subcategory", filters.subcategory);
  if (filters.county) params.set("county", filters.county);
  if (filters.condition) params.set("condition", filters.condition);
  if (filters.saleType) params.set("saleType", filters.saleType);
  if (filters.delivery) params.set("delivery", filters.delivery);
  if (filters.minPriceCents !== null) params.set("minPrice", String(filters.minPriceCents / 100));
  if (filters.maxPriceCents !== null) params.set("maxPrice", String(filters.maxPriceCents / 100));
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  return params;
}

// ============ search term sanitizing ============
// Same rationale and character class as sanitizeSearchTerm() in
// src/lib/admin/queries.ts (kept as its own small copy rather than a shared
// import — see SELLER_LISTING_STATUS_LABELS in src/lib/format.ts for the
// precedent on why this codebase duplicates a small piece of vocabulary
// rather than reach across the admin/public boundary for it). The RPC
// parameter itself is a bound value, not string-interpolated SQL, so this
// isn't load-bearing for injection safety here — it's purely so a search
// box full of ILIKE wildcards (`%`, `_`) behaves like plain text instead of
// a pattern.
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .trim()
    .slice(0, 100);
}

// ============ cursor ============
// Opaque to the client — just base64url(JSON). Scoped to the sort it was
// produced under (decodeMarketplaceCursor refuses to honour a cursor from a
// different sort) so switching "Newest" -> "Price: low to high" mid-scroll
// can never mix keyset positions from two different orderings.

export type MarketplaceCursor = {
  sort: MarketplaceSort;
  id: number;
  createdAt: string | null;
  priceCents: number | null;
};

export function encodeMarketplaceCursor(cursor: MarketplaceCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** `null` for anything that doesn't decode cleanly into a same-sort cursor —
 * a malformed or stale `?cursor=` is always treated as "start from the
 * first page" rather than surfaced as an error. */
export function decodeMarketplaceCursor(raw: string | undefined, sort: MarketplaceSort): MarketplaceCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.sort === sort &&
      Number.isFinite(parsed.id) &&
      (parsed.createdAt === null || typeof parsed.createdAt === "string") &&
      (parsed.priceCents === null || Number.isFinite(parsed.priceCents))
    ) {
      return {
        sort,
        id: parsed.id,
        createdAt: parsed.createdAt,
        priceCents: parsed.priceCents,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ============ fetching ============

/** A listing plus everything its marketplace card needs beyond the bare
 * `listings` row — batched per page, never per card (see fetchMarketplaceListings). */
export type MarketplaceListing = Listing & {
  auction: Auction | null;
  /** The current highest bid, in cents — or the auction's starting price
   * when nobody's bid yet. `null` for a non-auction listing. */
  currentBidCents: number | null;
  isFavourited: boolean;
};

export type MarketplaceSearchResult = {
  listings: MarketplaceListing[];
  nextCursor: string | null;
};

/**
 * The one function that turns (filters, cursor, viewer) into a page of
 * enriched marketplace listings. Always exactly 4 queries regardless of how
 * many listings come back — the search RPC itself, plus three batched
 * lookups (auctions, their current-winning bids, and the viewer's
 * favourites) scoped to just the listing ids on this page — never one query
 * per card. Throws on a genuine database error (caught by
 * src/app/marketplace/error.tsx); an empty result set is not an error.
 */
export async function fetchMarketplaceListings(
  supabase: SupabaseClient,
  filters: MarketplaceFilters,
  cursor: MarketplaceCursor | null,
  userId: string | null,
  limit: number = RESULTS_PAGE_SIZE
): Promise<MarketplaceSearchResult> {
  const term = filters.q ? sanitizeSearchTerm(filters.q) : "";

  const { data, error } = await supabase.rpc("search_marketplace_listings", {
    p_query: term || null,
    p_category: filters.category || null,
    p_subcategory: filters.subcategory || null,
    p_county: filters.county || null,
    p_condition: filters.condition || null,
    p_sale_type: filters.saleType || null,
    p_delivery: filters.delivery || null,
    p_min_price_cents: filters.minPriceCents,
    p_max_price_cents: filters.maxPriceCents,
    p_sort: filters.sort,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_price_cents: cursor?.priceCents ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: limit,
  });

  if (error) {
    throw new Error(`Couldn't load marketplace listings: ${error.message}`);
  }

  const rows = (data ?? []) as Listing[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const listingIds = page.map((l) => l.id);

  const auctionListingIds = page
    .filter((l) => l.sale_type === "auction" || l.sale_type === "auction_with_buy_now")
    .map((l) => l.id);

  const [auctionsResult, favouritesResult] = await Promise.all([
    auctionListingIds.length
      ? supabase.from("auctions").select("*").in("listing_id", auctionListingIds).returns<Auction[]>()
      : Promise.resolve({ data: [] as Auction[] }),
    userId && listingIds.length
      ? supabase.from("listing_favourites").select("listing_id").eq("user_id", userId).in("listing_id", listingIds)
      : Promise.resolve({ data: [] as { listing_id: number }[] }),
  ]);

  const auctions = auctionsResult.data ?? [];
  const auctionByListingId = new Map(auctions.map((a) => [a.listing_id, a]));

  const winningBidIds = auctions.map((a) => a.winning_bid_id).filter((id): id is number => id !== null);
  const { data: winningBids } = winningBidIds.length
    ? await supabase.from("bids").select("id, amount_cents").in("id", winningBidIds).returns<Pick<Bid, "id" | "amount_cents">[]>()
    : { data: [] as Pick<Bid, "id" | "amount_cents">[] };
  const bidAmountById = new Map((winningBids ?? []).map((b) => [b.id, b.amount_cents]));

  const favouritedIds = new Set((favouritesResult.data ?? []).map((f) => f.listing_id));

  const listings: MarketplaceListing[] = page.map((listing) => {
    const auction = auctionByListingId.get(listing.id) ?? null;
    const currentBidCents = auction
      ? (auction.winning_bid_id !== null ? bidAmountById.get(auction.winning_bid_id) : undefined) ?? auction.starting_price_cents
      : null;
    return {
      ...listing,
      auction,
      currentBidCents,
      isFavourited: favouritedIds.has(listing.id),
    };
  });

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = page[page.length - 1];
    nextCursor = encodeMarketplaceCursor({
      sort: filters.sort,
      id: last.id,
      createdAt: last.created_at,
      priceCents: last.price_cents,
    });
  }

  return { listings, nextCursor };
}
