import type Stripe from "stripe";
import type { Order, Refund } from "@/lib/types";

// Pure helpers for admin refund/dispute administration
// (src/app/admin/orders/[id]/actions.ts, src/lib/stripe/payments.ts's
// refund/dispute webhook handlers, src/app/admin/orders/[id]/page.tsx).
// Framework-free and DB-free by design, same reasoning as
// src/lib/stripe/connect.ts's mapStripeAccountToRow() — trivial to unit
// test without a real Stripe call. See refunds.test.ts.

/** Refund statuses that reserve their amount against an order's balance —
 * a 'pending'/'requires_action' refund isn't settled yet, but it must still
 * count against what's left to refund so two rapid admin clicks can't both
 * reserve the same euros before either one's Stripe call returns. Mirrors
 * the identical `status in (...)` list in
 * supabase/migrations/0023_refunds_and_disputes.sql's create_refund_request()
 * — kept here too so the admin UI can show the same "still refundable"
 * figure the DB will actually enforce, before the admin ever submits. */
const RESERVING_REFUND_STATUSES: ReadonlySet<Refund["status"]> = new Set([
  "pending",
  "requires_action",
  "succeeded",
]);

/**
 * How much of an order's total is still available to refund — the figure
 * the task requires showing an admin *before* they confirm a refund.
 * total_eur minus every refund row still reserving an amount (pending,
 * requires_action, or already succeeded); a failed/canceled attempt frees
 * its amount back up. Never goes negative (a defensive floor only — the DB
 * function is what actually enforces this on write).
 */
export function computeRefundableAmountEur(order: Pick<Order, "total_eur">, refunds: Pick<Refund, "amount_eur" | "status">[]): number {
  const reserved = refunds
    .filter((r) => RESERVING_REFUND_STATUSES.has(r.status))
    .reduce((sum, r) => sum + r.amount_eur, 0);
  const remaining = order.total_eur - reserved;
  return Math.max(0, Math.round(remaining * 100) / 100);
}

/** Whether an order is in a payment state a refund can even be attempted
 * against — mirrors create_refund_request()'s own guard so the UI can hide
 * the refund form entirely rather than let an admin submit and be told no. */
export function isOrderRefundable(order: Pick<Order, "payment_status" | "payment_reference">): boolean {
  return (order.payment_status === "paid" || order.payment_status === "refunded") && order.payment_reference != null;
}

/**
 * Stripe's own Refund.status values map 1:1 onto refunds.status (see the
 * migration's comment on why the column mirrors them rather than
 * collapsing them) — this just narrows the wider Stripe type down to the
 * exact set Pinpals' check constraint accepts, falling back to 'pending'
 * for anything unrecognised so a future Stripe SDK addition never causes a
 * runtime throw here (the DB's own check constraint is the real backstop).
 */
export function mapStripeRefundStatus(status: Stripe.Refund["status"]): Refund["status"] {
  switch (status) {
    case "pending":
    case "requires_action":
    case "succeeded":
    case "failed":
    case "canceled":
      return status;
    default:
      return "pending";
  }
}

/** Direct link into Stripe's own dispute tooling — the task's explicit
 * "links/references rather than attempting to replicate all Stripe dispute
 * tooling" requirement. `livemode` picks the matching dashboard host so an
 * admin working through a test-mode dispute doesn't land on a "not found"
 * page in live mode. */
export function stripeDisputeDashboardUrl(disputeId: string, livemode: boolean): string {
  return `https://dashboard.stripe.com/${livemode ? "" : "test/"}disputes/${disputeId}`;
}
