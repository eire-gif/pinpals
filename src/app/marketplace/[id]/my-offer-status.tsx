"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import PriceSummary from "@/components/price-summary";
import { formatPrice, formatTimeRemaining } from "@/lib/format";
import { isOfferActionable } from "@/lib/marketplace";
import type { Offer, OfferStatus, Order } from "@/lib/types";
import { offerAction } from "./actions";
import OfferSheet from "./offer-sheet";

const STATUS_STYLES: Record<OfferStatus, string> = {
  pending: "bg-cream-100 text-ink-900",
  countered: "bg-gold-500/20 text-gold-700",
  accepted: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-600",
  withdrawn: "bg-cream-100 text-ink-500",
  expired: "bg-cream-100 text-ink-500",
};

const STATUS_LABELS: Record<OfferStatus, string> = {
  pending: "Waiting on seller",
  countered: "Seller countered",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

/**
 * The buyer's own offer sheet/history for this listing (this phase's spec:
 * "offer history for each participant") — every offer chain this buyer has
 * ever made here, most recent first, with buyer-side controls on whichever
 * one is currently actionable: withdraw a 'pending' offer, or accept/
 * decline the seller's 'countered' one. Once accepted, this becomes the
 * buyer's way into the short checkout window offer_action() opened (0048).
 *
 * `order` is only ever the order tied to the CURRENT accepted chain (page.tsx
 * only fetches one, by this listing's most recent accepted offer's id) —
 * once it's no longer 'pending' (paid, or the checkout window lapsed and
 * release_expired_offer_reservations() cancelled it), this falls back to
 * plain history display for that offer instead of a checkout prompt.
 */
export default function MyOfferStatus({
  listingId,
  askingPrice,
  minAmount,
  offers,
  order,
}: {
  listingId: number;
  askingPrice: number;
  minAmount: number;
  offers: Offer[];
  order: Pick<Order, "id" | "reservation_expires_at" | "status"> | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const activeOffer = offers.find((o) => isOfferActionable(o.status)) ?? null;
  const acceptedOffer = offers.find((o) => o.status === "accepted") ?? null;
  const history = offers.filter((o) => o.id !== activeOffer?.id && o.id !== acceptedOffer?.id);

  function respond(offer: Offer, action: "accept" | "decline" | "withdraw") {
    setError(null);
    startTransition(async () => {
      const result = await offerAction(offer.id, listingId, action);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="grid gap-3">
      {error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{error}</p>}

      {acceptedOffer && order && order.status === "pending" && (
        <div className="bg-green-100 border border-green-600/30 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-green-800">Offer accepted — {formatPrice(acceptedOffer.amount_eur)}</span>
          </div>
          {order.reservation_expires_at && (
            <p className="text-sm text-green-800 mb-3">
              Complete checkout {formatTimeRemaining(order.reservation_expires_at).toLowerCase()} to secure it.
            </p>
          )}
          <Link
            href={`/dashboard/orders/${order.id}`}
            className="block w-full text-center py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition"
          >
            Complete checkout
          </Link>
        </div>
      )}

      {activeOffer && (
        <div className="bg-surface-tint border border-line rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold">{formatPrice(activeOffer.amount_eur)} offer</span>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLES[activeOffer.status]}`}>
              {STATUS_LABELS[activeOffer.status]}
            </span>
          </div>
          {activeOffer.status === "countered" && activeOffer.amount_eur !== activeOffer.original_amount_eur && (
            <p className="text-xs text-ink-500 mb-2">You originally offered {formatPrice(activeOffer.original_amount_eur)}.</p>
          )}
          <p className="text-xs text-ink-500 mb-3">
            Expires {formatTimeRemaining(activeOffer.expires_at).toLowerCase()}.
          </p>
          <PriceSummary amountEur={activeOffer.amount_eur} />

          {activeOffer.status === "pending" && (
            <button
              onClick={() => respond(activeOffer, "withdraw")}
              disabled={pending}
              className="w-full mt-3 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-red-600 text-red-600 hover:bg-red-100 transition disabled:opacity-60"
            >
              {pending ? "Withdrawing…" : "Withdraw offer"}
            </button>
          )}

          {activeOffer.status === "countered" && (
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => respond(activeOffer, "accept")}
                disabled={pending}
                className="flex-1 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
              >
                {pending ? "Accepting…" : "Accept counter"}
              </button>
              <button
                onClick={() => respond(activeOffer, "decline")}
                disabled={pending}
                className="flex-1 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-red-600 text-red-600 hover:bg-red-100 transition disabled:opacity-60"
              >
                {pending ? "Declining…" : "Decline"}
              </button>
            </div>
          )}
        </div>
      )}

      {!activeOffer && !(acceptedOffer && order && order.status === "pending") && (
        <OfferSheet listingId={listingId} askingPrice={askingPrice} minAmount={minAmount} />
      )}

      {history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-bold text-ink-500">
            {history.length === 1 ? "1 earlier offer" : `${history.length} earlier offers`}
          </summary>
          <div className="grid gap-2 mt-2">
            {history.map((offer) => (
              <div key={offer.id} className="flex items-center justify-between text-sm bg-cream-100 rounded-lg px-3.5 py-2.5">
                <span>{formatPrice(offer.amount_eur)}</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_STYLES[offer.status]}`}>
                  {STATUS_LABELS[offer.status]}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
