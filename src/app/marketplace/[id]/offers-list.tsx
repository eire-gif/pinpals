"use client";

import { useState, useTransition } from "react";
import PriceSummary from "@/components/price-summary";
import { formatPrice, formatTimeRemaining } from "@/lib/format";
import { isOfferActionable, offerHasExpired } from "@/lib/marketplace";
import type { Offer, OfferStatus } from "@/lib/types";
import { offerAction } from "./actions";

/**
 * Seller-facing offer history + action controls (this phase's spec: "seller
 * action controls" + "offer history for each participant") — every offer
 * ever made on this listing, most-recently-active first, each row showing
 * whatever this seller can currently do with it: accept/decline/counter a
 * 'pending' offer, or nothing but a status badge once it's the buyer's turn
 * ('countered') or the chain has closed out (terminal statuses). Every
 * transition here goes through offerAction() -> offer_action() (0048), the
 * one privileged choke-point for every offer state change — never a direct
 * client update.
 */
export default function OffersList({
  offers,
  listingId,
}: {
  offers: Offer[];
  listingId: number;
}) {
  const [pending, startTransition] = useTransition();
  const [actingOn, setActingOn] = useState<number | null>(null);
  const [counteringOn, setCounteringOn] = useState<number | null>(null);
  const [counterAmount, setCounterAmount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  if (offers.length === 0) {
    return (
      <p className="text-sm text-ink-500">No offers yet — you&rsquo;ll see them here as buyers make them.</p>
    );
  }

  function respond(offer: Offer, action: "accept" | "decline") {
    setActingOn(offer.id);
    setError(null);
    startTransition(async () => {
      const result = await offerAction(offer.id, listingId, action);
      if (result.error) setError(result.error);
      setActingOn(null);
    });
  }

  function submitCounter(offer: Offer) {
    if (!counterAmount || counterAmount <= 0) {
      setError("Enter a valid counter-offer amount.");
      return;
    }
    setActingOn(offer.id);
    setError(null);
    startTransition(async () => {
      const result = await offerAction(offer.id, listingId, "counter", counterAmount);
      if (result.error) {
        setError(result.error);
      } else {
        setCounteringOn(null);
      }
      setActingOn(null);
    });
  }

  return (
    <div className="grid gap-4">
      {error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{error}</p>}

      {offers.map((offer) => {
        const isBusy = pending && actingOn === offer.id;
        const showControls = offer.status === "pending" && !offerHasExpired(offer.expires_at);

        return (
          <div key={offer.id} className="bg-surface border border-line rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold">{formatPrice(offer.amount_eur)} offer</span>
              <StatusBadge status={offer.status} />
            </div>
            {offer.amount_eur !== offer.original_amount_eur && (
              <p className="text-xs text-ink-500 mb-2">Originally offered at {formatPrice(offer.original_amount_eur)}.</p>
            )}
            {isOfferActionable(offer.status) && (
              <p className="text-xs text-ink-500 mb-3">
                {offerHasExpired(offer.expires_at)
                  ? "This offer has just expired — refresh to see its final state."
                  : `Expires ${formatTimeRemaining(offer.expires_at).toLowerCase()}.`}
              </p>
            )}

            {offer.status === "countered" && (
              <p className="text-sm text-ink-500 bg-cream-100 rounded-lg px-3.5 py-2.5">
                Waiting on the buyer to accept or decline your counter.
              </p>
            )}

            {showControls && (
              <>
                <PriceSummary amountEur={offer.amount_eur} />

                {counteringOn === offer.id ? (
                  <div className="grid gap-2 mt-3">
                    <label htmlFor={`counter-${offer.id}`} className="text-[13.5px] font-bold">
                      Counter amount (EUR)
                    </label>
                    <input
                      id={`counter-${offer.id}`}
                      type="number"
                      step="1"
                      min={offer.amount_eur + 1}
                      value={counterAmount || ""}
                      onChange={(e) => setCounterAmount(Number(e.target.value) || 0)}
                      className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600"
                    />
                    <div className="flex gap-3">
                      <button
                        onClick={() => submitCounter(offer)}
                        disabled={pending}
                        className="flex-1 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
                      >
                        {isBusy ? "Sending…" : "Send counter"}
                      </button>
                      <button
                        onClick={() => setCounteringOn(null)}
                        disabled={pending}
                        className="flex-1 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-line text-ink-700 hover:bg-cream-100 transition disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3 mt-3">
                    <button
                      onClick={() => respond(offer, "accept")}
                      disabled={pending}
                      className="flex-1 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
                    >
                      {isBusy ? "Accepting…" : "Accept"}
                    </button>
                    <button
                      onClick={() => {
                        setCounteringOn(offer.id);
                        setCounterAmount(Math.round(offer.amount_eur) + 1);
                        setError(null);
                      }}
                      disabled={pending}
                      className="flex-1 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-navy-900 text-navy-900 hover:bg-cream-100 transition disabled:opacity-60"
                    >
                      Counter
                    </button>
                    <button
                      onClick={() => respond(offer, "decline")}
                      disabled={pending}
                      className="flex-1 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-red-600 text-red-600 hover:bg-red-100 transition disabled:opacity-60"
                    >
                      {isBusy ? "Declining…" : "Decline"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

const STATUS_STYLES: Record<OfferStatus, string> = {
  pending: "bg-cream-100 text-ink-900",
  countered: "bg-gold-500/20 text-gold-700",
  accepted: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-600",
  withdrawn: "bg-cream-100 text-ink-500",
  expired: "bg-cream-100 text-ink-500",
};

const STATUS_LABELS: Record<OfferStatus, string> = {
  pending: "Pending",
  countered: "Countered",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

function StatusBadge({ status }: { status: OfferStatus }) {
  return (
    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
