"use client";

import { useState, useTransition } from "react";
import PriceSummary from "@/components/price-summary";
import { formatPrice } from "@/lib/format";
import type { Offer } from "@/lib/types";
import { respondToOffer } from "./actions";

export default function OffersList({
  offers,
  listingId,
}: {
  offers: Offer[];
  listingId: number;
}) {
  const [pending, startTransition] = useTransition();
  const [respondingTo, setRespondingTo] = useState<number | null>(null);

  if (offers.length === 0) {
    return (
      <p className="text-sm text-ink-500">No offers yet — you&rsquo;ll see them here as buyers make them.</p>
    );
  }

  function respond(offerId: number, accept: boolean) {
    setRespondingTo(offerId);
    startTransition(async () => {
      await respondToOffer(offerId, listingId, accept);
      setRespondingTo(null);
    });
  }

  return (
    <div className="grid gap-4">
      {offers.map((offer) => (
        <div key={offer.id} className="bg-surface border border-line rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="font-bold">{formatPrice(offer.amount_eur)} offer</span>
            <StatusBadge status={offer.status} />
          </div>
          {offer.status === "pending" && (
            <>
              <PriceSummary amountEur={offer.amount_eur} />
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => respond(offer.id, true)}
                  disabled={pending}
                  className="flex-1 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
                >
                  {pending && respondingTo === offer.id ? "Accepting…" : "Accept"}
                </button>
                <button
                  onClick={() => respond(offer.id, false)}
                  disabled={pending}
                  className="flex-1 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-red-600 text-red-600 hover:bg-red-100 transition disabled:opacity-60"
                >
                  {pending && respondingTo === offer.id ? "Declining…" : "Decline"}
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: Offer["status"] }) {
  const styles: Record<Offer["status"], string> = {
    pending: "bg-cream-100 text-ink-900",
    accepted: "bg-green-100 text-green-800",
    declined: "bg-red-100 text-red-600",
  };
  const labels: Record<Offer["status"], string> = {
    pending: "Pending",
    accepted: "Accepted",
    declined: "Declined",
  };
  return (
    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
