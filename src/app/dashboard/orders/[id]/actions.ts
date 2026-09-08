"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import { centsFromEur } from "@/lib/stripe/payments";
import { isSellerPaymentReady, sellerOnboardingStatus } from "@/lib/stripe/connect";
import { ORDER_REPORT_CATEGORIES, parseEvidenceRefs, type ReportCategory } from "@/lib/admin/reports";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import type { Order, StripeConnectedAccount } from "@/lib/types";

export type CheckoutState = { error?: string; clientSecret?: string };
export type OrderActionState = { error?: string; success?: boolean };

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
    .select(
      "stripe_account_id, charges_enabled, payouts_enabled, details_submitted, requirements_currently_due, requirements_past_due, disabled_reason"
    )
    .eq("user_id", order.seller_id)
    .maybeSingle<
      Pick<
        StripeConnectedAccount,
        | "stripe_account_id"
        | "charges_enabled"
        | "payouts_enabled"
        | "details_submitted"
        | "requirements_currently_due"
        | "requirements_past_due"
        | "disabled_reason"
      >
    >();

  // Same "enabled" bar the publish gate already trusts
  // (isSellerPaymentReady()/sellerOnboardingStatus(), src/lib/stripe/
  // connect.ts) — not just charges_enabled. A seller can have charges_enabled
  // true while payouts_enabled is false (Stripe allows this transiently,
  // e.g. mid-review) or while a requirement is currently/past due; none of
  // those states should let a buyer start paying into a sale the seller
  // can't actually be paid out for.
  if (!sellerAccount || !isSellerPaymentReady(sellerOnboardingStatus(sellerAccount))) {
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
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: centsFromEur(order.total_eur),
        currency: "eur",
        application_fee_amount: centsFromEur(order.platform_fee_eur),
        transfer_data: { destination: sellerAccount.stripe_account_id },
        automatic_payment_methods: { enabled: true },
        metadata: { pinpals_order_id: String(order.id) },
      },
      // Stable per-order key (order.total_eur/platform_fee_eur are immutable
      // snapshots, so the request body is guaranteed identical on a retry) —
      // closes the gap between "no reusable existing PaymentIntent found
      // above" and "order.payment_reference written below": two concurrent
      // submits (a double-click, or a retried request) that both reach this
      // branch get back the SAME PaymentIntent from Stripe instead of two,
      // same idempotency discipline already used for refunds
      // (src/app/admin/orders/[id]/actions.ts).
      { idempotencyKey: `pinpals-order-${order.id}-create-pi` }
    );
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

// Same shape and reasoning as REPORT_MAX_ATTEMPTS in
// src/app/conversations/actions.ts — the moderation queue is a shared,
// limited-staff resource.
const REPORT_ORDER_MAX_ATTEMPTS = 10;
const REPORT_ORDER_WINDOW_SECONDS = 60 * 60;

/**
 * The order-page counterpart to reportListing()/reportConversation() — the
 * member-facing entry point for `target_type = 'order'`, which only became
 * a valid report target in 0055_marketplace_trust_safety.sql. Setting
 * `wants_refund` here is the entire "refund request" flow this phase's
 * spec asked for — deliberately NOT a parallel money-movement path: a
 * flagged report is what a finance-role staff member reviews and, if they
 * agree, actions through the existing requestOrderRefund() (see
 * src/app/admin/orders/[id]/actions.ts), which is what actually calls
 * Stripe. This action only ever writes a `reports` row.
 */
export async function reportOrderIssue(orderId: number, _prev: OrderActionState, formData: FormData): Promise<OrderActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rateLimit = await checkRateLimit({
    action: "report-order",
    identifier: user.id,
    maxHits: REPORT_ORDER_MAX_ATTEMPTS,
    windowSeconds: REPORT_ORDER_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const category = String(formData.get("category") ?? "") as ReportCategory;
  const description = String(formData.get("description") ?? "").trim();
  const evidenceRefs = parseEvidenceRefs(String(formData.get("evidence") ?? ""));
  const wantsRefund = formData.get("wantsRefund") === "true";

  if (!ORDER_REPORT_CATEGORIES.includes(category)) return { error: "Please choose a reason." };
  if (description.length > 4000) return { error: "Please keep the description under 4000 characters." };

  // RLS-scoped read (0019_orders.sql) — a non-party's query for this id
  // returns nothing, same participancy-check-then-service-role-insert shape
  // as reportConversation()/reportListing().
  const { data: order } = await supabase
    .from("orders")
    .select("id, buyer_id, seller_id")
    .eq("id", orderId)
    .maybeSingle<Pick<Order, "id" | "buyer_id" | "seller_id">>();
  if (!order || (order.buyer_id !== user.id && order.seller_id !== user.id)) {
    return { error: "Order not found." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("reports").insert({
    reporter_id: user.id,
    target_type: "order",
    target_id: String(orderId),
    category,
    description: description || null,
    evidence_refs: evidenceRefs.length ? evidenceRefs : null,
    wants_refund: wantsRefund,
  });

  if (error) return { error: "Couldn't file that report — please try again." };

  revalidatePath(`/dashboard/orders/${orderId}`);
  return { success: true };
}

/**
 * A buyer/seller's own view of whether their order has an active Stripe
 * dispute — `disputes` (0023_refunds_and_disputes.sql) has zero RLS read
 * access for anon/authenticated at all (it's a one-directional,
 * webhook-only table, deliberately), so this reads through the narrow
 * get_order_dispute_status() SECURITY DEFINER RPC added in
 * 0055_marketplace_trust_safety.sql instead — it returns just this order's
 * dispute status string (or null), scoped internally to the caller's own
 * buyer_id/seller_id, nothing else about the dispute.
 */
export async function getOrderDisputeStatus(orderId: number): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_order_dispute_status", { p_order_id: orderId });
  if (error) return null;
  return data ?? null;
}
