import { NextResponse, type NextRequest } from "next/server";
import { getStripeClient } from "@/lib/stripe/client";
import { syncConnectedAccountFromStripe } from "@/lib/stripe/connect";

// Stripe's webhook endpoint for this app — currently handles only
// account.updated (Connect onboarding/payout status changes). This is the
// "authenticated Stripe webhook" half of the task's sync requirement; the
// other half is the safe server-side retrieve in
// src/app/dashboard/payouts/return/route.ts.
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

  if (event.type === "account.updated") {
    await syncConnectedAccountFromStripe(event.data.object);
  }

  // Every other event type is acknowledged, not rejected — this endpoint
  // only subscribes to account.updated in the Stripe dashboard, but
  // returning 200 for anything unrecognised (rather than erroring) is
  // Stripe's own recommended handling for events an endpoint doesn't act
  // on, and avoids pointless retries.
  return NextResponse.json({ received: true });
}
