import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { formatPrice } from "@/lib/format";
import { notifyUser } from "@/lib/notifications-server";
import { getStripeClient } from "@/lib/stripe/client";
import { centsFromEur } from "@/lib/stripe/payments";
import type { Order } from "@/lib/types";

/**
 * Releasing a held sale to the seller (0114, Buyer Protection).
 *
 * Payments are separate charges and transfers: the buyer's money sits on the
 * platform until the order is released, then this creates ONE transfer to
 * the seller's connected account for the item price plus any postage. What
 * stays behind is PinPals' Buyer Protection fee.
 *
 * Release happens when the database says it may (orders.release_due_at has
 * passed and nothing froze it):
 *   - the seller entered the buyer's handover code (due now)
 *   - the buyer tapped "It arrived — all OK" (due now)
 *   - 3 days after an agreed meet-up, or 14 days after posting, with no
 *     problem reported
 *
 * Idempotent twice over: the transfer carries an idempotency key per order,
 * and the order update is guarded on payout_status = 'held', so a release
 * racing another (the sweep and a handover at the same moment) moves money
 * once and records it once.
 */

export type ReleaseOutcome = "released" | "not_due" | "no_account" | "failed";

export async function releaseOrder(admin: SupabaseClient, order: Order): Promise<ReleaseOutcome> {
  if (order.payout_status !== "held" || order.payment_status !== "paid" || !order.payment_reference) return "not_due";

  const { data: account } = await admin
    .from("stripe_connected_accounts")
    .select("stripe_account_id")
    .eq("user_id", order.seller_id)
    .maybeSingle<{ stripe_account_id: string }>();
  if (!account) return "no_account";

  const stripe = getStripeClient();
  // Item + postage, less a pro shop's commission (0115; 0 for members).
  const sellerEur =
    Math.round((Number(order.amount_eur) + (order.delivery_fee_cents ?? 0) / 100 - Number(order.seller_commission_eur ?? 0)) * 100) / 100;

  let transferId: string;
  try {
    const pi = await stripe.paymentIntents.retrieve(order.payment_reference);
    const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
    const transfer = await stripe.transfers.create(
      {
        amount: centsFromEur(sellerEur),
        currency: order.currency ?? "eur",
        destination: account.stripe_account_id,
        // Ties the transfer to the buyer's payment: funds become available to
        // the seller as that charge settles, never before.
        ...(chargeId ? { source_transaction: chargeId } : {}),
        transfer_group: `pinpals-order-${order.id}`,
        metadata: { pinpals_order_id: String(order.id) },
      },
      { idempotencyKey: `pinpals-order-${order.id}-release` }
    );
    transferId = transfer.id;
  } catch (err) {
    console.error(`release of order ${order.id} failed:`, err instanceof Error ? err.message : err);
    return "failed";
  }

  const { data: updated } = await admin
    .from("orders")
    .update({
      payout_status: "pending",
      payout_reference: transferId,
      released_at: new Date().toISOString(),
      fulfilment_status: order.fulfilment_status === "posted" || order.fulfilment_status === "awaiting_post" ? "received" : "completed",
    })
    .eq("id", order.id)
    .eq("payout_status", "held")
    .select("id");
  if (!updated || updated.length === 0) return "released"; // someone else recorded it first

  await notifyUser(admin, {
    userId: order.seller_id,
    type: "payment_succeeded",
    title: "You've been paid",
    body: `${formatPrice(sellerEur)} for "${order.listing_title}" is on its way to your bank.`,
    href: `/dashboard/orders/${order.id}`,
    data: { orderId: order.id },
    dedupeKey: `order:${order.id}:released:seller`,
  });
  // Reviews open once the item has changed hands, not at payment.
  for (const [userId, otherId] of [
    [order.buyer_id, order.seller_id],
    [order.seller_id, order.buyer_id],
  ] as const) {
    await notifyUser(admin, {
      userId,
      type: "review_available",
      title: "Leave a review",
      body: `Your sale of "${order.listing_title}" is complete — leave a review for the other golfer.`,
      href: userId === order.buyer_id ? "/dashboard/buying?tab=delivery" : "/dashboard/selling?tab=sales",
      data: { orderId: order.id, revieweeId: otherId },
      dedupeKey: `order:${order.id}:review_available:${userId}`,
    });
  }
  return "released";
}

/** Everything due, oldest first. Runs with the marketplace sweep. */
export async function releaseDueOrders(admin: SupabaseClient): Promise<{ released: number; failed: number }> {
  const { data, error } = await admin.rpc("orders_due_for_release");
  if (error) {
    console.error("orders_due_for_release failed:", error.message);
    return { released: 0, failed: 0 };
  }
  let released = 0;
  let failed = 0;
  for (const order of (data ?? []) as Order[]) {
    const outcome = await releaseOrder(admin, order);
    if (outcome === "released") released += 1;
    else if (outcome === "failed" || outcome === "no_account") failed += 1;
  }
  return { released, failed };
}
