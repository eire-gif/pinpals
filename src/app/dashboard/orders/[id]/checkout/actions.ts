"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import type { DeliveryOption } from "@/lib/types";

export type CheckoutSubmitState = { error?: string };

// Same shape/reasoning as CHECKOUT_MAX_ATTEMPTS in
// src/app/marketplace/[id]/checkout/actions.ts — a buyer finalizing an
// already-accepted offer's delivery choice hits this once or twice, not
// dozens of times.
const OFFER_CHECKOUT_MAX_ATTEMPTS = 10;
const OFFER_CHECKOUT_WINDOW_SECONDS = 60 * 60;

// finalize_offer_checkout()'s (0050) own raised exception messages.
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
 * Submits the accepted-offer checkout page (src/app/dashboard/orders/[id]/
 * checkout/page.tsx). Unlike submitBuyNowCheckout(), the order here already
 * exists — offer_action() (0048) created it, reserved and priced, the
 * instant the offer was accepted — so this only ever finalizes delivery
 * choice on that existing row via finalize_offer_checkout() (0050); see that
 * function's own header comment for why it's a separate function rather
 * than folded into offer_action() itself.
 */
export async function submitOfferCheckout(
  orderId: number,
  deliveryMethod: DeliveryOption,
  addressId: number | null
): Promise<CheckoutSubmitState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rateLimit = await checkRateLimit({
    action: "checkout-offer",
    identifier: user.id,
    maxHits: OFFER_CHECKOUT_MAX_ATTEMPTS,
    windowSeconds: OFFER_CHECKOUT_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const admin = createAdminClient();
  const { data: finalizedOrderId, error } = await admin.rpc("finalize_offer_checkout", {
    p_caller_id: user.id,
    p_order_id: orderId,
    p_delivery_method: deliveryMethod,
    p_address_id: addressId,
  });

  if (error || !finalizedOrderId) {
    const message =
      error && KNOWN_OFFER_CHECKOUT_REJECTION_SNIPPETS.some((snippet) => error.message.includes(snippet))
        ? error.message
        : "Couldn't complete checkout — please try again.";
    return { error: message };
  }

  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/orders");
  redirect(`/dashboard/orders/${orderId}`);
}
