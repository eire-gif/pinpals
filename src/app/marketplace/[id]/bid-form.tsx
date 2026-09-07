"use client";

import { useActionState, useState } from "react";
import { formatPriceCents } from "@/lib/format";
import { centsToEur } from "@/lib/marketplace";
import { placeBid, type BidFormState } from "./actions";

const initialState: BidFormState = {};

/**
 * The bidding form for an auction/auction_with_buy_now listing — this
 * phase's spec: "show current bid, minimum next bid and exact closing
 * time" for an auction's primary action. `minimumNextBidCents` is only ever
 * a hint (see nextMinimumBidCents() in src/lib/marketplace.ts and the
 * comment on placeBid() itself) — the trigger backing the actual insert is
 * what's really enforced, so a bid this form would have rejected client-
 * side but that slipped through (a stale page, a race with another bidder)
 * still gets a correct, friendly rejection from the server, and a bid this
 * form allowed can still be rejected if someone else's bid landed first.
 */
export default function BidForm({
  listingId,
  auctionId,
  currentBidCents,
  minimumNextBidCents,
  closesAtLabel,
}: {
  listingId: number;
  auctionId: number;
  currentBidCents: number;
  minimumNextBidCents: number;
  closesAtLabel: string;
}) {
  const placeBidForListing = placeBid.bind(null, listingId, auctionId);
  const [state, formAction, pending] = useActionState(placeBidForListing, initialState);
  const [amount, setAmount] = useState(centsToEur(minimumNextBidCents));

  if (state.success) {
    return (
      <div className="bg-green-100 text-green-800 rounded-xl px-4 py-3.5 text-sm font-semibold">
        Bid placed — you&rsquo;re currently winning unless someone bids higher before it closes.
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-ink-500">Current bid</div>
          <div className="font-display font-bold text-lg text-gold-600">{formatPriceCents(currentBidCents)}</div>
        </div>
        <div>
          <div className="text-xs text-ink-500">Closes</div>
          <div className="font-semibold">{closesAtLabel}</div>
        </div>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="amount" className="text-[13.5px] font-bold">
          Your bid (EUR)
        </label>
        <input
          id="amount"
          name="amount"
          type="number"
          step="1"
          min={centsToEur(minimumNextBidCents)}
          required
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600"
        />
        <span className="text-xs text-ink-500">Minimum next bid is {formatPriceCents(minimumNextBidCents)}.</span>
      </div>

      {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full py-3.5 rounded-full font-bold bg-gold-600 text-navy-900 hover:bg-gold-500 transition disabled:opacity-60"
      >
        {pending ? "Placing bid…" : "Place bid"}
      </button>
    </form>
  );
}
