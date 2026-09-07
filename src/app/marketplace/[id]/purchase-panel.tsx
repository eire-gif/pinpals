import Link from "next/link";
import { formatPrice, formatPriceCents } from "@/lib/format";
import { centsToEur, MIN_OFFER_AMOUNT_CENTS } from "@/lib/marketplace";
import type { Offer, Order } from "@/lib/types";
import BuyNowButton from "./buy-now-button";
import BidForm from "./bid-form";
import MyOfferStatus from "./my-offer-status";
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
 *
 * `state.kind === "unavailable"` gets one deliberate exception: a listing
 * goes 'reserved' the instant THIS viewer's own offer is accepted
 * (offer_action(), 0048), which would otherwise show the generic "no longer
 * available" message to the exact person who just won it. `myOffers`/
 * `myOrder` (this listing's offer chain history and the order tied to it,
 * fetched once in ../page.tsx) let this component special-case that one
 * viewer instead — see the branch below.
 */
export default function PurchasePanel({
  listingId,
  editHref,
  state,
  priceEur,
  myOffers,
  myOrder,
}: {
  listingId: number;
  editHref: string;
  state: ListingPurchaseState;
  /** listing.price_eur, passed straight through regardless of `state.kind` —
   * the "unavailable" branch below needs it too (for MyOfferStatus's own
   * asking-price display) even though ListingPurchaseState's "unavailable"
   * variant carries no price of its own. */
  priceEur: number | null;
  myOffers: Offer[];
  myOrder: Pick<Order, "id" | "reservation_expires_at" | "status" | "checkout_completed_at"> | null;
}) {
  const minAmount = centsToEur(MIN_OFFER_AMOUNT_CENTS);
  const myAcceptedOffer = myOffers.find((o) => o.status === "accepted") ?? null;

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

      {state.kind === "unavailable" &&
        (myAcceptedOffer ? (
          <MyOfferStatus
            listingId={listingId}
            askingPrice={priceEur ?? myAcceptedOffer.amount_eur}
            minAmount={minAmount}
            offers={myOffers}
            order={myOrder}
          />
        ) : (
          <p className="text-sm text-ink-500 bg-cream-100 rounded-xl px-4 py-3.5">{state.reason}</p>
        ))}

      {state.kind === "fixed_price" && (
        <div className="grid gap-3">
          <p className="font-display font-bold text-2xl text-gold-600">{formatPrice(state.priceEur)}</p>
          <BuyNowButton listingId={listingId} />
          {state.offersAllowed && (
            <MyOfferStatus
              listingId={listingId}
              askingPrice={state.priceEur}
              minAmount={minAmount}
              offers={myOffers}
              order={myOrder}
            />
          )}
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
