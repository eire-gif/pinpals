"use client";

import { useActionState, useState } from "react";
import PriceSummary from "@/components/price-summary";
import { makeOffer, type OfferFormState } from "./actions";

const initialState: OfferFormState = {};

export default function OfferForm({
  listingId,
  askingPrice,
}: {
  listingId: number;
  askingPrice: number;
}) {
  const makeOfferForListing = makeOffer.bind(null, listingId);
  const [state, formAction, pending] = useActionState(makeOfferForListing, initialState);
  const [amount, setAmount] = useState(askingPrice);

  if (state.success) {
    return (
      <div className="bg-green-100 text-green-800 rounded-xl px-4 py-3.5 text-sm font-semibold">
        Offer sent — the seller will accept or decline it, and you&rsquo;ll see the outcome here.
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
          min="1"
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
