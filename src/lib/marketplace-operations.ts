import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { linkConversationToOrder } from "@/lib/conversations-server";
import { DEFAULT_CHECKOUT_WINDOW_MINUTES, MIN_OFFER_AMOUNT_CENTS, centsToEur, eurToCents } from "@/lib/marketplace";
import type { DeliveryOption, Offer, Order } from "@/lib/types";

/**
 * Buying on the marketplace — offers, bids, Buy now and finishing an
 * accepted offer's checkout — once, for every caller.
 *
 * Lifted out of the Server Actions under src/app/marketplace/[id]/ and
 * src/app/dashboard/orders/[id]/checkout/ so the app's /api/app routes run
 * the identical sequence instead of a second copy of it. The Server Actions
 * are now thin wrappers that add redirects and revalidation; the rules, the
 * rate limits and the privileged RPC calls all live here.
 *
 * The real rules are in the database, as they always were:
 * prepare_and_validate_offer() and the one-active-chain index (0048) for
 * offers, offer_action() (0048) for every response, validate_bid() (0046)
 * for bids, create_purchase_order() and finalize_offer_checkout() (0050) for
 * orders. What is here is the authentication, the rate limit, the IDOR
 * cross-check before a service-role call, and turning the database's own
 * error messages into something a member can read — only the known ones;
 * anything unexpected falls back to a generic line rather than leaking a
 * driver error.
 */

export type Failure = "invalid" | "rate_limited" | "not_found" | "conflict";
export type OpResult<T = null> = { ok: true; value: T } | { ok: false; reason: Failure; message: string };

const fail = (reason: Failure, message: string): { ok: false; reason: Failure; message: string } => ({
  ok: false,
  reason,
  message,
});

function knownOr(message: string, snippets: readonly string[], fallback: string): string {
  return snippets.some((snippet) => message.includes(snippet)) ? message : fallback;
}

// ===========================================================================
// Sweeps
// ===========================================================================

/**
 * Opportunistic sweep for every lazily-corrected, time-based state: a
 * past-deadline offer still 'pending'/'countered', a lapsed checkout
 * reservation (both 0048), and an auction past its `ends_at` (0056). Never
 * load-bearing for correctness — every write re-checks expiry against now()
 * itself — so a failure is logged and swallowed. See the longer note on the
 * Server Action wrapper in src/app/marketplace/[id]/actions.ts.
 */
export async function sweepMarketplace(): Promise<void> {
  const admin = createAdminClient();
  const [reservations, offers, auctions] = await Promise.all([
    admin.rpc("release_expired_offer_reservations"),
    admin.rpc("expire_stale_offers"),
    admin.rpc("run_auction_sweeps"),
  ]);
  if (reservations.error) console.error("release_expired_offer_reservations failed:", reservations.error.message);
  if (offers.error) console.error("expire_stale_offers failed:", offers.error.message);
  if (auctions.error) console.error("run_auction_sweeps failed:", auctions.error.message);
}

// ===========================================================================
// Making an offer
// ===========================================================================

// By user id — generous enough for genuine back-and-forth negotiation
// across several listings, tight enough to blunt a scripted offer-spam loop.
const CREATE_OFFER_MAX_ATTEMPTS = 20;
const CREATE_OFFER_WINDOW_SECONDS = 60 * 60;

// prevent_offer_self_dealing() (0044) and prepare_and_validate_offer()
// (0048, blocked check from 0055) — written to be read by a buyer.
const KNOWN_OFFER_CREATE_REJECTION_SNIPPETS = [
  "Sellers cannot make offers",
  "not currently accepting offers",
  "does not accept offers",
  "must be at least",
  "must be less than the asking price",
  "not found",
  "blocked",
];

export async function makeOffer(params: {
  supabase: SupabaseClient;
  userId: string;
  listingId: number;
  amountEur: number;
}): Promise<OpResult> {
  const { supabase, userId, listingId, amountEur } = params;

  const rateLimit = await checkRateLimit({
    action: "create-offer",
    identifier: userId,
    maxHits: CREATE_OFFER_MAX_ATTEMPTS,
    windowSeconds: CREATE_OFFER_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) return fail("rate_limited", rateLimitMessage(rateLimit.retryAfterSeconds));

  if (!amountEur || Number.isNaN(amountEur) || amountEur <= 0 || eurToCents(amountEur) < MIN_OFFER_AMOUNT_CENTS) {
    return fail("invalid", `Enter a valid offer of at least ${centsToEur(MIN_OFFER_AMOUNT_CENTS)} euro.`);
  }

  // A stale chain of this buyer's own must never trip the one-active-offer
  // index, nor a lapsed reservation block a fresh offer.
  await sweepMarketplace();

  const { error } = await supabase.from("offers").insert({
    listing_id: listingId,
    buyer_id: userId,
    amount_eur: amountEur,
  });

  if (error) {
    // offers_one_active_chain_per_buyer_listing (0048).
    if (error.code === "23505") {
      return fail("conflict", "You already have an active offer on this listing.");
    }
    return fail(
      "conflict",
      knownOr(
        error.message,
        KNOWN_OFFER_CREATE_REJECTION_SNIPPETS,
        "Couldn't send that offer — the listing may no longer be available."
      )
    );
  }
  return { ok: true, value: null };
}

// ===========================================================================
// Answering an offer — accept, decline, counter, withdraw
// ===========================================================================

export const OFFER_ACTIONS = ["accept", "decline", "counter", "withdraw"] as const;
export type OfferActionKind = (typeof OFFER_ACTIONS)[number];

export function isOfferActionKind(value: unknown): value is OfferActionKind {
  return typeof value === "string" && (OFFER_ACTIONS as readonly string[]).includes(value);
}

// One bucket across all four actions, keyed by caller.
const OFFER_RESPONSE_MAX_ATTEMPTS = 30;
const OFFER_RESPONSE_WINDOW_SECONDS = 60 * 60;

// offer_action()'s (0048, 0055) own messages.
const KNOWN_OFFER_RESPONSE_REJECTION_SNIPPETS = [
  "expired",
  "no longer available",
  "not a party to this offer",
  "Only the seller",
  "Only the buyer",
  "Only a pending offer",
  "cannot be acted on",
  "needs an amount",
  "blocked",
  "must be higher than the current offer",
  "cannot exceed the asking price",
  "Unknown offer action",
  "not found",
  "Not authenticated",
];

/**
 * Every offer transition except creation. offer_action() is the single
 * choke-point that knows who may do what to which offer; accepting reserves
 * the listing and snapshots a pending order with a checkout window.
 *
 * `listingId` is optional: the website passes the listing it rendered and
 * this checks the two still match (an IDOR guard — two client-supplied ids
 * that nothing on the wire ties together). The app passes only the offer,
 * and the listing is read back from it under the caller's own RLS, which is
 * the same guarantee from the other end: buyers can read their own offers,
 * sellers the offers on their listings, nobody else either.
 */
export async function respondToOffer(params: {
  supabase: SupabaseClient;
  userId: string;
  offerId: number;
  action: OfferActionKind;
  counterAmountEur?: number | null;
  listingId?: number;
}): Promise<OpResult<{ listingId: number; orderId: number | null }>> {
  const { supabase, userId, offerId, action, counterAmountEur, listingId } = params;

  const rateLimit = await checkRateLimit({
    action: "offer-response",
    identifier: userId,
    maxHits: OFFER_RESPONSE_MAX_ATTEMPTS,
    windowSeconds: OFFER_RESPONSE_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) return fail("rate_limited", rateLimitMessage(rateLimit.retryAfterSeconds));

  const { data: offer } = await supabase
    .from("offers")
    .select("id, listing_id")
    .eq("id", offerId)
    .maybeSingle<Pick<Offer, "id" | "listing_id">>();
  if (!offer || (listingId !== undefined && offer.listing_id !== listingId)) {
    return fail("not_found", "That offer no longer matches this listing — refresh and try again.");
  }

  let counterAmountCents: number | null = null;
  if (action === "counter") {
    if (!counterAmountEur || Number.isNaN(counterAmountEur) || counterAmountEur <= 0) {
      return fail("invalid", "Enter a valid counter-offer amount in euro.");
    }
    counterAmountCents = eurToCents(counterAmountEur);
  }

  // SECURITY DEFINER and revoked from members (0048): service role only,
  // with this request's own verified user as p_caller_id. offer_action()
  // re-checks the caller against the locked rows itself.
  const admin = createAdminClient();
  const { error } = await admin.rpc("offer_action", {
    p_offer_id: offerId,
    p_caller_id: userId,
    p_action: action,
    p_counter_amount_cents: counterAmountCents,
    p_checkout_minutes: DEFAULT_CHECKOUT_WINDOW_MINUTES,
  });

  if (error) {
    return fail(
      "conflict",
      knownOr(
        error.message,
        KNOWN_OFFER_RESPONSE_REJECTION_SNIPPETS,
        "Couldn't complete that action — please refresh and try again."
      )
    );
  }

  // Accepting created an order inside offer_action()'s own transaction.
  // Looked back up by offer_id for the best-effort conversation link, and
  // so the caller can send the buyer straight to it.
  let orderId: number | null = null;
  if (action === "accept") {
    const { data: order } = await admin
      .from("orders")
      .select("id, buyer_id, seller_id")
      .eq("offer_id", offerId)
      .maybeSingle<Pick<Order, "id" | "buyer_id" | "seller_id">>();
    if (order) {
      orderId = order.id;
      await linkConversationToOrder({
        listingId: offer.listing_id,
        buyerId: order.buyer_id,
        sellerId: order.seller_id,
        orderId: order.id,
      });
    }
  }

  return { ok: true, value: { listingId: offer.listing_id, orderId } };
}

// ===========================================================================
// Bidding
// ===========================================================================

const PLACE_BID_MAX_ATTEMPTS = 30;
const PLACE_BID_WINDOW_SECONDS = 10 * 60;

// validate_bid()'s (0046) own messages.
const KNOWN_BID_REJECTION_SNIPPETS = [
  "Sellers cannot bid",
  "is not open for bidding",
  "has already ended",
  "Bid must",
  "not found",
];

/**
 * A plain insert into `bids`; validate_bid() decides everything at the
 * instant it lands, so a stale "minimum next bid" on a screen can only ever
 * produce a friendly rejection, never an accepted under-bid.
 *
 * The website passes the auction it rendered. The app passes the listing,
 * and the auction is read from it here — one auction per listing (0039).
 */
export async function placeBid(params: {
  supabase: SupabaseClient;
  userId: string;
  listingId: number;
  auctionId?: number;
  amountEur: number;
}): Promise<OpResult> {
  const { supabase, userId, listingId, amountEur } = params;

  const rateLimit = await checkRateLimit({
    action: "place-bid",
    identifier: userId,
    maxHits: PLACE_BID_MAX_ATTEMPTS,
    windowSeconds: PLACE_BID_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) return fail("rate_limited", rateLimitMessage(rateLimit.retryAfterSeconds));

  if (!amountEur || Number.isNaN(amountEur) || amountEur <= 0) {
    return fail("invalid", "Enter a valid bid amount in euro.");
  }

  let auctionId = params.auctionId;
  if (auctionId === undefined) {
    const { data: auction } = await supabase
      .from("auctions")
      .select("id")
      .eq("listing_id", listingId)
      .maybeSingle<{ id: number }>();
    if (!auction) return fail("not_found", "This listing isn't an auction.");
    auctionId = auction.id;
  }

  const { error } = await supabase.from("bids").insert({
    auction_id: auctionId,
    bidder_id: userId,
    amount_cents: eurToCents(amountEur),
  });

  if (error) {
    return fail(
      "conflict",
      knownOr(
        error.message,
        KNOWN_BID_REJECTION_SNIPPETS,
        "Couldn't place that bid — the auction may have just changed. Please refresh and try again."
      )
    );
  }
  return { ok: true, value: null };
}

// ===========================================================================
// Buy now — reserve the item and create the order
// ===========================================================================

const CHECKOUT_MAX_ATTEMPTS = 10;
const CHECKOUT_WINDOW_SECONDS = 60 * 60;

// create_purchase_order()'s (0050) own messages.
const KNOWN_CHECKOUT_REJECTION_SNIPPETS = [
  "You can't buy your own listing",
  "This listing is no longer available",
  "This seller doesn't offer that delivery method",
  "Choose a delivery address",
  "Choose a valid delivery method",
  "Buy It Now isn't available",
  "This auction has already ended",
  "This listing doesn't have a Buy Now price",
  "Listing not found",
  "Not authenticated",
];

export const DELIVERY_METHODS = ["post", "collection"] as const;

export function isDeliveryMethod(value: unknown): value is DeliveryOption {
  return typeof value === "string" && (DELIVERY_METHODS as readonly string[]).includes(value);
}

/**
 * create_purchase_order() re-derives the price, the fee and every
 * eligibility check from a locked read; the delivery method and address are
 * only the buyer's preference, which it is free to reject.
 */
export async function buyNow(params: {
  userId: string;
  listingId: number;
  deliveryMethod: DeliveryOption;
  addressId: number | null;
}): Promise<OpResult<{ orderId: number }>> {
  const { userId, listingId, deliveryMethod, addressId } = params;

  const rateLimit = await checkRateLimit({
    action: "checkout-buy-now",
    identifier: userId,
    maxHits: CHECKOUT_MAX_ATTEMPTS,
    windowSeconds: CHECKOUT_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) return fail("rate_limited", rateLimitMessage(rateLimit.retryAfterSeconds));

  await sweepMarketplace();

  const admin = createAdminClient();
  const { data: orderId, error } = await admin.rpc("create_purchase_order", {
    p_caller_id: userId,
    p_listing_id: listingId,
    p_delivery_method: deliveryMethod,
    p_address_id: addressId,
    p_reservation_minutes: DEFAULT_CHECKOUT_WINDOW_MINUTES,
  });

  if (error || !orderId) {
    return fail(
      "conflict",
      error
        ? knownOr(error.message, KNOWN_CHECKOUT_REJECTION_SNIPPETS, "Couldn't complete that purchase — please try again.")
        : "Couldn't complete that purchase — please try again."
    );
  }

  const { data: listing } = await admin
    .from("listings")
    .select("seller_id")
    .eq("id", listingId)
    .maybeSingle<{ seller_id: string }>();
  if (listing) {
    await linkConversationToOrder({ listingId, buyerId: userId, sellerId: listing.seller_id, orderId: orderId as number });
  }

  return { ok: true, value: { orderId: orderId as number } };
}

// ===========================================================================
// Finishing checkout on an accepted offer
// ===========================================================================

const OFFER_CHECKOUT_MAX_ATTEMPTS = 10;
const OFFER_CHECKOUT_WINDOW_SECONDS = 60 * 60;

// finalize_offer_checkout()'s (0050) own messages.
const KNOWN_OFFER_CHECKOUT_REJECTION_SNIPPETS = [
  "This order is no longer awaiting checkout",
  "Your checkout window has expired",
  "This order has already been paid",
  "This seller doesn't offer that delivery method",
  "Choose a delivery address",
  "Choose a valid delivery method",
  "Order not found",
  "Not authorized",
  "Not authenticated",
];

/**
 * The order already exists — offer_action() created it, reserved and
 * priced, the instant the offer was accepted. This only records how it is
 * getting to the buyer; finalize_offer_checkout() checks the caller is that
 * order's buyer.
 */
export async function finishOfferCheckout(params: {
  userId: string;
  orderId: number;
  deliveryMethod: DeliveryOption;
  addressId: number | null;
}): Promise<OpResult<{ orderId: number }>> {
  const { userId, orderId, deliveryMethod, addressId } = params;

  const rateLimit = await checkRateLimit({
    action: "checkout-offer",
    identifier: userId,
    maxHits: OFFER_CHECKOUT_MAX_ATTEMPTS,
    windowSeconds: OFFER_CHECKOUT_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) return fail("rate_limited", rateLimitMessage(rateLimit.retryAfterSeconds));

  const admin = createAdminClient();
  const { data: finalized, error } = await admin.rpc("finalize_offer_checkout", {
    p_caller_id: userId,
    p_order_id: orderId,
    p_delivery_method: deliveryMethod,
    p_address_id: addressId,
  });

  if (error || !finalized) {
    return fail(
      "conflict",
      error
        ? knownOr(error.message, KNOWN_OFFER_CHECKOUT_REJECTION_SNIPPETS, "Couldn't complete checkout — please try again.")
        : "Couldn't complete checkout — please try again."
    );
  }
  return { ok: true, value: { orderId } };
}

/** HTTP status for an app route. */
export function statusForMarketplaceFailure(reason: Failure): number {
  switch (reason) {
    case "invalid":
      return 422;
    case "rate_limited":
      return 429;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
  }
}
