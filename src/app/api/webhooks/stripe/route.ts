import { NextResponse, type NextRequest } from "next/server";
import { getStripeClient } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimWebhookEvent, processStripeEvent } from "@/lib/stripe/payments";

// Stripe's one webhook endpoint for this app — account.updated (Connect
// onboarding/payout status changes), payment_intent.succeeded/
// payment_intent.payment_failed/charge.refunded/charge.succeeded
// (marketplace payment persistence), refund.updated/refund.failed and
// charge.dispute.* (refund/dispute administration, 0023), and
// payout.created/updated/paid/failed/canceled (finance payout
// reconciliation, 0024 — a Connect event, requires "Listen to events on
// connected accounts" enabled on this endpoint in the Stripe Dashboard, or
// it will never arrive here at all). This is the "authenticated Stripe
// webhook" half of the task's sync requirement; the other halves are the
// safe server-side retrieves in src/app/dashboard/payouts/return/route.ts
// and src/app/dashboard/orders/[id]/actions.ts.
//
// Authentication here is the signature check below, not a user session —
// Stripe calls this endpoint directly, unauthenticated in the app-session
// sense. STRIPE_WEBHOOK_SECRET is what makes constructEventAsync() reject
// anything not actually signed by Stripe with that endpoint's specific
// signing secret (set when the endpoint is registered in the Stripe
// dashboard — see the README for setup steps).
//
// Reads the raw request body via request.text() before anything parses it —
// required for signature verification to succeed, and safe by default here:
// unlike the old Pages Router, an App Router Route Handler never
// auto-parses a request body, so no bodyParser config is needed.
//
// Idempotency/retry-safety: every verified event is claimed in
// webhook_events (supabase/migrations/0021_payments.sql) BEFORE any effect
// runs — a redelivery of an event this app already finished processing
// short-circuits without re-running anything. See
// src/lib/stripe/payments.ts's processStripeEvent() for the actual routing
// and why a *business-logic* failure (no matching order, an amount
// mismatch) still returns 200 here rather than asking Stripe to retry a
// delivery that can never resolve itself on retry alone.
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    // Not a config error worth 500-ing on if the env var is simply unset in
    // an environment nobody's pointed a webhook at yet (e.g. a preview
    // deploy) — but also not a request Stripe itself would ever send
    // without a signature, so this is never a "legitimate event, oops".
    return NextResponse.json({ error: "Webhook not configured or unsigned request." }, { status: 400 });
  }

  const rawBody = await request.text();

  let event;
  try {
    const stripe = getStripeClient();
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch {
    // Never log the raw payload or signature here — an invalid signature is
    // exactly the situation where the body might not be a genuine Stripe
    // payload at all, and this shouldn't be a place that echoes untrusted
    // request content into logs.
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    const ledgerRow = await claimWebhookEvent(admin, {
      eventId: event.id,
      eventType: event.type,
      apiVersion: event.api_version ?? null,
      payload: event,
    });

    await processStripeEvent(admin, event, ledgerRow);
  } catch {
    // A genuine infrastructure failure (the ledger claim itself couldn't be
    // written, or a downstream write threw in a way processStripeEvent()
    // couldn't itself record) — never log the caught error's message here
    // for the same reason as the signature-verification catch above, and
    // return 5xx so Stripe's own retry schedule redelivers this event
    // later. A business-logic failure (no matching order, an amount
    // mismatch, an unhandled event type) is NOT this branch — those are
    // handled inside processStripeEvent(), recorded in the ledger, and
    // still fall through to the 200 below.
    return NextResponse.json({ error: "Failed to process webhook event." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
