import type { InterestStatus, InviteStatus, OrderStatus, Payout, PaymentStatus, PayoutStatus, RefundStatus, WebhookEventStatus } from "@/lib/types";
import { INTEREST_STATUS_LABELS, INTEREST_STATUS_STYLES, STATUS_LABELS, STATUS_STYLES } from "@/lib/tee-times";

// `Listing["status"]` and `Offer["status"]` aren't strict unions in
// src/lib/types.ts, so these are keyed loosely and `statusLabel`/
// `statusStyle` fall back gracefully for anything unexpected rather than
// throwing — an admin table should never break because a status value it
// doesn't recognise yet showed up.
export const LISTING_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  reserved: "Sale agreed",
  sold: "Sold",
  removed: "Removed by admin",
};

export const LISTING_STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  reserved: "bg-cream-100 text-ink-900",
  sold: "bg-cream-100 text-ink-500",
  removed: "bg-red-100 text-red-600",
};

export const OFFER_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
};

export const OFFER_STATUS_STYLES: Record<string, string> = {
  pending: "bg-cream-100 text-ink-900",
  accepted: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-600",
};

// /admin/orders — three independent status dimensions (see
// supabase/migrations/0019_orders.sql). Unlike LISTING_STATUS_LABELS/
// OFFER_STATUS_LABELS above, these are keyed to the real OrderStatus/
// PaymentStatus/PayoutStatus unions since Order is a fully-typed column
// (src/lib/types.ts), not a loose string — but still routed through
// statusLabel()/statusStyle() everywhere they're rendered, same as the rest
// of this file, so an unrecognised value never breaks the page.
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const ORDER_STATUS_STYLES: Record<OrderStatus, string> = {
  pending: "bg-cream-100 text-ink-900",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-600",
  // Same gold treatment as REPORT_PRIORITY_STYLES.high (reports.ts) for the
  // one status in each map that's neither a plain "in progress" neutral nor
  // a clean green/red — a refund is a distinct outcome worth its own tone.
  refunded: "bg-gold-500/20 text-gold-700",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  pending: "Pending",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

export const PAYMENT_STATUS_STYLES: Record<PaymentStatus, string> = {
  unpaid: "bg-cream-100 text-ink-500",
  pending: "bg-cream-100 text-ink-900",
  paid: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-600",
  refunded: "bg-gold-500/20 text-gold-700",
};

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  not_started: "Not started",
  pending: "Pending",
  paid_out: "Paid out",
  held: "Held",
  // Set by apply_payout_reconciliation() (0024) when the payout that would
  // have paid this order out itself failed or was canceled by Stripe — see
  // that migration's comment. Distinct from Payout["status"]'s own "failed"
  // below: this is the order's view of it, that's the payout's.
  failed: "Payout failed",
};

export const PAYOUT_STATUS_STYLES: Record<PayoutStatus, string> = {
  not_started: "bg-cream-100 text-ink-500",
  pending: "bg-cream-100 text-ink-900",
  paid_out: "bg-green-100 text-green-800",
  held: "bg-red-100 text-red-600",
  failed: "bg-red-100 text-red-600",
};

// /admin/payouts/ledger — see supabase/migrations/0024_payouts.sql. Stripe's
// own Payout.status vocabulary, distinct from PAYOUT_STATUS_LABELS above
// (which describes orders.payout_status, an order's view of its own
// transfer/payout journey — this describes the payout object itself, the
// thing that actually aggregates many orders together).
export const PAYOUT_ROW_STATUS_LABELS: Record<Payout["status"], string> = {
  paid: "Paid",
  pending: "Pending",
  in_transit: "In transit",
  canceled: "Canceled",
  failed: "Failed",
};

export const PAYOUT_ROW_STATUS_STYLES: Record<Payout["status"], string> = {
  paid: "bg-green-100 text-green-800",
  pending: "bg-cream-100 text-ink-900",
  in_transit: "bg-cream-100 text-ink-900",
  canceled: "bg-red-100 text-red-600",
  failed: "bg-red-100 text-red-600",
};

/** The "failed & blocked" actionable-queue filter on /admin/payouts/ledger —
 * a payout Stripe itself reports as failed or canceled needs a human to look
 * at it (retry via Stripe, or the seller's own onboarding needs fixing);
 * pending/in_transit are just normal payouts still in flight. */
export const BLOCKED_PAYOUT_STATUSES: readonly Payout["status"][] = ["failed", "canceled"];

// /admin/webhook-events — see supabase/migrations/0021_payments.sql.
// 'received'/'processing' are both mid-flight (processing is reserved for a
// future async worker — nothing sets it today); 'processed'/'ignored' both
// mean "done, no action needed" but stay visually distinct so an admin
// scanning the queue can tell "this changed an order" apart from "this
// event type isn't handled" at a glance; 'failed' is the queue's whole
// reason to exist.
export const WEBHOOK_EVENT_STATUS_LABELS: Record<WebhookEventStatus, string> = {
  received: "Received",
  processing: "Processing",
  processed: "Processed",
  ignored: "Ignored",
  failed: "Failed",
};

export const WEBHOOK_EVENT_STATUS_STYLES: Record<WebhookEventStatus, string> = {
  received: "bg-cream-100 text-ink-900",
  processing: "bg-cream-100 text-ink-900",
  processed: "bg-green-100 text-green-800",
  ignored: "bg-cream-100 text-ink-500",
  failed: "bg-red-100 text-red-600",
};

// /admin/orders' refund history section — see
// supabase/migrations/0023_refunds_and_disputes.sql. Distinct from
// PAYMENT_STATUS_LABELS/ORDER_STATUS_LABELS above, which describe the
// order's own aggregate state; this describes one refund ATTEMPT.
export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  pending: "Pending",
  requires_action: "Requires action",
  succeeded: "Succeeded",
  failed: "Failed",
  canceled: "Canceled",
};

export const REFUND_STATUS_STYLES: Record<RefundStatus, string> = {
  pending: "bg-cream-100 text-ink-900",
  requires_action: "bg-cream-100 text-ink-900",
  succeeded: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-600",
  canceled: "bg-cream-100 text-ink-500",
};

// /admin/orders' disputes section. Dispute.status is Stripe's own string,
// not a closed union (see src/lib/types.ts's comment on why) — keyed
// loosely like LISTING_STATUS_STYLES/OFFER_STATUS_STYLES above, and always
// routed through statusLabel()/statusStyle() so an unrecognised future
// Stripe status still renders (as itself, with the neutral fallback style)
// rather than breaking the page.
export const DISPUTE_STATUS_LABELS: Record<string, string> = {
  warning_needs_response: "Needs response (early fraud warning)",
  warning_under_review: "Under review (early fraud warning)",
  warning_closed: "Closed (early fraud warning)",
  needs_response: "Needs response",
  under_review: "Under review",
  won: "Won",
  lost: "Lost",
  charge_refunded: "Charge refunded",
};

export const DISPUTE_STATUS_STYLES: Record<string, string> = {
  warning_needs_response: "bg-gold-500/20 text-gold-700",
  warning_under_review: "bg-cream-100 text-ink-900",
  warning_closed: "bg-cream-100 text-ink-500",
  needs_response: "bg-red-100 text-red-600",
  under_review: "bg-gold-500/20 text-gold-700",
  won: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-600",
  charge_refunded: "bg-cream-100 text-ink-500",
};

// Re-exported under admin-neutral names so admin pages have one place to
// import every status map from, without caring which ones happen to already
// live in src/lib/tee-times.ts.
export const INVITE_STATUS_LABELS: Record<InviteStatus, string> = STATUS_LABELS;
export const INVITE_STATUS_STYLES: Record<InviteStatus, string> = STATUS_STYLES;
export const INVITE_INTEREST_STATUS_LABELS: Record<InterestStatus, string> = INTEREST_STATUS_LABELS;
export const INVITE_INTEREST_STATUS_STYLES: Record<InterestStatus, string> = INTEREST_STATUS_STYLES;

const FALLBACK_STATUS_STYLE = "bg-cream-100 text-ink-900";

export function statusLabel(map: Record<string, string>, status: string): string {
  return map[status] ?? status;
}

export function statusStyle(map: Record<string, string>, status: string): string {
  return map[status] ?? FALLBACK_STATUS_STYLE;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function personName(person: { first_name: string; last_name: string } | null): string {
  if (!person) return "Unknown member";
  return `${person.first_name} ${person.last_name}`.trim();
}

/**
 * A member's *marketplace activity*, computed purely from their own
 * listings — whether they currently have anything for sale, have sold
 * before but nothing active now, or have never listed anything. Deliberately
 * separate from sellerAccountStatusLabel() in src/lib/format.ts: this says whether they're
 * listing items, that says whether Stripe will actually pay them for a sale
 * — a member can be an active seller here with no payout account at all, or
 * vice versa. Pure and DB-free — takes whatever listings the caller already
 * fetched rather than querying anything itself.
 */
export function sellerStatusLabel(listings: { status: string }[]): string {
  if (listings.length === 0) return "Not selling — no listings";
  const activeCount = listings.filter((l) => l.status === "active" || l.status === "reserved").length;
  if (activeCount > 0) {
    return `Active seller — ${activeCount} live ${activeCount === 1 ? "listing" : "listings"}`;
  }
  return "Inactive seller — no active listings";
}
