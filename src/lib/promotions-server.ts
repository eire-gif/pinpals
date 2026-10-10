import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { notifyUser } from "@/lib/notifications-server";
import { PROMOTIONS, type PromotionKind } from "@/lib/marketplace-growth";
import { getSiteUrl } from "@/lib/site-url";
import { getStripeClient } from "@/lib/stripe/client";

/**
 * Paid promotions (0115), server side.
 *
 * startPromotionCheckout() writes a pending listing_promotions row and opens
 * a Stripe Checkout Session for it. The price comes from PROMOTIONS, never
 * the browser. The PaymentIntent carries `pinpals_promotion_id`, and the
 * webhook (payment_intent.succeeded, src/lib/stripe/payments.ts) calls
 * activatePromotion(), which runs activate_listing_promotion() — the
 * database decides the dates and is idempotent on redelivery.
 *
 * The money stays with PinPals: no transfer, no connected account.
 */

export const PROMOTION_METADATA_KEY = "pinpals_promotion_id";

export async function startPromotionCheckout(
  admin: SupabaseClient,
  input: { listingId: number; sellerId: string; kind: PromotionKind; listingTitle: string }
): Promise<string> {
  const offer = PROMOTIONS[input.kind];

  const { data: promo, error } = await admin
    .from("listing_promotions")
    .insert({ listing_id: input.listingId, seller_id: input.sellerId, kind: input.kind, amount_eur: offer.eur })
    .select("id")
    .single<{ id: number }>();
  if (error || !promo) throw new Error(`Couldn't create promotion: ${error?.message ?? "no row"}`);

  const site = getSiteUrl();
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: Math.round(offer.eur * 100),
            product_data: {
              name: `PinPals ${offer.title}: ${input.listingTitle}`.slice(0, 250),
              description: offer.blurb,
            },
          },
        },
      ],
      payment_intent_data: {
        description: `PinPals ${offer.title.toLowerCase()} for listing ${input.listingId}`,
        metadata: { [PROMOTION_METADATA_KEY]: String(promo.id), pinpals_listing_id: String(input.listingId) },
      },
      metadata: { [PROMOTION_METADATA_KEY]: String(promo.id) },
      client_reference_id: input.sellerId,
      success_url: `${site}/dashboard/listings/${input.listingId}/promote?paid=${promo.id}`,
      cancel_url: `${site}/dashboard/listings/${input.listingId}/promote?cancelled=1`,
    },
    { idempotencyKey: `pinpals-promotion-${promo.id}` }
  );

  await admin.from("listing_promotions").update({ stripe_session_id: session.id }).eq("id", promo.id);
  if (!session.url) throw new Error("Stripe returned no checkout URL.");
  return session.url;
}

/** The promotion a PaymentIntent paid for, if it was one. */
export function promotionIdFrom(paymentIntent: Pick<Stripe.PaymentIntent, "metadata">): number | null {
  const raw = paymentIntent.metadata?.[PROMOTION_METADATA_KEY];
  const id = raw ? Number(raw) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Turn it on. Checks the amount paid against the row (never trusting the
 * event alone), then lets the database set the dates and the listing.
 * Returns false when the amount didn't match — the caller marks the webhook
 * event failed for a human to look at.
 */
export async function activatePromotion(
  admin: SupabaseClient,
  promotionId: number,
  paymentIntent: Pick<Stripe.PaymentIntent, "id" | "amount" | "currency">
): Promise<{ ok: true; listingId: number } | { ok: false; reason: string }> {
  const { data: promo } = await admin
    .from("listing_promotions")
    .select("id, listing_id, seller_id, kind, amount_eur, status")
    .eq("id", promotionId)
    .maybeSingle<{ id: number; listing_id: number; seller_id: string; kind: PromotionKind; amount_eur: number; status: string }>();
  if (!promo) return { ok: false, reason: `No promotion ${promotionId}.` };
  if (paymentIntent.currency !== "eur" || paymentIntent.amount !== Math.round(Number(promo.amount_eur) * 100)) {
    return { ok: false, reason: `Promotion ${promotionId}: paid ${paymentIntent.amount} ${paymentIntent.currency}, expected ${promo.amount_eur} eur.` };
  }

  const wasActive = promo.status === "active";
  const { error } = await admin.rpc("activate_listing_promotion", {
    p_promotion_id: promotionId,
    p_payment_intent: paymentIntent.id,
  });
  if (error) throw new Error(`activate_listing_promotion(${promotionId}) failed: ${error.message}`);

  if (!wasActive) {
    const offer = PROMOTIONS[promo.kind];
    await notifyUser(admin, {
      userId: promo.seller_id,
      type: "payment_succeeded",
      title: promo.kind === "featured" ? "Your listing is Featured" : "Your listing was bumped",
      body:
        promo.kind === "featured"
          ? `It's at the top of Used Gear for the next ${offer.days} days.`
          : "It's back at the top of Fresh today.",
      href: `/marketplace/${promo.listing_id}`,
      data: { listingId: promo.listing_id },
      dedupeKey: `promotion:${promotionId}:active`,
    });
  }
  return { ok: true, listingId: promo.listing_id };
}
