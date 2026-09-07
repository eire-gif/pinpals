"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeOfferTotal, eurToCents, centsToEur, auctionHasEnded, listingUnavailableReason } from "@/lib/marketplace";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { sellerOnboardingStatus, isSellerPaymentReady } from "@/lib/stripe/connect";
import { REPORT_CATEGORIES, type ReportCategory } from "@/lib/admin/reports";
import type { Listing, Offer, Auction, Order, StripeConnectedAccount } from "@/lib/types";

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
 * privileged, narrowly-scoped path, same pattern as respondToOffer() below
 * inserting into `orders` via the admin client after re-verifying
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
const MAKE_OFFER_MAX_ATTEMPTS = 20;
const MAKE_OFFER_WINDOW_SECONDS = 60 * 60;

export async function makeOffer(
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
    action: "make-offer",
    identifier: user.id,
    maxHits: MAKE_OFFER_MAX_ATTEMPTS,
    windowSeconds: MAKE_OFFER_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const amount = Number(formData.get("amount"));
  if (!amount || Number.isNaN(amount) || amount <= 0) {
    return { error: "Enter a valid offer amount in euro." };
  }

  const { error } = await supabase.from("offers").insert({
    listing_id: listingId,
    buyer_id: user.id,
    amount_eur: amount,
  });

  if (error) {
    return { error: "Couldn't send that offer — the listing may no longer be available." };
  }

  revalidatePath(`/marketplace/${listingId}`);
  return { success: true };
}

export async function respondToOffer(
  offerId: number,
  listingId: number,
  accept: boolean
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetched up front (RLS-bound, same client the update below uses) so an
  // accept can snapshot this exact listing/offer state into an order row —
  // see the comment on the order-creation block below for why this can't
  // just re-read from `listings` after the fact.
  const [{ data: offerBefore }, { data: listingBefore }] = await Promise.all([
    supabase.from("offers").select("*").eq("id", offerId).maybeSingle<Offer>(),
    supabase.from("listings").select("*").eq("id", listingId).maybeSingle<Listing>(),
  ]);

  // Security-critical cross-check (IDOR guard): offerId and listingId are
  // two independent client-supplied ids — offers-list.tsx always passes a
  // matching pair, but nothing on the wire enforces that, and a caller could
  // invoke this Server Action directly with an offerId belonging to a
  // DIFFERENT listing the same seller also owns. Without this check, a
  // seller who owns listings A and D could accept the real offer on D while
  // supplying A's listingId: the offers RLS policy still lets the update
  // through (only requires being the offer's own listing's seller), but
  // every step below — reserving the listing, declining its other offers,
  // and snapshotting an `orders` row — would then operate on the WRONG
  // listing, fabricating a paid order against A for D's actual buyer while
  // leaving D itself corrupted (never reserved, no order created). Checked
  // before any write happens, not just before the order insert, so a
  // mismatched pair fails closed instead of partially applying.
  if (!offerBefore || !listingBefore || offerBefore.listing_id !== listingId) {
    return { error: "That offer no longer matches this listing — refresh and try again." };
  }

  const { error } = await supabase
    .from("offers")
    .update({ status: accept ? "accepted" : "declined" })
    .eq("id", offerId);

  if (error) {
    return { error: error.message };
  }

  // Accepting one offer takes the listing off the market and closes out
  // every other pending offer on it, so a seller can't double-sell.
  if (accept) {
    await supabase.from("listings").update({ status: "reserved" }).eq("id", listingId);
    await supabase
      .from("offers")
      .update({ status: "declined" })
      .eq("listing_id", listingId)
      .eq("status", "pending")
      .neq("id", offerId);

    // Build the marketplace order model's one write path: a durable,
    // snapshotted record of this transaction (see
    // supabase/migrations/0019_orders.sql). `orders` has no authenticated
    // insert policy at all — this goes through the service-role client, the
    // same escape hatch src/lib/admin/audit.ts's recordAdminAction() uses
    // for privileged writes — so, unlike the RLS-protected updates above,
    // authorization here has to be re-checked explicitly rather than
    // inherited from a policy. The offers RLS policy that let the update
    // above succeed already implies the caller is this listing's seller
    // (only a listing's own seller can update its offers' status), but this
    // re-verifies it directly against the listing row itself before writing
    // a financial record — "authorization as a server-side security
    // boundary, not a UI condition" holds even for a check that looks
    // redundant. offerBefore/listingBefore (fetched before either update
    // ran) are what get snapshotted, not a re-read after the fact, so the
    // order reflects the state that was actually accepted.
    if (offerBefore && listingBefore && listingBefore.seller_id === user.id) {
      const { amount, fee, total } = computeOfferTotal(offerBefore.amount_eur);
      const admin = createAdminClient();
      const { error: orderError } = await admin.from("orders").insert({
        listing_id: listingBefore.id,
        offer_id: offerBefore.id,
        buyer_id: offerBefore.buyer_id,
        seller_id: listingBefore.seller_id,
        listing_title: listingBefore.title,
        listing_category: listingBefore.category,
        listing_condition: listingBefore.condition,
        listing_image_url: listingBefore.image_url,
        amount_eur: amount,
        platform_fee_eur: fee,
        total_eur: total,
      });
      // Non-blocking by design: a failed order write (including the
      // expected case of `offer_id`'s unique constraint rejecting a repeat
      // accept on an already-ordered offer) must never surface as a broken
      // "accept offer" experience for the buyer/seller — the offer/listing
      // updates above already succeeded and are the behavior this phase's
      // general rules require to be preserved unchanged. Logged server-side
      // only.
      if (orderError) {
        console.error(`Failed to create order for accepted offer ${offerBefore.id}:`, orderError.message);
      }
    }
  }

  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/marketplace");
  return { error: undefined };
}

// ============ Listing detail page: Buy Now / Place Bid / Report ============

export type BuyNowState = { error?: string };

// By user id — a genuine buyer rarely hits this more than once or twice per
// listing; this is sized to blunt a scripted attempt to hammer the atomic
// claim below, not to constrain ordinary use.
const BUY_NOW_MAX_ATTEMPTS = 10;
const BUY_NOW_WINDOW_SECONDS = 60 * 60;

/**
 * The buyer-initiated purchase path for a `fixed_price`/`offers_allowed`
 * listing, and for the Buy It Now price on an `auction_with_buy_now`
 * listing (which also ends the auction). This is the one Server Action
 * behind every "Buy Now" button the listing-detail page renders — the
 * button passes nothing but the listing id; everything about whether the
 * purchase is actually still possible, and its exact price, is read fresh
 * from the database right here (this phase's spec: "All eligibility and
 * price values must be recomputed on the server when an action begins").
 *
 * Until now the only buyer-purchase path anywhere in this app was the offer
 * flow (makeOffer -> respondToOffer's accept branch creates the `orders`
 * row). This mirrors that same shape — a service-role insert into `orders`
 * after re-verifying authorization directly, since `orders` has no
 * authenticated insert policy at all (0019_orders.sql) — but reaches it
 * directly rather than through a negotiation step.
 *
 * On success this redirects straight to the new order's payment page
 * (createOrderPaymentIntent()/PayForm, src/app/dashboard/orders/[id]/) —
 * the exact same Stripe checkout the accepted-offer flow already uses,
 * never a second payment mechanism — rather than returning state; there is
 * nothing left to show on this page once the order exists.
 */
export async function buyNow(listingId: number): Promise<BuyNowState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rateLimit = await checkRateLimit({
    action: "buy-now",
    identifier: user.id,
    maxHits: BUY_NOW_MAX_ATTEMPTS,
    windowSeconds: BUY_NOW_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const { data: listing } = await supabase.from("listings").select("*").eq("id", listingId).maybeSingle<Listing>();
  if (!listing) return { error: "That listing couldn't be found." };
  if (listing.seller_id === user.id) return { error: "You can't buy your own listing." };
  if (listing.status !== "active") {
    return { error: listingUnavailableReason(listing.status) ?? "This listing is no longer available." };
  }

  const admin = createAdminClient();
  let orderId: number;

  if (listing.sale_type === "auction_with_buy_now") {
    const { data: auction } = await supabase
      .from("auctions")
      .select("*")
      .eq("listing_id", listingId)
      .maybeSingle<Auction>();

    if (!auction || auction.buy_now_price_cents === null) {
      return { error: "Buy It Now isn't available on this listing." };
    }
    if (auction.status === "ended" || auction.status === "cancelled" || auctionHasEnded(auction.ends_at)) {
      return { error: "This auction has already ended." };
    }

    // Atomic claim, service-role only (no authenticated UPDATE policy
    // exists on `auctions` at all — see 0039's header comment): only
    // succeeds if the auction is still open AND its end time hasn't passed
    // — the same `now() > ends_at` boundary validate_bid() enforces for a
    // bid, re-applied here since nothing else in this schema flips an
    // auction to 'ended' automatically once its timer runs out. Together
    // with the status check, two buyers hitting Buy It Now on the same
    // auction at once can't both win it, and neither can win it after it's
    // timed out.
    const { data: claimedAuction } = await admin
      .from("auctions")
      .update({ status: "ended" })
      .eq("id", auction.id)
      .in("status", ["scheduled", "live"])
      .gt("ends_at", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (!claimedAuction) {
      return { error: "This auction just ended — Buy It Now is no longer available." };
    }

    // Best-effort courtesy, not the real gate: the auctions update above is
    // what actually prevents a double-sale. Taking the listing off the
    // public grid too just keeps browse/search from lagging behind.
    await admin.from("listings").update({ status: "reserved" }).eq("id", listingId).eq("status", "active");

    const { amount: amountEur, fee, total } = computeOfferTotal(centsToEur(auction.buy_now_price_cents));

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        listing_id: listing.id,
        buyer_id: user.id,
        seller_id: listing.seller_id,
        listing_title: listing.title,
        listing_category: listing.category,
        listing_condition: listing.condition,
        listing_image_url: listing.image_url,
        amount_eur: amountEur,
        platform_fee_eur: fee,
        total_eur: total,
      })
      .select("id")
      .single<Pick<Order, "id">>();

    if (orderError || !order) {
      // The auction is already ended at this point — reverting that would
      // reopen bidding on something this buyer was already told they'd
      // won, which is worse than a support ticket. Logged, not retried,
      // same non-blocking discipline as respondToOffer()'s own order-write
      // failure below.
      console.error(`Failed to create order for Buy It Now on auction ${auction.id}:`, orderError?.message);
      return { error: "Couldn't complete that purchase — please contact support and reference this listing." };
    }
    orderId = order.id;
  } else {
    if (listing.price_eur === null) {
      return { error: "This listing doesn't have a Buy Now price." };
    }

    // Atomic claim: the fixed-price equivalent of the auction guard above —
    // only succeeds if the listing is still active.
    const { data: claimed } = await admin
      .from("listings")
      .update({ status: "reserved" })
      .eq("id", listingId)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (!claimed) {
      return { error: "This listing is no longer available — someone may have just bought it." };
    }

    const { amount: amountEur, fee, total } = computeOfferTotal(listing.price_eur);

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        listing_id: listing.id,
        buyer_id: user.id,
        seller_id: listing.seller_id,
        listing_title: listing.title,
        listing_category: listing.category,
        listing_condition: listing.condition,
        listing_image_url: listing.image_url,
        amount_eur: amountEur,
        platform_fee_eur: fee,
        total_eur: total,
      })
      .select("id")
      .single<Pick<Order, "id">>();

    if (orderError || !order) {
      // Nothing irreversible happened yet (unlike the ended-auction branch
      // above) — hand the listing back so the buyer can just try again.
      await admin.from("listings").update({ status: "active" }).eq("id", listingId).eq("status", "reserved");
      console.error(`Failed to create order for Buy Now on listing ${listingId}:`, orderError?.message);
      return { error: "Couldn't complete that purchase — please try again." };
    }
    orderId = order.id;
  }

  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/marketplace");
  redirect(`/dashboard/orders/${orderId}`);
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
// respondToOffer()'s `return { error: error.message }` below. Matched
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
