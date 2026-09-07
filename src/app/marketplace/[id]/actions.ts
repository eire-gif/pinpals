"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { eurToCents, centsToEur, MIN_OFFER_AMOUNT_CENTS, DEFAULT_CHECKOUT_WINDOW_MINUTES } from "@/lib/marketplace";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { linkConversationToOrder } from "@/lib/conversations-server";
import { sellerOnboardingStatus, isSellerPaymentReady } from "@/lib/stripe/connect";
import { REPORT_CATEGORIES, type ReportCategory } from "@/lib/admin/reports";
import type { Listing, Offer, Order, StripeConnectedAccount } from "@/lib/types";

export type PublishListingState = { error?: string; success?: boolean };

/**
 * Moves a `draft` listing (see ../new/actions.ts's createListing()) to
 * `active` once the seller is actually ready to be paid — the other half of
 * the payment-readiness gate. Re-checks readiness here rather than trusting
 * that the caller only shows this button when ready, since a Server Action
 * is a public HTTP endpoint regardless of what the UI does or doesn't render.
 *
 * The actual status write goes through the service-role client on purpose:
 * `validate_listing_status_transition()` (0045_marketplace_rls_hardening.sql)
 * only allows a `draft -> active` transition for staff/service-role, not an
 * ordinary seller updating their own row through RLS — this action IS that
 * privileged, narrowly-scoped path, same pattern as offerAction() below
 * calling offer_action() via the admin client after re-verifying
 * authorization itself, not inheriting it from a policy.
 */
export async function publishListing(listingId: number): Promise<PublishListingState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: listing } = await supabase
    .from("listings")
    .select("id, seller_id, status")
    .eq("id", listingId)
    .maybeSingle<Pick<Listing, "id" | "seller_id" | "status">>();

  if (!listing || listing.seller_id !== user.id) {
    return { error: "That listing couldn't be found." };
  }
  if (listing.status !== "draft") {
    return { error: "Only a draft listing can be published." };
  }

  const { data: account } = await supabase
    .from("stripe_connected_accounts")
    .select("charges_enabled, payouts_enabled, details_submitted, requirements_currently_due, requirements_past_due, disabled_reason")
    .eq("user_id", user.id)
    .maybeSingle<
      Pick<
        StripeConnectedAccount,
        | "charges_enabled"
        | "payouts_enabled"
        | "details_submitted"
        | "requirements_currently_due"
        | "requirements_past_due"
        | "disabled_reason"
      >
    >();

  if (!isSellerPaymentReady(sellerOnboardingStatus(account))) {
    return { error: "Finish seller setup with Stripe before publishing — see Seller readiness in your dashboard." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("listings")
    .update({ status: "active" })
    .eq("id", listingId)
    .eq("seller_id", user.id)
    .eq("status", "draft");

  if (error) {
    return { error: "Couldn't publish that listing — please try again." };
  }

  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/marketplace");
  return { success: true };
}

export type OfferFormState = { error?: string; success?: boolean };

// By user id — generous enough for genuine back-and-forth negotiation
// across several listings, tight enough to blunt a scripted offer-spam loop
// against sellers.
const CREATE_OFFER_MAX_ATTEMPTS = 20;
const CREATE_OFFER_WINDOW_SECONDS = 60 * 60;

// prevent_offer_self_dealing()'s (0044) and prepare_and_validate_offer()'s
// (0048) own raised exception messages — already written to be read by a
// buyer, not just a developer, same "surface the trigger's own message"
// discipline as placeBid()'s KNOWN_BID_REJECTION_SNIPPETS below. Anything
// else (an unexpected Postgres/network error) falls back to a generic
// message rather than leaking a raw driver error.
const KNOWN_OFFER_CREATE_REJECTION_SNIPPETS = [
  "Sellers cannot make offers",
  "not currently accepting offers",
  "does not accept offers",
  "must be at least",
  "must be less than the asking price",
  "not found",
];

/**
 * Opportunistic sweep for the two lazily-corrected states migration 0048
 * introduced — a past-deadline offer still stored as 'pending'/'countered',
 * and a checkout reservation whose window has passed. Neither sweep is ever
 * load-bearing for correctness (offer_action()/prepare_and_validate_offer()
 * both re-check expiry against `now()` directly, regardless of whether a
 * sweep has run recently), so a failure here is logged and swallowed rather
 * than blocking whatever triggered the sweep — see that migration's own
 * "no pg_cron dependency" header comment for why this app calls these two
 * functions opportunistically instead of on a schedule. Called from
 * createOffer() below (so a stale chain never trips the one-active-offer
 * unique index, and a stale reservation never blocks a fresh offer on the
 * listing it was holding) and from the listing-detail page's own load (so
 * what's rendered doesn't lag behind reality by more than one page view).
 */
export async function runOfferSweeps(): Promise<void> {
  const admin = createAdminClient();
  const [reservations, offers] = await Promise.all([
    admin.rpc("release_expired_offer_reservations"),
    admin.rpc("expire_stale_offers"),
  ]);
  if (reservations.error) {
    console.error("release_expired_offer_reservations failed:", reservations.error.message);
  }
  if (offers.error) {
    console.error("expire_stale_offers failed:", offers.error.message);
  }
}

/**
 * Creates a fresh offer chain — the one client-writable step in the offer
 * workflow that stays on the ordinary RLS+trigger path (see 0048's header
 * comment on why only the response/accept step needed a new SECURITY
 * DEFINER function). Everything about validity — amount bounds, the listing
 * actually accepting offers, self-dealing, the one-active-chain-per-buyer
 * rule — is enforced by prepare_and_validate_offer() and the unique partial
 * index at insert time; MIN_OFFER_AMOUNT_CENTS here is only a fast,
 * friendly client-side hint, same split as everywhere else in this schema.
 */
export async function createOffer(
  listingId: number,
  _prev: OfferFormState,
  formData: FormData
): Promise<OfferFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const rateLimit = await checkRateLimit({
    action: "create-offer",
    identifier: user.id,
    maxHits: CREATE_OFFER_MAX_ATTEMPTS,
    windowSeconds: CREATE_OFFER_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const amount = Number(formData.get("amount"));
  if (!amount || Number.isNaN(amount) || amount <= 0 || eurToCents(amount) < MIN_OFFER_AMOUNT_CENTS) {
    return { error: `Enter a valid offer of at least ${centsToEur(MIN_OFFER_AMOUNT_CENTS)} euro.` };
  }

  // Clears any past-deadline offer/reservation on this listing first, so a
  // stale chain of this buyer's own never trips the one-active-offer unique
  // index, and a stale 'reserved' listing status left over from an expired
  // checkout window never blocks this new offer either.
  await runOfferSweeps();

  const { error } = await supabase.from("offers").insert({
    listing_id: listingId,
    buyer_id: user.id,
    amount_eur: amount,
  });

  if (error) {
    // offers_one_active_chain_per_buyer_listing (0048) — this buyer already
    // has a pending/countered offer on this listing.
    if (error.code === "23505") {
      return { error: "You already have an active offer on this listing — see your offer status below." };
    }
    const message = KNOWN_OFFER_CREATE_REJECTION_SNIPPETS.some((snippet) => error.message.includes(snippet))
      ? error.message
      : "Couldn't send that offer — the listing may no longer be available.";
    return { error: message };
  }

  revalidatePath(`/marketplace/${listingId}`);
  return { success: true };
}

export type OfferActionState = { error?: string; success?: boolean };
export type OfferActionKind = "accept" | "decline" | "counter" | "withdraw";

// One shared bucket across accept/decline/counter/withdraw, keyed by caller
// id — offer_action() itself is the actual authorization boundary (a buyer
// can't rack up a seller's attempts and vice versa, since each caller is
// rate-limited under their own id regardless of which role they're acting
// in). Generous enough for a real back-and-forth on a handful of offers at
// once, tight enough to blunt a scripted accept/decline-spam loop.
const OFFER_RESPONSE_MAX_ATTEMPTS = 30;
const OFFER_RESPONSE_WINDOW_SECONDS = 60 * 60;

// offer_action()'s (0048) own raised exception messages — surfaced
// directly, same discipline as KNOWN_OFFER_CREATE_REJECTION_SNIPPETS above.
const KNOWN_OFFER_RESPONSE_REJECTION_SNIPPETS = [
  "expired",
  "no longer available",
  "not a party to this offer",
  "Only the seller",
  "Only the buyer",
  "Only a pending offer",
  "cannot be acted on",
  "needs an amount",
  "must be higher than the current offer",
  "cannot exceed the asking price",
  "Unknown offer action",
  "not found",
  "Not authenticated",
];

/**
 * Every offer state transition except creation — seller accept/decline/
 * counter on a 'pending' offer, buyer accept/decline on a 'countered' one,
 * and buyer withdraw of their own 'pending' offer. One function for every
 * caller/action pair (rather than four separate Server Actions) because
 * offer_action() (0048) is itself already the single choke-point that knows
 * who's allowed to do what to which offer — duplicating that branching up
 * here would just be a second, driftable copy of the same state machine.
 *
 * Accepting is the one branch that's genuinely transactional server-side:
 * offer_action() locks the listing and offer, re-validates both are still
 * eligible, reserves the listing and snapshots a pending order with a
 * short checkout window — see that function's own header comment for the
 * lock-ordering reasoning. Every transition, including this one, is
 * recorded automatically by the existing log_offer_event()/log_order_event()
 * triggers (0038/0040), so nothing here writes to offer_events/order_events
 * directly.
 */
export async function offerAction(
  offerId: number,
  listingId: number,
  action: OfferActionKind,
  counterAmountEur?: number
): Promise<OfferActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const rateLimit = await checkRateLimit({
    action: "offer-response",
    identifier: user.id,
    maxHits: OFFER_RESPONSE_MAX_ATTEMPTS,
    windowSeconds: OFFER_RESPONSE_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  // Security-critical cross-check (IDOR guard), same reasoning the old
  // respondToOffer() documented: offerId and listingId are two independent
  // client-supplied ids, and nothing on the wire enforces that they
  // actually match. Confirmed here, via the caller's own RLS-bound read
  // (buyers can view their own offers; sellers can view offers on their
  // listings — 0032), BEFORE ever calling the privileged RPC below, so a
  // mismatched pair fails closed with a friendly message instead of
  // offer_action() silently acting on the wrong listing's offer (it has no
  // way to know listingId was even supplied — only offerId is).
  const { data: offer } = await supabase
    .from("offers")
    .select("id, listing_id")
    .eq("id", offerId)
    .maybeSingle<Pick<Offer, "id" | "listing_id">>();
  if (!offer || offer.listing_id !== listingId) {
    return { error: "That offer no longer matches this listing — refresh and try again." };
  }

  let counterAmountCents: number | null = null;
  if (action === "counter") {
    if (!counterAmountEur || Number.isNaN(counterAmountEur) || counterAmountEur <= 0) {
      return { error: "Enter a valid counter-offer amount in euro." };
    }
    counterAmountCents = eurToCents(counterAmountEur);
  }

  // offer_action() is SECURITY DEFINER and revoked from anon/authenticated
  // (0048) — called only via the service-role client, exactly like
  // create_purchase_order() (0050, ./checkout/actions.ts) uses the same
  // client for its own privileged writes. p_caller_id is this action's own
  // re-verified session user, never trusted from the client, and
  // offer_action() re-checks it again itself against the locked rows —
  // belt and suspenders, not a substitute for either layer.
  const admin = createAdminClient();
  const { error } = await admin.rpc("offer_action", {
    p_offer_id: offerId,
    p_caller_id: user.id,
    p_action: action,
    p_counter_amount_cents: counterAmountCents,
    p_checkout_minutes: DEFAULT_CHECKOUT_WINDOW_MINUTES,
  });

  if (error) {
    const message = KNOWN_OFFER_RESPONSE_REJECTION_SNIPPETS.some((snippet) => error.message.includes(snippet))
      ? error.message
      : "Couldn't complete that action — please refresh and try again.";
    return { error: message };
  }

  // Best-effort conversation<->order link (see src/lib/conversations-server.ts) —
  // offer_action() creates the order atomically inside its own transaction
  // and returns the offer row, not the order, so this looks the resulting
  // order back up by offer_id rather than threading a new return value
  // through an already-shipped, tested RPC for this one, non-blocking
  // follow-up write.
  if (action === "accept") {
    const { data: order } = await admin
      .from("orders")
      .select("id, buyer_id, seller_id")
      .eq("offer_id", offerId)
      .maybeSingle<Pick<Order, "id" | "buyer_id" | "seller_id">>();
    if (order) {
      await linkConversationToOrder({
        listingId,
        buyerId: order.buyer_id,
        sellerId: order.seller_id,
        orderId: order.id,
      });
    }
  }

  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/marketplace");
  revalidatePath("/dashboard/orders");
  return { success: true };
}

export type BidFormState = { error?: string; success?: boolean };

// By user id — generous enough for genuine back-and-forth bidding in the
// closing minutes of an auction, tight enough to blunt a scripted
// bid-spam/denial-of-service attempt against one auction.
const PLACE_BID_MAX_ATTEMPTS = 30;
const PLACE_BID_WINDOW_SECONDS = 10 * 60;

// validate_bid()'s own raised exception messages (0046_listing_creation_
// workflow.sql) are already written to be read by a bidder, not just a
// developer — surfaced directly rather than masked, same as
// offerAction()'s own snippet-matched errors above. Matched
// against a fixed set of known snippets so a genuinely unexpected
// Postgres/network error still falls back to a generic message instead of
// leaking a raw driver error.
const KNOWN_BID_REJECTION_SNIPPETS = [
  "Sellers cannot bid",
  "is not open for bidding",
  "has already ended",
  "Bid must",
  "not found",
];

/**
 * Places a bid on an auction — a straight authenticated insert into `bids`,
 * relying entirely on validate_bid() (the `BEFORE INSERT` trigger from
 * 0046_listing_creation_workflow.sql) for the actual amount/status/timing
 * validation. Nothing about eligibility or the minimum amount is checked
 * here first: whatever this action is told the "minimum next bid" was when
 * the page rendered is only ever a hint for the form's placeholder — the
 * trigger re-validates against the auction's current state at the instant
 * this insert lands, so a stale hint can only produce a friendly rejection,
 * never an accepted under-bid.
 */
export async function placeBid(
  listingId: number,
  auctionId: number,
  _prev: BidFormState,
  formData: FormData
): Promise<BidFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rateLimit = await checkRateLimit({
    action: "place-bid",
    identifier: user.id,
    maxHits: PLACE_BID_MAX_ATTEMPTS,
    windowSeconds: PLACE_BID_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const amountEur = Number(formData.get("amount"));
  if (!amountEur || Number.isNaN(amountEur) || amountEur <= 0) {
    return { error: "Enter a valid bid amount in euro." };
  }

  const { error } = await supabase.from("bids").insert({
    auction_id: auctionId,
    bidder_id: user.id,
    amount_cents: eurToCents(amountEur),
  });

  if (error) {
    const message = KNOWN_BID_REJECTION_SNIPPETS.some((snippet) => error.message.includes(snippet))
      ? error.message
      : "Couldn't place that bid — the auction may have just changed. Please refresh and try again.";
    return { error: message };
  }

  revalidatePath(`/marketplace/${listingId}`);
  return { success: true };
}

export type ReportListingState = { error?: string; success?: boolean };

// Same shape and reasoning as REPORT_CONVERSATION_MAX_ATTEMPTS in
// src/app/conversations/actions.ts — the moderation queue is a shared,
// limited-staff resource, so this stays a much lower ceiling than a
// per-listing action like Buy Now or Place Bid.
const REPORT_LISTING_MAX_ATTEMPTS = 10;
const REPORT_LISTING_WINDOW_SECONDS = 60 * 60;

/**
 * The listing-page counterpart to reportConversation()
 * (src/app/conversations/actions.ts). 'listing' has been a valid
 * reports.target_type since the moderation queue itself was built
 * (0016_admin_reports.sql) — that migration's own header comment notes it
 * was declared ahead of any member-facing reporting flow existing yet; this
 * is that flow, for this target type, finally landing. Same privilege
 * split as every other report/order write in this app: `reports` has no
 * authenticated insert policy at all, so this goes through the
 * service-role client only after confirming — via the caller's own
 * RLS-bound session, never trusting listingId alone — that the listing
 * actually exists.
 */
export async function reportListing(
  listingId: number,
  _prev: ReportListingState,
  formData: FormData
): Promise<ReportListingState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rateLimit = await checkRateLimit({
    action: "report-listing",
    identifier: user.id,
    maxHits: REPORT_LISTING_MAX_ATTEMPTS,
    windowSeconds: REPORT_LISTING_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const category = String(formData.get("category") ?? "") as ReportCategory;
  const description = String(formData.get("description") ?? "").trim();

  if (!REPORT_CATEGORIES.includes(category)) return { error: "Please choose a reason." };
  if (description.length > 4000) return { error: "Please keep the description under 4000 characters." };

  const { data: listing } = await supabase
    .from("listings")
    .select("id")
    .eq("id", listingId)
    .maybeSingle<Pick<Listing, "id">>();
  if (!listing) return { error: "Listing not found." };

  const admin = createAdminClient();
  const { error } = await admin.from("reports").insert({
    reporter_id: user.id,
    target_type: "listing",
    target_id: String(listingId),
    category,
    description: description || null,
  });

  if (error) return { error: "Couldn't file that report — please try again." };

  return { success: true };
}
