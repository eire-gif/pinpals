import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSellerPaymentReady, sellerOnboardingStatus } from "@/lib/stripe/connect";
import type { Listing, StripeConnectedAccount } from "@/lib/types";

/**
 * Publishing a draft listing.
 *
 * Lifted out of the /marketplace/[id] Server Action so the app's own route
 * can run the identical sequence rather than a second version of it.
 *
 * WHY THE APP CANNOT SIMPLY DO THIS ITSELF. Two reasons, and both matter.
 *
 * `validate_listing_status_transition()` (0045) does not allow a member to
 * move a listing from `draft` to `active` — only staff or the service role
 * can. That is deliberate: going on sale is the moment a listing becomes
 * something another member can pay for. So the write here goes through the
 * admin client, and this function re-verifies ownership itself rather than
 * inheriting it from a policy, because the policy is precisely what is being
 * stepped around.
 *
 * And a listing may only go on sale if the seller can actually be paid.
 * `isSellerPaymentReady()` is a TypeScript reading of Stripe's own account
 * flags; there is no policy that could enforce it. A listing that went live
 * without it would take a buyer's money with nowhere to send it.
 */

export type PublishResult = { ok: true } | { ok: false; message: string };

export async function publishListingFor(
  supabase: SupabaseClient,
  userId: string,
  listingId: number
): Promise<PublishResult> {
  const { data: listing } = await supabase
    .from("listings")
    .select("id, seller_id, status")
    .eq("id", listingId)
    .maybeSingle<Pick<Listing, "id" | "seller_id" | "status">>();

  // Ownership checked here, not left to RLS: the write below uses the admin
  // client and would happily update anybody's row.
  if (!listing || listing.seller_id !== userId) {
    return { ok: false, message: "That listing couldn't be found." };
  }
  if (listing.status !== "draft") {
    return { ok: false, message: "Only a draft listing can be published." };
  }

  const { data: account } = await supabase
    .from("stripe_connected_accounts")
    .select(
      "charges_enabled, payouts_enabled, details_submitted, requirements_currently_due, requirements_past_due, disabled_reason"
    )
    .eq("user_id", userId)
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
    return {
      ok: false,
      message:
        "Finish setting up payouts with Stripe before publishing — a listing can't go on sale until you can be paid.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("listings")
    .update({ status: "active" })
    .eq("id", listingId)
    .eq("seller_id", userId)
    // Re-stated so a listing published twice at once still only goes live
    // from a draft — the read above is not a lock.
    .eq("status", "draft");

  if (error) {
    return { ok: false, message: "Couldn't publish that listing — please try again." };
  }

  return { ok: true };
}
