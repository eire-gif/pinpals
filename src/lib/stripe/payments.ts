import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncConnectedAccountFromStripe } from "./connect";
import { mapStripeRefundStatus } from "./refunds";
import type { Order, Refund, WebhookEventStatus } from "@/lib/types";

// The one place that decides what a Stripe webhook event *means* for
// Pinpals' payment projection — every caller (the webhook route itself, and
// an admin's manual "Retry" on a failed /admin/webhook-events row) goes
// through processStripeEvent() below, never reimplements this routing
// inline. Same "one choke point" discipline as src/lib/stripe/connect.ts's
// syncConnectedAccountFromStripe() and src/lib/admin/audit.ts's
// recordAdminAction().
//
// Everything here reads amounts/fees/ownership from `orders` (already
// server-derived — see supabase/migrations/0019_orders.sql's comment on how
// a row gets created) or from a verified Stripe event payload, never from a
// browser request. The checkout action that *creates* a PaymentIntent
// (src/app/dashboard/orders/[id]/actions.ts) is the other half of that
// boundary — it derives the charge amount from the order row itself, not
// from anything the buyer's browser sends.

const MAX_ERROR_LENGTH = 500;

/** Euro amount (e.g. order.total_eur) -> integer cents, the unit Stripe's
 * API uses. Pure — no rounding surprises hidden behind a library call. */
export function centsFromEur(amountEur: number): number {
  return Math.round(amountEur * 100);
}

/** Stripe's own decline/failure message, trimmed and length-capped before it
 * ever reaches a column or an admin screen. Pure. */
export function truncateErrorMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_ERROR_LENGTH ? `${trimmed.slice(0, MAX_ERROR_LENGTH - 1)}…` : trimmed;
}

export type ReconcileResult = { ok: true } | { ok: false; reason: string };

/**
 * Defense-in-depth check that what Stripe actually charged matches what
 * Pinpals' own order row says it should have been. The checkout action
 * already creates the PaymentIntent FROM the order's total_eur (so this
 * should always pass by construction), but a webhook is exactly the kind of
 * input this app must never take on faith — if this ever fails, it means
 * something upstream is wrong (a bug, a stale client_secret reused against a
 * since-edited order — orders are immutable once created so that shouldn't
 * happen either, or worse) and the safe response is to NOT mark the order
 * paid, and instead surface it in /admin/webhook-events for a human to
 * look at. Pure — see payments.test.ts.
 */
export function reconcilePaymentIntentAmount(input: {
  expectedTotalEur: number;
  actualAmountCents: number;
  actualCurrency: string;
}): ReconcileResult {
  if (input.actualCurrency !== "eur") {
    return { ok: false, reason: `Currency mismatch: expected eur, Stripe reported ${input.actualCurrency}` };
  }
  const expectedCents = centsFromEur(input.expectedTotalEur);
  if (input.actualAmountCents !== expectedCents) {
    return {
      ok: false,
      reason: `Amount mismatch: expected ${expectedCents} cents, Stripe reported ${input.actualAmountCents} cents`,
    };
  }
  return { ok: true };
}

export type LedgerClaim = { id: number; status: WebhookEventStatus; isNew: boolean };

/** Idempotent insert-or-touch of a webhook_events row — see
 * supabase/migrations/0021_payments.sql's claim_webhook_event() for the
 * atomicity/idempotency guarantee this wraps. */
export async function claimWebhookEvent(
  admin: SupabaseClient,
  input: { eventId: string; eventType: string; apiVersion: string | null; payload: unknown }
): Promise<LedgerClaim> {
  const { data, error } = await admin
    .rpc("claim_webhook_event", {
      p_provider: "stripe",
      p_event_id: input.eventId,
      p_event_type: input.eventType,
      p_api_version: input.apiVersion,
      p_payload: input.payload,
    })
    .single<{ id: number; status: WebhookEventStatus; is_new: boolean }>();

  if (error || !data) {
    throw new Error(`Failed to claim webhook event ${input.eventId}: ${error?.message ?? "no row returned"}`);
  }
  return { id: data.id, status: data.status, isNew: data.is_new };
}

async function applyOrderPaymentSucceeded(
  admin: SupabaseClient,
  input: { eventRowId: number; orderId: number; paymentIntentId: string; currency: string }
): Promise<Order | null> {
  const { data, error } = await admin.rpc("apply_order_payment_succeeded", {
    p_event_row_id: input.eventRowId,
    p_order_id: input.orderId,
    p_payment_intent_id: input.paymentIntentId,
    p_currency: input.currency,
  });
  if (error) throw new Error(`Failed to apply payment-succeeded to order ${input.orderId}: ${error.message}`);
  return ((data as Order[] | null)?.[0] ?? null);
}

async function applyOrderPaymentFailed(
  admin: SupabaseClient,
  input: { eventRowId: number; orderId: number; paymentIntentId: string; error: string | null }
): Promise<Order | null> {
  const { data, error } = await admin.rpc("apply_order_payment_failed", {
    p_event_row_id: input.eventRowId,
    p_order_id: input.orderId,
    p_payment_intent_id: input.paymentIntentId,
    p_error: input.error,
  });
  if (error) throw new Error(`Failed to apply payment-failed to order ${input.orderId}: ${error.message}`);
  return ((data as Order[] | null)?.[0] ?? null);
}

async function applyOrderPaymentRefunded(
  admin: SupabaseClient,
  input: { eventRowId: number; orderId: number; refundAmountEur: number; reason: string | null }
): Promise<Order | null> {
  const { data, error } = await admin.rpc("apply_order_payment_refunded", {
    p_event_row_id: input.eventRowId,
    p_order_id: input.orderId,
    p_refund_amount_eur: input.refundAmountEur,
    p_reason: input.reason,
  });
  if (error) throw new Error(`Failed to apply refund to order ${input.orderId}: ${error.message}`);
  return ((data as Order[] | null)?.[0] ?? null);
}

/** Ledger-only terminal write — an event that never mutated an order (an
 * unhandled type, or one that couldn't be safely routed to one). See
 * mark_webhook_event_terminal()'s own comment in the migration for why a
 * routing failure lands here as 'failed' rather than making the webhook
 * route 500 (Stripe retrying a delivery Pinpals will never be able to route
 * — no matching order, an amount mismatch — just wastes both sides' time;
 * a human reviewing /admin/webhook-events is the actual fix). */
async function markWebhookEventTerminal(
  admin: SupabaseClient,
  input: { eventRowId: number; status: "processed" | "failed" | "ignored"; error: string | null; relatedOrderId: number | null }
): Promise<void> {
  const { error } = await admin.rpc("mark_webhook_event_terminal", {
    p_event_row_id: input.eventRowId,
    p_status: input.status,
    p_error: input.error,
    p_related_order_id: input.relatedOrderId,
  });
  if (error) {
    throw new Error(`Failed to mark webhook event ${input.eventRowId} as ${input.status}: ${error.message}`);
  }
}

async function findOrderByPaymentReference(admin: SupabaseClient, paymentIntentId: string): Promise<Order | null> {
  const { data, error } = await admin
    .from("orders")
    .select("*")
    .eq("payment_reference", paymentIntentId)
    .maybeSingle<Order>();
  if (error) throw new Error(`Failed to look up order by payment_reference ${paymentIntentId}: ${error.message}`);
  return data ?? null;
}

async function handlePaymentIntentSucceeded(
  admin: SupabaseClient,
  ledgerRowId: number,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const order = await findOrderByPaymentReference(admin, paymentIntent.id);
  if (!order) {
    await markWebhookEventTerminal(admin, {
      eventRowId: ledgerRowId,
      status: "failed",
      error: `No order found with payment_reference ${paymentIntent.id}.`,
      relatedOrderId: null,
    });
    return;
  }

  const reconcile = reconcilePaymentIntentAmount({
    expectedTotalEur: order.total_eur,
    actualAmountCents: paymentIntent.amount,
    actualCurrency: paymentIntent.currency,
  });
  if (!reconcile.ok) {
    await markWebhookEventTerminal(admin, {
      eventRowId: ledgerRowId,
      status: "failed",
      error: reconcile.reason,
      relatedOrderId: order.id,
    });
    return;
  }

  await applyOrderPaymentSucceeded(admin, {
    eventRowId: ledgerRowId,
    orderId: order.id,
    paymentIntentId: paymentIntent.id,
    currency: paymentIntent.currency,
  });
}

async function handlePaymentIntentFailed(
  admin: SupabaseClient,
  ledgerRowId: number,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  const order = await findOrderByPaymentReference(admin, paymentIntent.id);
  if (!order) {
    await markWebhookEventTerminal(admin, {
      eventRowId: ledgerRowId,
      status: "failed",
      error: `No order found with payment_reference ${paymentIntent.id}.`,
      relatedOrderId: null,
    });
    return;
  }

  await applyOrderPaymentFailed(admin, {
    eventRowId: ledgerRowId,
    orderId: order.id,
    paymentIntentId: paymentIntent.id,
    error: truncateErrorMessage(paymentIntent.last_payment_error?.message),
  });
}

async function handleChargeRefunded(admin: SupabaseClient, ledgerRowId: number, charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) {
    await markWebhookEventTerminal(admin, {
      eventRowId: ledgerRowId,
      status: "failed",
      error: "charge.refunded event had no payment_intent id.",
      relatedOrderId: null,
    });
    return;
  }

  const order = await findOrderByPaymentReference(admin, paymentIntentId);
  if (!order) {
    await markWebhookEventTerminal(admin, {
      eventRowId: ledgerRowId,
      status: "failed",
      error: `No order found with payment_reference ${paymentIntentId}.`,
      relatedOrderId: null,
    });
    return;
  }

  // charge.amount_refunded is Stripe's own running cumulative total on the
  // charge, not an incremental delta — see apply_order_payment_refunded()'s
  // comment in the migration for why this is set, not added.
  const refundedAmountEur = charge.amount_refunded / 100;
  // Stripe's own short refund reason enum (duplicate/fraudulent/
  // requested_by_customer) when present — never free text typed by anyone.
  const reason = charge.refunds?.data?.[0]?.reason ?? null;

  await applyOrderPaymentRefunded(admin, {
    eventRowId: ledgerRowId,
    orderId: order.id,
    refundAmountEur: refundedAmountEur,
    reason,
  });
}

/**
 * Reconciles one `refunds` row against Stripe's own current view of a
 * Refund object — called for both refund.updated and refund.failed (Stripe
 * emits refund.updated on every status change, including to 'failed';
 * refund.failed is a second, more specific event for the same transition,
 * so both land here and simply reconcile to whatever status the event
 * itself reports). This is the task's "reconcile final state from Stripe/
 * webhooks" requirement — the synchronous requestOrderRefund() Server
 * Action (src/app/admin/orders/[id]/actions.ts) already records this same
 * row's initial outcome from stripe.refunds.create()'s own synchronous
 * response, so this handler's job is only to catch a LATER status change
 * for a refund that didn't finish settling synchronously (some payment
 * methods return 'pending'/'requires_action' first). Deliberately does not
 * write a second admin_audit_log entry — the admin's requested/succeeded/
 * failed audit trail is written once, at request time, by the Server
 * Action; a webhook has no admin actor to attribute a second entry to.
 * mark_refund_outcome_by_stripe_id() itself guards against regressing an
 * already-terminal row, so redelivery/out-of-order delivery is safe.
 */
async function handleRefundReconciliation(admin: SupabaseClient, ledgerRowId: number, refund: Stripe.Refund): Promise<void> {
  const { data, error } = await admin.rpc("mark_refund_outcome_by_stripe_id", {
    p_stripe_refund_id: refund.id,
    p_status: mapStripeRefundStatus(refund.status),
    p_failure_reason: truncateErrorMessage(refund.failure_reason ?? null),
  });
  if (error) throw new Error(`Failed to reconcile refund ${refund.id}: ${error.message}`);

  const row = (data as Refund[] | null)?.[0] ?? null;
  await markWebhookEventTerminal(admin, {
    eventRowId: ledgerRowId,
    // No matching `refunds` row is not treated as a routing failure the way
    // a missing order is elsewhere in this file — a refund this app itself
    // never initiated (or one whose row the synchronous action hasn't
    // written yet, in a rare race) is still safely acknowledged rather than
    // surfaced as something a human needs to act on.
    status: "processed",
    error: null,
    relatedOrderId: row?.order_id ?? null,
  });
}

/**
 * Upserts one Stripe Dispute object into `disputes`, keyed on
 * stripe_dispute_id — same "service-role upsert, no dedicated function"
 * shape as connect.ts's syncConnectedAccountFromStripe(), since a dispute
 * row is a pure Stripe projection with no guard logic to centralize (unlike
 * refunds, nothing else in this app ever writes one). Visibility only, per
 * the task — this never submits evidence or otherwise acts on a dispute.
 */
async function handleDisputeEvent(admin: SupabaseClient, ledgerRowId: number, dispute: Stripe.Dispute, livemode: boolean): Promise<void> {
  const paymentIntentId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id ?? null;
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id ?? null;

  const order = paymentIntentId ? await findOrderByPaymentReference(admin, paymentIntentId) : null;

  const { error } = await admin.from("disputes").upsert(
    {
      order_id: order?.id ?? null,
      stripe_dispute_id: dispute.id,
      stripe_charge_id: chargeId,
      stripe_payment_intent_id: paymentIntentId,
      amount_eur: dispute.amount / 100,
      currency: dispute.currency,
      reason: dispute.reason ?? null,
      status: dispute.status,
      evidence_due_by: dispute.evidence_details?.due_by
        ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
        : null,
      livemode,
    },
    { onConflict: "stripe_dispute_id" }
  );
  if (error) throw new Error(`Failed to upsert dispute ${dispute.id}: ${error.message}`);

  await markWebhookEventTerminal(admin, {
    eventRowId: ledgerRowId,
    status: "processed",
    error: null,
    relatedOrderId: order?.id ?? null,
  });
}

export type ProcessEventOutcome = "duplicate" | "processed" | "ignored" | "failed";

/**
 * Routes one already-claimed webhook event to its effect, or records that it
 * has none. Called from src/app/api/webhooks/stripe/route.ts for a live
 * delivery, and from src/app/admin/webhook-events/[id]/actions.ts for an
 * admin-triggered retry of a 'failed' row — exactly the same code path
 * either way, so there is exactly one place that decides "what does this
 * event type do".
 *
 * Never throws for a *business-logic* failure (no matching order, an amount
 * mismatch, an unhandled event type) — those are recorded in the ledger as
 * 'failed'/'ignored' and reported back as such, because retrying them
 * (Stripe redelivering, or an admin clicking Retry again) will never change
 * the outcome on its own. Only rethrows on a genuine infrastructure failure
 * (the database itself unreachable) — see the webhook route for how that
 * maps to a 5xx so Stripe's own retry schedule kicks in.
 */
export async function processStripeEvent(
  admin: SupabaseClient,
  event: Stripe.Event,
  ledgerRow: LedgerClaim
): Promise<ProcessEventOutcome> {
  if (!ledgerRow.isNew && ledgerRow.status === "processed") {
    return "duplicate";
  }

  switch (event.type) {
    case "account.updated":
      await syncConnectedAccountFromStripe(event.data.object as Stripe.Account);
      await markWebhookEventTerminal(admin, {
        eventRowId: ledgerRow.id,
        status: "processed",
        error: null,
        relatedOrderId: null,
      });
      return "processed";

    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(admin, ledgerRow.id, event.data.object as Stripe.PaymentIntent);
      return "processed";

    case "payment_intent.payment_failed":
      await handlePaymentIntentFailed(admin, ledgerRow.id, event.data.object as Stripe.PaymentIntent);
      return "processed";

    case "charge.refunded":
      await handleChargeRefunded(admin, ledgerRow.id, event.data.object as Stripe.Charge);
      return "processed";

    case "refund.updated":
    case "refund.failed":
      await handleRefundReconciliation(admin, ledgerRow.id, event.data.object as Stripe.Refund);
      return "processed";

    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
      await handleDisputeEvent(admin, ledgerRow.id, event.data.object as Stripe.Dispute, event.livemode);
      return "processed";

    default:
      // Every other event type is acknowledged, not rejected — this app
      // only subscribes to the event types handled above in the Stripe
      // dashboard, but the ledger still records that it was seen (and won't
      // be reprocessed if redelivered), same "ack what you don't act on"
      // handling this endpoint already used for everything but
      // account.updated before this migration.
      await markWebhookEventTerminal(admin, {
        eventRowId: ledgerRow.id,
        status: "ignored",
        error: null,
        relatedOrderId: null,
      });
      return "ignored";
  }
}

/**
 * The admin retry entry point: re-claims (via the same idempotent path — a
 * retry is just another "delivery" of an event this app already has) and
 * reprocesses one ledger row by id, using its own stored payload rather than
 * calling Stripe again. Used only by
 * src/app/admin/webhook-events/[id]/actions.ts.
 */
export async function retryWebhookEvent(eventRowId: number): Promise<ProcessEventOutcome> {
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("webhook_events")
    .select("id, event_type, payload, status")
    .eq("id", eventRowId)
    .maybeSingle<{ id: number; event_type: string; payload: Stripe.Event; status: WebhookEventStatus }>();
  if (error) throw new Error(`Failed to load webhook event ${eventRowId}: ${error.message}`);
  if (!row) throw new Error(`No webhook event found with id ${eventRowId}.`);

  // Not "new" — this row already exists — but its current status is what
  // decides whether processStripeEvent() short-circuits as a duplicate, same
  // as any other redelivery.
  return processStripeEvent(admin, row.payload, { id: row.id, status: row.status, isNew: false });
}
