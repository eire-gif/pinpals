"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { DEFAULT_CHECKOUT_WINDOW_MINUTES } from "@/lib/marketplace";
import { linkConversationToOrder } from "@/lib/conversations-server";
import { runOfferSweeps } from "../actions";
import type { DeliveryOption } from "@/lib/types";

export type CheckoutSubmitState = { error?: string };

// By user id — a genuine buyer completes checkout once or twice per
// listing; sized to blunt a scripted retry loop against the atomic listing
// claim below, same shape as the old BUY_NOW_MAX_ATTEMPTS this replaces.
const CHECKOUT_MAX_ATTEMPTS = 10;
const CHECKOUT_WINDOW_SECONDS = 60 * 60;

// create_purchase_order()'s (0050) own raised exception messages — surfaced
// directly, same discipline as every other KNOWN_*_REJECTION_SNIPPETS
// constant in this app (offerAction()/createOffer() in
// src/app/marketplace/[id]/actions.ts).
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

/**
 * Submits the Buy Now checkout page (src/app/marketplace/[id]/checkout/page.tsx):
 * the buyer has already chosen a delivery method and, if needed, an
 * address — this is the one call that turns that choice into an actual
 * reserved order, via create_purchase_order() (0050), the "Server
 * transaction" this phase's task describes. Every eligibility/price value is
 * re-derived from trusted data inside that function; nothing this action
 * passes through (listingId aside) is treated as anything but a buyer
 * *preference* the function is free to reject.
 */
export async function submitBuyNowCheckout(
  listingId: number,
  deliveryMethod: DeliveryOption,
  addressId: number | null
): Promise<CheckoutSubmitState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rateLimit = await checkRateLimit({
    action: "checkout-buy-now",
    identifier: user.id,
    maxHits: CHECKOUT_MAX_ATTEMPTS,
    windowSeconds: CHECKOUT_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  // Clears any past-deadline reservation on this listing first, same reason
  // createOffer() runs this before its own insert — a stale 'reserved'
  // listing left over from someone else's lapsed checkout window should
  // never block a fresh purchase.
  await runOfferSweeps();

  const admin = createAdminClient();
  const { data: orderId, error } = await admin.rpc("create_purchase_order", {
    p_caller_id: user.id,
    p_listing_id: listingId,
    p_delivery_method: deliveryMethod,
    p_address_id: addressId,
    p_reservation_minutes: DEFAULT_CHECKOUT_WINDOW_MINUTES,
  });

  if (error || !orderId) {
    const message =
      error && KNOWN_CHECKOUT_REJECTION_SNIPPETS.some((snippet) => error.message.includes(snippet))
        ? error.message
        : "Couldn't complete that purchase — please try again.";
    return { error: message };
  }

  // Best-effort conversation<->order link — see linkConversationToOrder()'s
  // own comment (src/lib/conversations-server.ts) for why this never blocks
  // or fails the purchase itself.
  const { data: listing } = await admin.from("listings").select("seller_id").eq("id", listingId).maybeSingle<{ seller_id: string }>();
  if (listing) {
    await linkConversationToOrder({ listingId, buyerId: user.id, sellerId: listing.seller_id, orderId: orderId as number });
  }

  revalidatePath(`/marketplace/${listingId}`);
  revalidatePath("/marketplace");
  redirect(`/dashboard/orders/${orderId as number}`);
}
