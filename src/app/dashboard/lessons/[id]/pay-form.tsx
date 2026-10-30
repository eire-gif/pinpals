"use client";

import { GOLD_BUTTON } from "@/components/marketplace/buy-styles";
import { useActionState, useMemo, useState, type FormEvent } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { startLessonPayment, type LessonCheckoutState } from "./actions";

const initialState: LessonCheckoutState = {};
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

/**
 * Paying for a lesson (0204): the same two steps as an order's PayForm — the
 * server makes the PaymentIntent from the booking row, then Stripe's own
 * Payment Element takes the card. Card details never reach PinPals.
 */
export default function LessonPayForm({ bookingId, label, returnPath }: { bookingId: number; label: string; returnPath: string }) {
  const [state, formAction, pending] = useActionState(startLessonPayment, initialState);
  const stripePromise = useMemo(() => (publishableKey ? loadStripe(publishableKey) : null), []);

  if (!publishableKey) return <p className="text-xs text-ink-500">Card payments aren&apos;t set up yet. Check back soon.</p>;

  if (state.clientSecret) {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret: state.clientSecret }}>
        <ConfirmForm label={label} returnPath={returnPath} />
      </Elements>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${GOLD_BUTTON} w-full`}>
        {pending ? "Starting…" : label}
      </button>
    </form>
  );
}

function ConfirmForm({ label, returnPath }: { label: string; returnPath: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}${returnPath}` },
    });
    if (confirmError) {
      setError(confirmError.message ?? "The payment didn't go through. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <PaymentElement />
      {error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3 py-2">{error}</p>}
      <button type="submit" disabled={!stripe || submitting} className={`${GOLD_BUTTON} w-full`}>
        {submitting ? "Paying…" : label}
      </button>
    </form>
  );
}
