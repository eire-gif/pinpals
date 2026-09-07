import Link from "next/link";
import { formatPrice, formatPriceCents } from "@/lib/format";
import type { Offer } from "@/lib/types";
import PriceSummary from "@/components/price-summary";
import BuyNowButton from "./buy-now-button";
import BidForm from "./bid-form";
import OfferForm from "./offer-form";
import type { ListingPurchaseState } from "./action-state";

/**
 * The listing-detail page's one purchase surface — rendered twice by
 * ../page.tsx (sticky in the desktop two-column layout, inline in the
 * single-column mobile layout) so there's exactly one implementation of
 * "what does this action state actually look like", never two that could
 * drift apart. This phase's spec's action rules, one `state.kind` per
 * branch:
 *  - seller: "show Manage Listing rather than purchase actions"
 *  - unavailable (reserved/sold/expired/removed/draft/pending_review):
 *    "disable purchasing and state why"
 *  - fixed_price: "primary Buy Now; optional Make an Offer if enabled"
 *  - auction(_with_buy_now): "show current bid, minimum next bid and exact
 *    closing time" (BidForm), plus, when a Buy It Now price exists, "show
 *    both actions with clear consequences"
 */
export default function PurchasePanel({
  listingId,
  editHref,
  state,
  myOffer,
}: {
  listingId: number;
  editHref: string;
  state: ListingPurchaseState;
  myOffer: Offer | null;
}) {
  return (
    <div className="bg-surface border border-line rounded-2xl shadow-lg p-6">
      {state.kind === "seller" && (
        <>
          <p className="text-sm text-ink-500 mb-4">
            This is your listing — buyers see purchase actions here instead.
          </p>
          <Link
            href={editHref}
            className="block w-full text-center py-3.5 rounded-full font-bold bg-navy-900 text-cream-50 hover:bg-navy-800 transition"
          >
            Manage listing
          </Link>
        </>
      )}

      {state.kind === "signed_out" && (
        <div className="text-center">
          <h2 className="font-display font-bold text-lg mb-2">Join to buy or bid.</h2>
          <p className="text-sm text-ink-500 mb-4">
            Create a free profile to buy gear from other Pinpals members.
          </p>
          <Link
            href="/signup"
            className="block w-full text-center py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
          >
            Join Pinpals
          </Link>
        </div>
      )}

      {state.kind === "unavailable" && (
        <p className="text-sm text-ink-500 bg-cream-100 rounded-xl px-4 py-3.5">{state.reason}</p>
      )}

      {state.kind === "fixed_price" && (
        <div className="grid gap-3">
          <p className="font-display font-bold text-2xl text-gold-600">{formatPrice(state.priceEur)}</p>
          <BuyNowButton listingId={listingId} />
          {state.offersAllowed &&
            (myOffer ? (
              <MyOfferSummary offer={myOffer} />
            ) : (
              <details>
                <summary className="cursor-pointer text-sm font-bold text-green-700">Make an offer instead</summary>
                <div className="mt-3">
                  <OfferForm listingId={listingId} askingPrice={state.priceEur} />
                </div>
              </details>
            ))}
        </div>
      )}

      {state.kind === "auction" && (
        <div className="grid gap-3">
          {state.ended ? (
            <p className="text-sm text-ink-500 bg-cream-100 rounded-xl px-4 py-3.5">
              Bidding has closed on this auction.
            </p>
          ) : (
            <BidForm
              listingId={listingId}
              auctionId={state.auctionId}
              currentBidCents={state.currentBidCents}
              minimumNextBidCents={state.minimumNextBidCents}
              closesAtLabel={new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(state.closesAtIso)
              )}
            />
          )}
          {state.buyNowPriceCents !== null && !state.ended && (
            <>
              <p className="text-xs text-ink-500 text-center uppercase tracking-wide">or</p>
              <BuyNowButton
                listingId={listingId}
                label={`Buy It Now for ${formatPriceCents(state.buyNowPriceCents)}`}
                variant="secondary"
              />
              <p className="text-xs text-ink-500">
                Buying it now ends the auction immediately — any bids in progress lose.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MyOfferSummary({ offer }: { offer: Offer }) {
  return (
    <div className="bg-surface-tint border border-line rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold">{formatPrice(offer.amount_eur)} offer</span>
        <span
          className={`text-xs font-bold px-2.5 py-1 rounded-full ${
            offer.status === "accepted"
              ? "bg-green-100 text-green-800"
              : offer.status === "declined"
                ? "bg-red-100 text-red-600"
                : "bg-cream-100 text-ink-900"
          }`}
        >
          {offer.status === "pending" ? "Waiting on seller" : offer.status === "accepted" ? "Accepted" : "Declined"}
        </span>
      </div>
      {offer.status !== "declined" && <PriceSummary amountEur={offer.amount_eur} />}
    </div>
  );
}
