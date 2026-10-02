import { supabase } from "./supabase";

/**
 * Browsing the marketplace, natively.
 *
 * Reads only, and all of them straight to Supabase. `search_marketplace_listings`
 * (0060) is a plain STABLE function granted to anon and authenticated — not
 * security definer — so RLS decides what comes back exactly as it does for the
 * website, and the app is running the same search rather than a second
 * implementation of it.
 *
 * The one write here is a favourite, which is a row with the member's own id
 * on it and a single FOR ALL policy behind it (0037). Nothing notifies.
 *
 * Money stays on the website. Buy now needs Stripe Checkout, which needs a
 * real browser; offers and bids have state machines, reservation timers and
 * notifications attached, and a second implementation of any of that is how
 * two systems start disagreeing about who owns a club. The detail screen
 * hands those three actions to the web view and does everything else itself.
 */

// ---------------------------------------------------------------------------
// Vocabulary — mirrored from src/lib/marketplace-discovery.ts
// ---------------------------------------------------------------------------

export const MARKETPLACE_SORTS = ["newest", "price_low", "price_high"] as const;

export type MarketplaceSort = (typeof MARKETPLACE_SORTS)[number];

export const MARKETPLACE_SORT_LABELS: Record<MarketplaceSort, string> = {
  newest: "Newest",
  price_low: "Price: low first",
  price_high: "Price: high first",
};

/** All four, unlike listing CREATION which offers only the two that need no
 *  dates. A member can browse an auction they could not have posted here. */
export const FILTER_SALE_TYPES = [
  { value: "fixed_price", label: "Fixed price" },
  { value: "offers_allowed", label: "Open to offers" },
  { value: "auction", label: "Auction" },
  { value: "auction_with_buy_now", label: "Auction + buy now" },
] as const;

export const SALE_TYPE_LABELS: Record<string, string> = {
  fixed_price: "Fixed price",
  offers_allowed: "Open to offers",
  auction: "Auction",
  auction_with_buy_now: "Auction",
};

export const isAuction = (saleType: string): boolean =>
  saleType === "auction" || saleType === "auction_with_buy_now";

export type Filters = {
  q: string;
  category: string;
  subcategory: string;
  brands: string[];
  county: string;
  condition: string;
  saleType: string;
  delivery: string;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  sort: MarketplaceSort;
};

export const EMPTY_FILTERS: Filters = {
  q: "",
  category: "",
  subcategory: "",
  brands: [],
  county: "",
  condition: "",
  saleType: "",
  delivery: "",
  minPriceCents: null,
  maxPriceCents: null,
  sort: "newest",
};

/** How many of the chips are doing something, for the badge on the Filter
 *  button. Sort is excluded: it always has a value, so counting it would mean
 *  the badge never read zero. */
export function activeFilterCount(filters: Filters): number {
  return (
    (filters.category ? 1 : 0) +
    (filters.subcategory ? 1 : 0) +
    filters.brands.length +
    (filters.county ? 1 : 0) +
    (filters.condition ? 1 : 0) +
    (filters.saleType ? 1 : 0) +
    (filters.delivery ? 1 : 0) +
    (filters.minPriceCents !== null || filters.maxPriceCents !== null ? 1 : 0)
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type Card = {
  id: number;
  title: string;
  priceCents: number | null;
  imageUrl: string | null;
  county: string | null;
  condition: string;
  saleType: string;
  brand: string | null;
  model: string | null;
  createdAt: string;
  isFavourited: boolean;
  /** The live high bid on an auction, or its starting price before anyone
   *  bids. Null for everything that is not an auction. */
  currentBidCents: number | null;
};

/**
 * The keyset cursor, as three plain values.
 *
 * The website packs these into a base64url string because they have to
 * survive a URL. Here they do not — the app calls the function directly — and
 * encodeMarketplaceCursor() uses Buffer, which is a Node global that does not
 * exist in React Native. Passing the columns straight through avoids
 * polyfilling something to solve a problem the app does not have.
 */
export type Cursor = { createdAt: string | null; priceCents: number | null; id: number };

export type Page = { cards: Card[]; cursor: Cursor | null };

/** Matches the website's RESULTS_PAGE_SIZE. The SQL caps any request at 60. */
export const PAGE_SIZE = 24;

type ListingRow = {
  id: number;
  title: string;
  price_cents: number | null;
  image_url: string | null;
  county: string | null;
  condition: string;
  sale_type: string;
  brand: string | null;
  model: string | null;
  created_at: string;
};

/** Anything not a letter, number, space, apostrophe or hyphen. The same
 *  narrowing sanitizeSearchTerm() does, so the two searches behave alike. */
const cleanTerm = (raw: string): string =>
  raw.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100);

export async function searchListings(
  filters: Filters,
  cursor: Cursor | null,
  userId: string | null,
  /** The feed asks for a few at a time; the marketplace for a page. */
  pageSize: number = PAGE_SIZE
): Promise<Page> {
  const term = cleanTerm(filters.q);

  const { data, error } = await supabase.rpc("search_marketplace_listings", {
    p_query: term || null,
    p_category: filters.category || null,
    p_subcategory: filters.subcategory || null,
    p_brands: filters.brands.length > 0 ? filters.brands : null,
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
    // One more than we show, so "is there another page" is answered by the
    // database rather than guessed. See the note on the website's own
    // fetchMarketplaceListings, where getting this wrong meant the Load more
    // button never appeared at all.
    p_limit: pageSize + 1,
  });

  if (error) throw new Error("Couldn't load the marketplace. Pull down to try again.");

  const rows = (data ?? []) as ListingRow[];
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  const [favourites, bids] = await Promise.all([
    favouritedIds(page.map((row) => row.id), userId),
    auctionPrices(page),
  ]);

  const cards: Card[] = page.map((row) => ({
    id: row.id,
    title: row.title,
    priceCents: row.price_cents,
    imageUrl: row.image_url,
    county: row.county,
    condition: row.condition,
    saleType: row.sale_type,
    brand: row.brand,
    model: row.model,
    createdAt: row.created_at,
    isFavourited: favourites.has(row.id),
    currentBidCents: bids.get(row.id) ?? null,
  }));

  const last = page[page.length - 1];

  return {
    cards,
    cursor:
      hasMore && last
        ? { createdAt: last.created_at, priceCents: last.price_cents, id: last.id }
        : null,
  };
}

async function favouritedIds(
  listingIds: number[],
  userId: string | null
): Promise<Set<number>> {
  if (!userId || listingIds.length === 0) return new Set();
  const { data } = await supabase
    .from("listing_favourites")
    .select("listing_id")
    .eq("user_id", userId)
    .in("listing_id", listingIds)
    .overrideTypes<{ listing_id: number }[]>();
  return new Set((data ?? []).map((row) => row.listing_id));
}

/**
 * The current price on each auction in the page, keyed by LISTING id.
 *
 * Read from `auction_bid_history` (0045), not `bids`. `bids` has no SELECT
 * policy broad enough for a third party, so querying it would come back empty
 * for everyone except the bidder and the seller — and a card would quietly
 * understate the price to every other member looking at it. The view exposes
 * the amount and the auction, never who bid.
 */
async function auctionPrices(rows: ListingRow[]): Promise<Map<number, number>> {
  const listingIds = rows.filter((row) => isAuction(row.sale_type)).map((row) => row.id);
  if (listingIds.length === 0) return new Map();

  const { data: auctions } = await supabase
    .from("auctions")
    .select("id, listing_id, starting_price_cents")
    .in("listing_id", listingIds)
    .overrideTypes<{ id: number; listing_id: number; starting_price_cents: number }[]>();

  const rowsBack = auctions ?? [];
  if (rowsBack.length === 0) return new Map();

  const { data: history } = await supabase
    .from("auction_bid_history")
    .select("auction_id, amount_cents")
    .in("auction_id", rowsBack.map((a) => a.id))
    .overrideTypes<{ auction_id: number; amount_cents: number }[]>();

  const topByAuction = new Map<number, number>();
  for (const bid of history ?? []) {
    const current = topByAuction.get(bid.auction_id);
    if (current === undefined || bid.amount_cents > current) {
      topByAuction.set(bid.auction_id, bid.amount_cents);
    }
  }

  return new Map(
    rowsBack.map((auction) => [
      auction.listing_id,
      topByAuction.get(auction.id) ?? auction.starting_price_cents,
    ])
  );
}

// ---------------------------------------------------------------------------
// One listing
// ---------------------------------------------------------------------------

export type Seller = {
  id: string;
  name: string;
  homeClub: string | null;
  county: string | null;
  avatarColor: string | null;
  memberSince: string;
  rating: number | null;
  reviewCount: number;
};

export type ListingDetail = {
  id: number;
  title: string;
  description: string | null;
  priceCents: number | null;
  status: string;
  saleType: string;
  category: string;
  subcategory: string | null;
  condition: string;
  county: string | null;
  brand: string | null;
  brandOther: string | null;
  model: string | null;
  deliveryOptions: string[];
  collectionNotes: string | null;
  specs: { label: string; value: string }[];
  images: string[];
  seller: Seller | null;
  isMine: boolean;
  isFavourited: boolean;
  currentBidCents: number | null;
  auctionEndsAt: string | null;
};

const SPEC_LABELS: Record<string, string> = {
  dexterity: "Dexterity",
  shaft_flex: "Shaft flex",
  shaft_material: "Shaft",
  loft: "Loft",
  item_size: "Size",
};

type DetailRow = {
  id: number;
  seller_id: string;
  title: string;
  description: string | null;
  price_cents: number | null;
  status: string;
  sale_type: string;
  category: string;
  subcategory: string | null;
  condition: string;
  county: string | null;
  image_url: string | null;
  brand: string | null;
  brand_other: string | null;
  model: string | null;
  delivery_options: string[] | null;
  collection_notes: string | null;
  dexterity: string | null;
  shaft_flex: string | null;
  shaft_material: string | null;
  loft: string | null;
  item_size: string | null;
};

/**
 * Everything the listing screen shows.
 *
 * Four round trips, three of them in parallel. What it deliberately does NOT
 * fetch is the seller's Stripe status — the website reads that with a
 * service-role client to draw a "verified" badge, and there is no RLS path to
 * another member's row. Rather than add a route for a badge, the app leaves
 * it out; the rating and review count carry the same job.
 */
export async function getListingDetail(
  listingId: number,
  userId: string | null
): Promise<ListingDetail | null> {
  const { data: listing } = await supabase
    .from("listings")
    .select(
      "id, seller_id, title, description, price_cents, status, sale_type, category, subcategory, condition, county, image_url, brand, brand_other, model, delivery_options, collection_notes, dexterity, shaft_flex, shaft_material, loft, item_size"
    )
    .eq("id", listingId)
    .maybeSingle()
    .overrideTypes<DetailRow>();

  // RLS makes "not visible to you" and "doesn't exist" the same answer, which
  // is correct: telling somebody a listing exists but isn't theirs to see
  // leaks the existence of other people's drafts.
  if (!listing) return null;

  const [imagesResult, sellerResult, ratingResult] = await Promise.all([
    supabase
      .from("listing_images")
      .select("image_url, position")
      .eq("listing_id", listingId)
      .order("position", { ascending: true })
      .overrideTypes<{ image_url: string; position: number }[]>(),
    supabase
      .from("profiles")
      .select("id, first_name, last_name, home_club, county, avatar_color, created_at")
      .eq("id", listing.seller_id)
      .maybeSingle()
      .overrideTypes<{
        id: string;
        first_name: string | null;
        last_name: string | null;
        home_club: string | null;
        county: string | null;
        avatar_color: string | null;
        created_at: string;
      }>(),
    supabase
      .from("seller_rating_summaries")
      .select("average_rating, review_count")
      .eq("user_id", listing.seller_id)
      .maybeSingle()
      .overrideTypes<{ average_rating: number | null; review_count: number | null }>(),
  ]);

  const [favourites, auction] = await Promise.all([
    favouritedIds([listingId], userId),
    auctionFor(listingId, listing.sale_type),
  ]);

  const gallery = (imagesResult.data ?? []).map((row) => row.image_url);
  const seller = sellerResult.data;

  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    priceCents: listing.price_cents,
    status: listing.status,
    saleType: listing.sale_type,
    category: listing.category,
    subcategory: listing.subcategory,
    condition: listing.condition,
    county: listing.county,
    brand: listing.brand,
    brandOther: listing.brand_other,
    model: listing.model,
    deliveryOptions: listing.delivery_options ?? [],
    collectionNotes: listing.collection_notes,
    specs: Object.entries(SPEC_LABELS)
      .map(([key, label]) => ({
        label,
        value: String((listing as unknown as Record<string, unknown>)[key] ?? ""),
      }))
      .filter((spec) => spec.value !== ""),
    // The cover falls back to listings.image_url so a listing whose images
    // row never wrote still shows something.
    images: gallery.length > 0 ? gallery : listing.image_url ? [listing.image_url] : [],
    seller: seller
      ? {
          id: seller.id,
          name:
            [seller.first_name, seller.last_name].filter(Boolean).join(" ") || "A member",
          homeClub: seller.home_club,
          county: seller.county,
          avatarColor: seller.avatar_color,
          memberSince: seller.created_at,
          rating: ratingResult.data?.average_rating ?? null,
          reviewCount: ratingResult.data?.review_count ?? 0,
        }
      : null,
    isMine: userId === listing.seller_id,
    isFavourited: favourites.has(listingId),
    currentBidCents: auction?.currentBidCents ?? null,
    auctionEndsAt: auction?.endsAt ?? null,
  };
}

async function auctionFor(
  listingId: number,
  saleType: string
): Promise<{ currentBidCents: number | null; endsAt: string | null } | null> {
  if (!isAuction(saleType)) return null;

  const { data: auction } = await supabase
    .from("auctions")
    .select("id, ends_at, starting_price_cents")
    .eq("listing_id", listingId)
    .maybeSingle()
    .overrideTypes<{ id: number; ends_at: string | null; starting_price_cents: number }>();

  if (!auction) return null;

  const { data: top } = await supabase
    .from("auction_bid_history")
    .select("amount_cents")
    .eq("auction_id", auction.id)
    .order("amount_cents", { ascending: false })
    .limit(1)
    .overrideTypes<{ amount_cents: number }[]>();

  return {
    currentBidCents: top?.[0]?.amount_cents ?? auction.starting_price_cents,
    endsAt: auction.ends_at,
  };
}

// ---------------------------------------------------------------------------
// Favourites
// ---------------------------------------------------------------------------

/**
 * Adds or removes a favourite, and says which it did.
 *
 * Written straight to Supabase: `listing_favourites` has one FOR ALL policy
 * scoped to the caller's own id (0037), and nothing notifies. Unlike the
 * website's read-then-write, this is one round trip each way — the unique
 * (listing_id, user_id) index is what makes the insert safe to fire blind.
 */
export async function setFavourite(
  listingId: number,
  userId: string,
  favourited: boolean
): Promise<void> {
  if (favourited) {
    await supabase
      .from("listing_favourites")
      .upsert({ listing_id: listingId, user_id: userId }, { onConflict: "listing_id,user_id" });
    return;
  }

  await supabase
    .from("listing_favourites")
    .delete()
    .eq("listing_id", listingId)
    .eq("user_id", userId);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** "€1,250" from cents. Empty for an auction with no price of its own — its
 *  price is a current bid, which the card labels differently. */
export function money(cents: number | null): string {
  if (cents === null) return "";
  return `€${Math.round(cents / 100).toLocaleString("en-IE")}`;
}

/** What the big number on a card means. An auction's is a bid, not a price,
 *  and calling both "price" is how somebody pays the wrong attention to it. */
export function priceLine(card: Pick<Card, "saleType" | "priceCents" | "currentBidCents">): {
  label: string;
  value: string;
} {
  if (isAuction(card.saleType)) {
    return { label: "Current bid", value: money(card.currentBidCents) || "No bids yet" };
  }
  return { label: "", value: money(card.priceCents) };
}
