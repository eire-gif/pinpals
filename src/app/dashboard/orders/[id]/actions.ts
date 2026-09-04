"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import { centsFromEur } from "@/lib/stripe/payments";
import type { Order, StripeConnectedAccount } from "@/lib/types";

export type CheckoutState = { error?: string; clientSecret?: string };

const GENERIC_ERROR = "Couldn't start checkout just now — please try again in a moment.";

/**
 * Creates (or resumes) the Stripe PaymentIntent for one order, and returns
 * its client_secret for the browser to confirm with Stripe Elements
 * (src/app/dashboard/orders/[id]/pay-form.tsx). This is the one place a
 * PaymentIntent gets created for a marketplace sale — the "actual checkout
 * step" admin-architecture-review.md's Phase 5 plan called for.
 *
 * Every value that ends up on the PaymentIntent — amount, currency, the
 * destination account, the platform fee — is read from `orders` (a row this
 * action re-fetches itself, scoped by RLS to rows the caller actually owns)
 * or from `stripe_connected_accounts`, never from `formData`/the request.
 * The order id is the only thing the browser supplies, and it only ever
 * selects *which* already-existing, already-priced order to charge for —
 * never what to charge.
 */
export async function createOrderPaymentIntent(
  _prev: CheckoutState,
  formData: FormData
): Promise<CheckoutState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orderId = Number(formData.get("orderId"));
  if (!orderId || Number.isNaN(orderId)) return { error: "Missing order." };

  // RLS-scoped read (0019_orders.sql's "Buyers can view their own orders")
  // — a non-buyer querying this id gets nothing back, independent of the
  // explicit re-check below. Belt-and-suspenders, same layering
  // respondToOffer() uses before it writes a financial record.
  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle<Order>();
  if (!order || order.buyer_id !== user.id) {
    return { error: "Order not found." };
  }
  if (order.status === "cancelled") return { error: "This order was cancelled." };
  if (order.payment_status === "paid") return { error: "This order has already been paid." };

  // Seller's connected-account row: a buyer has no RLS read path to another
  // member's stripe_connected_accounts row (0020's policies are
  // staff-or-own-row only), so this specific cross-user lookup goes through
  // the service-role client — a deliberate, narrow exception, not a general
  // bypass; everything else in this action still reads/writes through
  // ownership-scoped paths or re-verifies ownership explicitly.
  const admin = createAdminClient();
  const { data: sellerAccount } = await admin
    .from("stripe_connected_accounts")
    .select("stripe_account_id, charges_enabled")
    .eq("user_id", order.seller_id)
    .maybeSingle<Pick<StripeConnectedAccount, "stripe_account_id" | "charges_enabled">>();

  if (!sellerAccount?.charges_enabled) {
    return { error: "This seller hasn't finished setting up payouts yet — check back soon." };
  }

  const stripe = getStripeClient();

  // Reuse an existing, still-open PaymentIntent rather than creating a new
  // one on every page load/retry — Stripe's own recommended pattern, and
  // what keeps a buyer refreshing this page from accumulating duplicate
  // PaymentIntents for the same order.
  if (order.payment_reference) {
    try {
      const existing = await stripe.paymentIntents.retrieve(order.payment_reference);
      if (existing.status === "succeeded") {
        // The webhook hasn't caught up yet (or hasn't fired) — self-heal by
        // telling the caller it's already paid rather than opening a second
        // payment attempt. The order's own payment_status will catch up via
        // the webhook or the confirmation return; this action never writes
        // "paid" itself.
        return { error: "This order has already been paid." };
      }
      if (existing.client_secret && ["requires_payment_method", "requires_confirmation", "requires_action", "processing"].includes(existing.status)) {
        return { clientSecret: existing.client_secret };
      }
      // Canceled or otherwise unusable — fall through and create a new one.
    } catch {
      // Retrieval failed (e.g. the stored id is stale/invalid) — fall
      // through and create a fresh PaymentIntent rather than blocking
      // checkout on a Stripe-side lookup issue.
    }
  }

  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount: centsFromEur(order.total_eur),
      currency: "eur",
      application_fee_amount: centsFromEur(order.platform_fee_eur),
      transfer_data: { destination: sellerAccount.stripe_account_id },
      automatic_payment_methods: { enabled: true },
      metadata: { pinpals_order_id: String(order.id) },
    });
  } catch {
    return { error: GENERIC_ERROR };
  }

  const { error: updateError } = await admin
    .from("orders")
    .update({ payment_reference: paymentIntent.id, payment_status: "pending" })
    .eq("id", order.id)
    // Guard mirrors the DB-side guards in supabase/migrations/
    // 0021_payments.sql's apply_order_payment_*() functions: never downgrade
    // an order a webhook has already settled while this request was in
    // flight.
    .neq("payment_status", "paid");

  if (updateError) return { error: GENERIC_ERROR };

  return { clientSecret: paymentIntent.client_secret ?? undefined };
}
