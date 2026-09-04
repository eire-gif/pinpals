"use client";

import { useActionState, useMemo, useState, type FormEvent } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { createOrderPaymentIntent, type CheckoutState } from "./actions";

const initialState: CheckoutState = {};

// Publishable key — safe to ship to the browser by design (it can only
// create PaymentIntents/confirm payments the server already authorized, not
// move money on its own). Never the secret key: that stays server-only in
// src/lib/stripe/client.ts. Card details themselves are collected by
// Stripe's own PaymentElement below, inside an iframe Stripe controls —
// Pinpals' own code never sees a card number, which is what "do not store
// card details" actually requires here, not just an absence of a `cards`
// table.
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

/**
 * The buyer-facing "Pay now" step for one unpaid/failed order. Two stages:
 * (1) a plain button that calls createOrderPaymentIntent() to get a
 * client_secret for an amount/fee/destination the *server* computed from
 * this order's own row, and (2) once that secret exists, Stripe's own
 * Payment Element mounted via <Elements>, confirmed client-side with
 * stripe.confirmPayment() — the actual card entry never touches this app's
 * server at all.
 */
export default function PayForm({ orderId, returnPath }: { orderId: number; returnPath: string }) {
  const [state, formAction, pending] = useActionState(createOrderPaymentIntent, initialState);
  const stripePromise = useMemo(() => (publishableKey ? loadStripe(publishableKey) : null), []);

  if (!publishableKey) {
    return <p className="text-xs text-ink-500">Card payments aren&apos;t configured yet — check back soon.</p>;
  }

  if (state.clientSecret) {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret: state.clientSecret }}>
        <ConfirmForm returnPath={returnPath} />
      </Elements>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      {state.error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
      >
        {pending ? "Starting checkout…" : "Pay now"}
      </button>
    </form>
  );
}

function ConfirmForm({ returnPath }: { returnPath: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    // A successful confirmation navigates the browser away to return_url
    // itself (redirect-based payment methods require this) — this call only
    // ever returns here for an immediate, pre-redirect failure (e.g. a
    // synchronously-declined card). The order's own payment_status catches
    // up via the account.updated-style webhook flow
    // (payment_intent.succeeded — see src/lib/stripe/payments.ts), not
    // anything this component writes itself.
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}${returnPath}` },
    });

    if (confirmError) {
      setError(confirmError.message ?? "Payment couldn't be confirmed — please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <PaymentElement />
      {error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="self-start px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
      >
        {submitting ? "Processing…" : "Confirm payment"}
      </button>
    </form>
  );
}
