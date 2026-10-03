"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publishListingFor } from "@/lib/listing-operations";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import {
  makeOffer,
  placeBid as placeBidFor,
  respondToOffer,
  sweepMarketplace,
  type OfferActionKind,
} from "@/lib/marketplace-operations";
import { REPORT_CATEGORIES, parseEvidenceRefs, type ReportCategory } from "@/lib/admin/reports";
import type { Listing } from "@/lib/types";

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

  // The work — the payment-readiness gate and the privileged draft -> active
  // write — lives in src/lib/listing-operations.ts so the app's own route
  // performs the identical sequence. See that module for why neither half can
  // be left to a policy.
  const result = await publishListingFor(supabase, user.id, listingId);
  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/marketplace");
  return { success: true };
}

export type OfferFormState = { error?: string; success?: boolean };

/**
 * Opportunistic sweep for every lazily-corrected, time-based state this app
 * has: a past-deadline offer still stored as 'pending'/'countered', a
 * checkout reservation whose window has passed (both 0048), and an auction
 * past its own `ends_at` that's never been closed (run_auction_sweeps(),
 * 0056). None of these are ever load-bearing for correctness — every write
 * re-checks expiry against now() itself — so a failure is logged and
 * swallowed rather than blocking whatever triggered the sweep. See 0048's
 * "no pg_cron dependency" header comment for why these run opportunistically
 * instead of on a schedule. Called before offers and purchases, and from
 * every marketplace-relevant page's own load, so what's rendered — and what
 * notifications have fired — doesn't lag reality by more than a page view.
 *
 * The work is in src/lib/marketplace-operations.ts, shared with the app.
 */
export async function runOfferSweeps(): Promise<void> {
  await sweepMarketplace();
}

/**
 * Creates a fresh offer chain. Everything about validity is enforced by
 * prepare_and_validate_offer() and the one-active-chain index at insert
 * time (0048); the rate limit and the friendly messages are in
 * makeOffer() (src/lib/marketplace-operations.ts), which the app's
 * /api/app/listings/[id]/offers route calls too.
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

  const result = await makeOffer({
    supabase,
    userId: user.id,
    listingId,
    amountEur: Number(formData.get("amount")),
  });
  if (!result.ok) {
    return {
      error:
        result.message === "You already have an active offer on this listing."
          ? "You already have an active offer on this listing — see your offer status below."
          : result.message,
    };
  }

  revalidatePath(`/marketplace/${listingId}`);
  return { success: true };
}

export type OfferActionState = { error?: string; success?: boolean };
export type { OfferActionKind };

/**
 * Every offer state transition except creation — seller accept/decline/
 * counter on a 'pending' offer, buyer accept/decline on a 'countered' one,
 * buyer withdraw of their own 'pending' offer. offer_action() (0048) is the
 * single choke-point that knows who may do what; respondToOffer()
 * (src/lib/marketplace-operations.ts) adds the rate limit, the IDOR
 * cross-check of offer against listing before the service-role call, and
 * the conversation link on accept. Shared with the app.
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

  const result = await respondToOffer({
    supabase,
    userId: user.id,
    offerId,
    listingId,
    action,
    counterAmountEur: counterAmountEur ?? null,
  });
  if (!result.ok) return { error: result.message };

  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/marketplace");
  revalidatePath("/dashboard/orders");
  return { success: true };
}

export type BidFormState = { error?: string; success?: boolean };

/**
 * Places a bid. validate_bid() (0046) decides everything at the instant the
 * insert lands; see placeBid() in src/lib/marketplace-operations.ts, which
 * the app's /api/app/listings/[id]/bids route also calls.
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

  const result = await placeBidFor({
    supabase,
    userId: user.id,
    listingId,
    auctionId,
    amountEur: Number(formData.get("amount")),
  });
  if (!result.ok) return { error: result.message };

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
  const evidenceRefs = parseEvidenceRefs(String(formData.get("evidence") ?? ""));

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
    evidence_refs: evidenceRefs.length ? evidenceRefs : null,
  });

  if (error) return { error: "Couldn't file that report — please try again." };

  return { success: true };
}
