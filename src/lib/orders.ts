import { PLATFORM_FEE_RATE } from "./marketplace";
import type { Address, DeliveryOption } from "./types";

// ============ Buy Now / accepted-offer checkout ============
// See supabase/migrations/0050_marketplace_checkout.sql for the actual
// enforcement — create_purchase_order() and finalize_offer_checkout() are
// what's trusted; every constant/function below is a client-side mirror for
// fast, friendly feedback on the checkout page, same split as everywhere
// else in this schema (src/lib/marketplace.ts's own header comments).
//
// Order status transitions themselves have no TS mirror at all, by design:
// validate_order_status_transition() (0050) is the one server-side module
// the task asked for, and it's the only thing that ever needs to reject an
// invalid transition — there is no authenticated/anon write path to
// orders.status for a client-side copy of that graph to usefully pre-check
// against (see that migration's header comment). App code only ever *reads*
// order.status to decide what to show, which the small helpers below (and
// the existing canPay/checkoutDeadlinePassed checks inline in
// src/app/dashboard/orders/[id]/page.tsx) already cover without needing a
// duplicated state machine.

/**
 * Flat, platform-wide postage fee — mirrors the `6.00` literal in both
 * create_purchase_order() and finalize_offer_checkout() (0050). Deliberately
 * flat rather than seller-set: nothing in this schema models a seller's own
 * per-listing shipping cost yet (listings only ever declare WHICH delivery
 * methods they support — delivery_options, 0046 — never a price for one),
 * so a single nationwide flat fee is this phase's explicit simplification,
 * not an oversight. A future phase adding real seller-set postage would
 * replace this constant with a per-listing read, in both this file and the
 * migration, together.
 */
export const DELIVERY_FEE_EUR = 6.0;

/**
 * Pinpals never applies VAT/sales tax to a marketplace transaction: this is
 * a peer-to-peer marketplace between individual members reselling their own
 * gear, not Pinpals selling retail stock, so no line item is ever due. A
 * named constant (rather than just omitting the concept) so "tax treatment
 * if applicable" reads as a considered decision anywhere this total is
 * assembled, matching create_purchase_order()'s own header comment.
 */
export const TAX_TREATMENT = "not_applicable" as const;

/** The three line items and total a checkout page shows, computed the same
 * way create_purchase_order()/finalize_offer_checkout() (0050) do server-
 * side — this is a hint for instant on-screen feedback as a buyer toggles
 * delivery method, never what's actually charged; the DB functions re-derive
 * every figure from trusted data regardless of what a stale client sent. */
export function computeCheckoutTotal(itemPriceEur: number, deliveryMethod: DeliveryOption) {
  const fee = Math.round(itemPriceEur * PLATFORM_FEE_RATE * 100) / 100;
  const delivery = deliveryMethod === "post" ? DELIVERY_FEE_EUR : 0;
  const total = Math.round((itemPriceEur + fee + delivery) * 100) / 100;
  return { itemPriceEur, fee, delivery, total };
}

/** Field length limits mirroring `addresses`' own check constraints (0050) —
 * fast client-side validation only; the DB constraints are what's actually
 * enforced. */
export const ADDRESS_FIELD_LIMITS = {
  label: 60,
  recipientName: 120,
  line1: 200,
  line2: 200,
  city: 100,
  county: 100,
  eircode: 20,
  phone: 30,
} as const;

/** One-line display string for a saved address — matches the concatenation
 * create_purchase_order()/finalize_offer_checkout() (0050) snapshot into a
 * paid order's own `delivery_detail`, so what a buyer sees while choosing an
 * address on the checkout page is exactly what will end up on their order. */
export function formatAddress(
  address: Pick<Address, "recipient_name" | "line1" | "line2" | "city" | "county" | "eircode">
): string {
  let out = `${address.recipient_name}, ${address.line1}`;
  if (address.line2) out += `, ${address.line2}`;
  out += `, ${address.city}`;
  if (address.county) out += `, ${address.county}`;
  if (address.eircode) out += ` ${address.eircode}`;
  return out;
}
