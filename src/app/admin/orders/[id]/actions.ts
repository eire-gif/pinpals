"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { getStripeClient } from "@/lib/stripe/client";
import { centsFromEur, truncateErrorMessage } from "@/lib/stripe/payments";
import { computeRefundableAmountEur, isOrderRefundable, mapStripeRefundStatus, refundFailureMessage } from "@/lib/stripe/refunds";
import { notifyUser } from "@/lib/notifications-server";
import { formatPrice } from "@/lib/format";
import type { Order, Refund } from "@/lib/types";

export type RefundActionState = { error?: string; success?: boolean };

const REASON_MAX_LENGTH = 4000; // matches refunds.reason's own check constraint

function revalidateOrder(orderId: number) {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
}

/**
 * The finance-admin refund action: requestOrderRefund(). Every requirement
 * from the task maps to a specific step below —
 *
 *  - finance/admin only: requireStaff({ roles: FINANCE_ROLES }).
 *  - never trust a client-supplied payment id or amount: the order (and its
 *    payment_reference) is re-fetched here by orderId alone, and the amount
 *    is re-validated against the order's own actual refundable balance both
 *    here AND, authoritatively, inside create_refund_request() itself
 *    (row-locked — see supabase/migrations/0023_refunds_and_disputes.sql).
 *    The browser never supplies a payment/charge id at all.
 *  - refundable amount shown before confirmation: computeRefundableAmountEur()
 *    is what src/app/admin/orders/[id]/page.tsx renders into the form
 *    before this action ever runs.
 *  - reason + explicit confirmation: enforced by the form itself
 *    (src/components/admin/refund-form.tsx) — a required reason field, plus
 *    a distinct client-side "review, then confirm" step before this action
 *    is ever submitted.
 *  - Stripe mutation server-side only: stripe.refunds.create() below, never
 *    reachable from the browser.
 *  - fund allocation policy (confirmed, see claude/stripe-connect-business-
 *    model-decision.md): reverse_transfer: true claws back the seller's
 *    share of the refunded amount from their connected account;
 *    refund_application_fee is deliberately left unset — Pinpals keeps its
 *    own commission on a refunded sale. This can newly fail with Stripe's
 *    `balance_insufficient` error if the seller's own balance can't cover
 *    the claw-back — refundFailureMessage() (src/lib/stripe/refunds.ts)
 *    gives that case a specific, actionable message rather than the generic
 *    one.
 *  - idempotency: one idempotency key per request, generated here and
 *    stored on the refund row before the Stripe call, so a retried submit
 *    of the same click can't create two refunds.
 *  - Pinpals refund record linked to order/payment/Stripe ids: the
 *    `refunds` row itself (order_id, stripe_payment_intent_id,
 *    stripe_refund_id).
 *  - audit events for requested/succeeded/failed: recordAdminAction() calls
 *    below, at request time and again once Stripe's synchronous response is
 *    known. (A LATER async settlement, reconciled by the refund.updated/
 *    refund.failed webhook handlers in src/lib/stripe/payments.ts, updates
 *    the row's own status but does not write a second audit entry —
 *    admin_audit_log.actor_id is `not null references auth.users`, and a
 *    webhook has no admin actor to attribute one to. The refund's current
 *    status is always visible in its own row, in the order's refund
 *    history section.)
 */
export async function requestOrderRefund(_prev: RefundActionState, formData: FormData): Promise<RefundActionState> {
  const { user, staff } = await requireStaff({ roles: FINANCE_ROLES });

  const orderId = Number(formData.get("orderId"));
  if (!orderId || Number.isNaN(orderId)) return { error: "Missing order." };

  const amountEur = Number(formData.get("amountEur"));
  if (!Number.isFinite(amountEur) || amountEur <= 0) return { error: "Enter a valid refund amount." };

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "A reason is required." };
  if (reason.length > REASON_MAX_LENGTH) return { error: "Reason is too long." };

  const admin = createAdminClient();

  // Re-fetched by orderId alone — the form never supplies (and this action
  // never trusts) a payment intent, charge, or refund id from the client.
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle<Order>();
  if (orderError || !order) return { error: "Order not found." };
  if (!isOrderRefundable(order)) {
    return { error: "This order isn't in a refundable payment state." };
  }

  const { data: existingRefunds } = await admin
    .from("refunds")
    .select("amount_eur, status")
    .eq("order_id", orderId)
    .returns<Pick<Refund, "amount_eur" | "status">[]>();

  const refundable = computeRefundableAmountEur(order, existingRefunds ?? []);
  if (amountEur > refundable) {
    return { error: `That's more than the ${refundable.toFixed(2)} still refundable on this order.` };
  }

  const idempotencyKey = crypto.randomUUID();

  // Authoritative validation happens here, inside a single locked
  // transaction (see the migration) — the checks above are only a
  // friendlier pre-flight so a losing race gets a clear message instead of
  // a raw Postgres error.
  const { data: created, error: createError } = await admin.rpc("create_refund_request", {
    p_order_id: orderId,
    p_amount_eur: amountEur,
    p_reason: reason,
    p_requested_by: user.id,
    p_idempotency_key: idempotencyKey,
  });

  const refund = (created as Refund[] | null)?.[0] ?? null;
  if (createError || !refund) {
    return { error: "Someone may have just refunded this order — refresh and try again." };
  }

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "refund.requested",
    targetType: "order",
    targetId: orderId,
    reason,
    outcome: "success",
    metadata: { refundId: refund.id, amountEur },
  });

  // Never the admin's own reason text — that's an internal note, not
  // something to surface to the two members involved.
  for (const userId of [order.buyer_id, order.seller_id]) {
    await notifyUser(admin, {
      userId,
      type: "refund_requested",
      title: "Refund requested",
      body: `A refund of ${formatPrice(amountEur)} for "${order.listing_title}" has been requested and is being processed.`,
      href: `/dashboard/orders/${orderId}`,
      data: { orderId },
      dedupeKey: `refund:${refund.id}:refund_requested:${userId}`,
    });
  }

  const stripe = getStripeClient();
  let stripeRefund;
  try {
    stripeRefund = await stripe.refunds.create(
      {
        payment_intent: order.payment_reference!,
        amount: centsFromEur(amountEur),
        // Pinpals' confirmed refund/fee allocation policy (see
        // claude/stripe-connect-business-model-decision.md): claw back the
        // seller's share of a refunded sale, keep Pinpals' own commission.
        // reverse_transfer reverses the transfer to the seller's connected
        // account proportionally to the amount refunded (full or partial);
        // refund_application_fee is deliberately left unset/false — Pinpals
        // does not refund its own fee. Both params require the caller to be
        // the platform that created the destination charge, which this
        // action always is (stripe.refunds.create() below runs only
        // server-side, under the platform's own secret key).
        reverse_transfer: true,
        metadata: { pinpals_order_id: String(orderId), pinpals_refund_id: String(refund.id) },
      },
      { idempotencyKey }
    );
  } catch (err) {
    const message = truncateErrorMessage(err instanceof Error ? err.message : null);
    await admin.rpc("mark_refund_outcome", {
      p_refund_id: refund.id,
      p_stripe_refund_id: null,
      p_status: "failed",
      p_failure_reason: message,
    });
    await recordAdminAction({
      actor: { id: user.id, role: staff.role },
      action: "refund.failed",
      targetType: "order",
      targetId: orderId,
      reason,
      outcome: "failure",
      metadata: { refundId: refund.id, amountEur, error: message },
    });
    for (const userId of [order.buyer_id, order.seller_id]) {
      await notifyUser(admin, {
        userId,
        type: "refund_failed",
        title: "Refund could not be completed",
        body: `A refund of ${formatPrice(amountEur)} for "${order.listing_title}" could not be completed — our team has been notified.`,
        href: `/dashboard/orders/${orderId}`,
        data: { orderId },
        dedupeKey: `refund:${refund.id}:refund_failed:${userId}`,
      });
    }
    revalidateOrder(orderId);
    return { error: refundFailureMessage(err) };
  }

  const finalStatus = mapStripeRefundStatus(stripeRefund.status);
  await admin.rpc("mark_refund_outcome", {
    p_refund_id: refund.id,
    p_stripe_refund_id: stripeRefund.id,
    p_status: finalStatus,
    p_failure_reason: truncateErrorMessage(stripeRefund.failure_reason ?? null),
  });

  // Only a definitively-settled synchronous response gets a second audit
  // entry here. 'pending'/'requires_action' (some non-card payment methods
  // don't settle a refund synchronously) leave the trail at "requested"
  // until the refund.updated/refund.failed webhook reconciles the row's
  // status — see handleRefundReconciliation()'s own comment in
  // src/lib/stripe/payments.ts for why that reconciliation doesn't add a
  // second audit entry of its own.
  if (finalStatus === "succeeded" || finalStatus === "failed") {
    await recordAdminAction({
      actor: { id: user.id, role: staff.role },
      action: finalStatus === "failed" ? "refund.failed" : "refund.completed",
      targetType: "order",
      targetId: orderId,
      reason,
      outcome: finalStatus === "failed" ? "failure" : "success",
      metadata: { refundId: refund.id, amountEur, stripeRefundId: stripeRefund.id, status: finalStatus },
    });
    const succeeded = finalStatus === "succeeded";
    for (const userId of [order.buyer_id, order.seller_id]) {
      await notifyUser(admin, {
        userId,
        type: succeeded ? "refund_succeeded" : "refund_failed",
        title: succeeded ? "Refund processed" : "Refund could not be completed",
        body: succeeded
          ? `A refund of ${formatPrice(amountEur)} for "${order.listing_title}" has been processed.`
          : `A refund of ${formatPrice(amountEur)} for "${order.listing_title}" could not be completed — our team has been notified.`,
        href: `/dashboard/orders/${orderId}`,
        data: { orderId },
        dedupeKey: `refund:${refund.id}:${succeeded ? "refund_succeeded" : "refund_failed"}:${userId}`,
      });
    }
  }

  revalidateOrder(orderId);
  return { success: true };
}
