"use client";

import { useActionState, useEffect, useState } from "react";
import PriceSummary from "@/components/price-summary";
import { OFFER_EXPIRY_HOURS } from "@/lib/marketplace";
import { createOffer, type OfferFormState } from "./actions";

const initialState: OfferFormState = {};

/**
 * The buyer-facing half of the offer sheet/modal (see ./offer-sheet.tsx,
 * which wraps this in the actual dialog chrome) — a plain insert into
 * `offers`, validated for real by prepare_and_validate_offer()
 * (supabase/migrations/0048_marketplace_offer_workflow.sql). `onSent` lets
 * the wrapping sheet close itself once the offer is actually in, rather
 * than this component owning any modal-visibility state of its own.
 */
export default function OfferForm({
  listingId,
  askingPrice,
  minAmount,
  onSent,
}: {
  listingId: number;
  askingPrice: number;
  minAmount: number;
  onSent?: () => void;
}) {
  const createOfferForListing = createOffer.bind(null, listingId);
  const [state, formAction, pending] = useActionState(createOfferForListing, initialState);
  const [amount, setAmount] = useState(Math.max(minAmount, Math.round(askingPrice * 0.9)));

  // Effect, not a call during render: this fires once, right after the
  // success state actually commits, so the wrapping sheet (offer-sheet.tsx)
  // can close itself without this component reaching into React's render
  // phase to trigger a parent state update.
  useEffect(() => {
    if (state.success) onSent?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  if (state.success) {
    return (
      <div className="bg-green-100 text-green-800 rounded-xl px-4 py-3.5 text-sm font-semibold">
        Offer sent — it&rsquo;s good for {OFFER_EXPIRY_HOURS} hours. The seller can accept, decline or counter it,
        and you&rsquo;ll see the outcome here.
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="amount" className="text-[13.5px] font-bold">Your offer (EUR)</label>
        <input
          id="amount"
          name="amount"
          type="number"
          step="1"
          min={minAmount}
          max={Math.max(minAmount, askingPrice - 1)}
          required
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600"
        />
        <span className="text-xs text-ink-500">Asking price is {askingPrice} &mdash; you can offer less.</span>
      </div>

      <PriceSummary amountEur={amount > 0 ? amount : 0} />

      {state.error && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Sending offer…" : "Make offer"}
      </button>
    </form>
  );
}
