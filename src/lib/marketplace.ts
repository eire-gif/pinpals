export const CATEGORIES = [
  "Drivers",
  "Woods & hybrids",
  "Irons",
  "Wedges",
  "Putters",
  "Full sets",
  "Bags & trolleys",
  "Shoes & apparel",
  "Balls & accessories",
] as const;

export const CONDITIONS = [
  "New / unused",
  "Excellent",
  "Good",
  "Fair",
] as const;

// Optional finer-grained grouping within a category — shown as a second
// select once a category is chosen (src/app/marketplace/new/new-listing-form.tsx),
// never required (a listing with no obvious subcategory just leaves it
// null). Keyed by the exact CATEGORIES string above, same "value IS the
// display label" convention as CATEGORIES/CONDITIONS themselves.
export const SUBCATEGORIES: Record<(typeof CATEGORIES)[number], readonly string[]> = {
  "Drivers": ["Standard", "Left-handed", "Junior / ladies", "Limited / tour edition"],
  "Woods & hybrids": ["Fairway woods", "Hybrids", "Left-handed"],
  "Irons": ["Iron sets", "Individual irons", "Left-handed"],
  "Wedges": ["Pitching wedge", "Sand wedge", "Lob wedge", "Gap wedge"],
  "Putters": ["Blade", "Mallet", "Left-handed"],
  "Full sets": ["Men's set", "Women's set", "Junior set"],
  "Bags & trolleys": ["Stand bags", "Cart bags", "Electric trolleys", "Push trolleys", "Travel bags"],
  "Shoes & apparel": ["Shoes", "Waterproofs", "Gloves", "Headwear", "Other apparel"],
  "Balls & accessories": ["Golf balls", "Tees", "Head covers", "Rangefinders / GPS", "Other accessories"],
};

// ============ Listing creation/edit workflow constants ============
// See supabase/migrations/0046_listing_creation_workflow.sql — every limit
// below mirrors a DB-level guardrail from that migration (or, for the image
// limit/type/size, the pre-existing "listing-images" Storage bucket config
// from 0003_marketplace.sql). Client/server validation duplicates these for
// fast, friendly feedback; the DB constraint or Storage bucket setting is
// what's actually trusted — same split as everywhere else in this schema.

/** Matches listing_images_enforce_limit's hardcoded 8 (0046). */
export const MAX_LISTING_IMAGES = 8;

/** Matches the "listing-images" bucket's file_size_limit (0003): 5MB. */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/** Matches the "listing-images" bucket's allowed_mime_types (0003). */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const SALE_TYPES = ["fixed_price", "offers_allowed", "auction", "auction_with_buy_now"] as const;

export const DELIVERY_OPTIONS = ["post", "collection"] as const;

/** Matches listings_collection_notes_length_check (0046). */
export const MAX_COLLECTION_NOTES_LENGTH = 500;

/** The two auction sale types — pulled out once since several call sites
 * (this file's own price-required check mirror, the zod schema, the create
 * form) all need to branch on "is this an auction" the same way. */
export const AUCTION_SALE_TYPES = ["auction", "auction_with_buy_now"] as const;

export function isAuctionSaleType(saleType: string): boolean {
  return (AUCTION_SALE_TYPES as readonly string[]).includes(saleType);
}

// ============ Auction window validation ============
// DB-enforced: ends_at > starts_at only (auctions_ends_after_starts_check,
// 0039). The narrower bounds below are app-layer only — there's no
// correctness reason to reject, say, a 45-day auction at the database level,
// but an unbounded window makes for a bad create-listing experience (an
// auction seller forgets to change a defaulted end date and lists something
// for a year), so this phase's form/zod schema enforces a sane range.
export const MIN_AUCTION_DURATION_HOURS = 1;
export const MAX_AUCTION_DURATION_DAYS = 30;

/** `null` when the window is valid, otherwise a user-facing reason. Pure
 * function so both the zod schema (src/lib/validation/listing.ts) and any
 * client-side inline hint can share one source of truth for the rule. */
export function auctionWindowError(startsAt: Date, endsAt: Date): string | null {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return "Enter a valid start and end time.";
  }
  const durationMs = endsAt.getTime() - startsAt.getTime();
  const minMs = MIN_AUCTION_DURATION_HOURS * 60 * 60 * 1000;
  const maxMs = MAX_AUCTION_DURATION_DAYS * 24 * 60 * 60 * 1000;
  if (durationMs < minMs) {
    return `An auction must run for at least ${MIN_AUCTION_DURATION_HOURS} hour.`;
  }
  if (durationMs > maxMs) {
    return `An auction can run for at most ${MAX_AUCTION_DURATION_DAYS} days.`;
  }
  return null;
}

// The cut Pinpals takes on a completed sale, shown to the buyer as a
// line-item on top of the agreed price (same pattern as Vinted's buyer fee).
export const PLATFORM_FEE_RATE = 0.07;

export function computeOfferTotal(amountEur: number) {
  const fee = Math.round(amountEur * PLATFORM_FEE_RATE * 100) / 100;
  const total = Math.round((amountEur + fee) * 100) / 100;
  return { amount: amountEur, fee, total };
}

/** Euro <-> integer-cents, rounding to the nearest cent — the one place this
 * conversion happens so price_eur and price_cents (0046) can never drift
 * apart from independently-rounded call sites. */
export function eurToCents(eur: number): number {
  return Math.round(eur * 100);
}

export function centsToEur(cents: number): number {
  return cents / 100;
}

// ============ Seller reputation (derived, read-only) ============
// Both of these are pure math over rows the seller-readiness page
// (src/app/dashboard/payouts/page.tsx) already reads from existing tables —
// `reviews` (0041) and `offers` (0003/0032) — deliberately not a new table
// or column of their own, same "don't invent what you can derive" discipline
// as sellerOnboardingStatus() in src/lib/stripe/connect.ts.

/** Average + count from a seller's review ratings (1-5 each, see
 * 0041_reviews.sql's check constraint). `null` — not 0 — when there are no
 * reviews yet, so the UI can show "No reviews yet" rather than implying a
 * zero-star reputation. */
export function summarizeRatings(ratings: number[]): { average: number; count: number } | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((total, rating) => total + rating, 0);
  // One decimal place (e.g. 4.7) — matches how star ratings are conventionally shown.
  return { average: Math.round((sum / ratings.length) * 10) / 10, count: ratings.length };
}

/** Percentage of offers a seller has responded to (accepted or declined,
 * i.e. anything other than still-`pending`) out of every offer ever made on
 * their listings. `null` — not 0 — when they've never received an offer, so
 * a brand-new seller isn't shown a misleading "0% response rate". */
export function computeResponseRate(totalOffers: number, respondedOffers: number): number | null {
  if (totalOffers === 0) return null;
  return Math.round((respondedOffers / totalOffers) * 100);
}

// ============ Listing detail page (this phase) ============

/**
 * "Why can't I buy this?" copy for every non-active listing status — the
 * listing-detail page's purchase panel shows this instead of Buy Now/Place
 * Bid whenever the server-recomputed status isn't 'active' (this phase's
 * spec: "Reserved/sold/expired/removed: disable purchasing and state why").
 * `null` for 'active' means "purchasing is allowed", the only falsy case a
 * caller needs to branch on. Kept here (not inline in the page component)
 * so it's trivially unit-testable and there is exactly one place this copy
 * can drift from the seven-value ListingStatus enum.
 */
export function listingUnavailableReason(status: string): string | null {
  switch (status) {
    case "active":
      return null;
    case "reserved":
      return "This listing is under offer and no longer available.";
    case "sold":
      return "This item has already sold.";
    case "expired":
      return "This listing has expired.";
    case "removed":
      return "This listing is no longer available.";
    case "draft":
      return "This listing isn't published yet.";
    case "pending_review":
      return "This listing is awaiting review.";
    default:
      return "This listing is no longer available.";
  }
}

/**
 * The lowest bid `validate_bid()` (supabase/migrations/0046_listing_creation_workflow.sql)
 * will actually accept right now — the starting price with no bids yet, or
 * the current high plus the auction's own minimum increment once there is
 * one. Shown to a bidder as "minimum next bid" and used as the bid form's
 * default value; the trigger itself (not this function) is what's actually
 * enforced server-side when the bid is placed, so a stale value here can
 * only ever produce a friendly client-side rejection, never an accepted
 * under-bid.
 */
export function nextMinimumBidCents(
  auction: { starting_price_cents: number; min_increment_cents: number },
  currentHighCents: number | null
): number {
  return currentHighCents === null ? auction.starting_price_cents : currentHighCents + auction.min_increment_cents;
}

/** Takes `now` explicitly (default `new Date()`), same pattern as
 * formatTimeRemaining() in src/lib/format.ts, so a component computing this
 * inline stays a pure render — the impure clock read lives in this
 * function's own default parameter, not inline in a component body. */
export function auctionHasEnded(endsAtIso: string, now: Date = new Date()): boolean {
  return new Date(endsAtIso).getTime() <= now.getTime();
}

// ============ Private offer workflow ============
// See supabase/migrations/0048_marketplace_offer_workflow.sql. As with the
// listing-creation constants above, every number here mirrors a hardcoded
// value in that migration's PL/pgSQL — the DB is what's actually enforced
// (prepare_and_validate_offer() and offer_action() re-check all of this
// server-side), these are for fast client-side hints only.

/** Matches prepare_and_validate_offer()'s `v_amount_cents < 100` floor. */
export const MIN_OFFER_AMOUNT_CENTS = 100;

/** Matches prepare_and_validate_offer()'s `now() + interval '48 hours'`
 * (initial offer) and offer_action()'s counter-offer branch, which resets
 * the same 48-hour window. */
export const OFFER_EXPIRY_HOURS = 48;

/** Matches offer_action()'s `p_checkout_minutes integer default 30`. */
export const DEFAULT_CHECKOUT_WINDOW_MINUTES = 30;

/** The offer statuses a buyer/seller can still act on — everything else
 * (accepted/declined/withdrawn/expired) is a terminal state the offer sheet
 * should render as history, not controls. */
export const ACTIONABLE_OFFER_STATUSES = ["pending", "countered"] as const;

export function isOfferActionable(status: string): boolean {
  return (ACTIONABLE_OFFER_STATUSES as readonly string[]).includes(status);
}

/** Same `now` param convention as auctionHasEnded() above. An offer past its
 * expires_at is only truly gone once expire_stale_offers() next sweeps it
 * (or a listing-unavailable trigger fires) — this is a client-side "don't
 * let the buyer submit a response that's about to be rejected anyway" hint,
 * not a substitute for the server's own expiry check inside offer_action(). */
export function offerHasExpired(expiresAtIso: string, now: Date = new Date()): boolean {
  return new Date(expiresAtIso).getTime() <= now.getTime();
}
