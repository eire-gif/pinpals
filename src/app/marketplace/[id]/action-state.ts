// The listing-detail page's action-rules state machine (this phase's
// spec): which primary/secondary purchase action(s) a viewer sees is a
// function of (sale_type, listing.status, auction state, viewer role) —
// this is the one place that decision gets made, as a pure function over
// already-fetched rows, so ../page.tsx (server) and any future caller never
// have to re-derive it inline or risk the desktop sticky panel and the
// mobile action bar disagreeing about what's actually on offer.
//
// Every branch's data (price, current bid, minimum next bid) is exactly
// what was true when the page rendered — a display hint only. The Server
// Actions this state feeds into (buyNow()/placeBid() in ./actions.ts) each
// re-read and re-validate everything themselves before writing anything,
// per this phase's spec: "All eligibility and price values must be
// recomputed on the server when an action begins."
import type { Auction, Listing } from "@/lib/types";
import { listingUnavailableReason, nextMinimumBidCents, auctionHasEnded, isAuctionSaleType } from "@/lib/marketplace";

export type ListingPurchaseState =
  | { kind: "seller" }
  | { kind: "signed_out" }
  | { kind: "unavailable"; reason: string }
  | {
      kind: "fixed_price";
      priceEur: number;
      offersAllowed: boolean;
    }
  | {
      kind: "auction";
      auctionId: number;
      currentBidCents: number;
      minimumNextBidCents: number;
      closesAtIso: string;
      ended: boolean;
      buyNowPriceCents: number | null;
    };

export function computeListingPurchaseState(params: {
  listing: Pick<Listing, "status" | "sale_type" | "price_eur">;
  auction: Auction | null;
  currentBidCents: number | null;
  isSeller: boolean;
  isSignedIn: boolean;
}): ListingPurchaseState {
  const { listing, auction, currentBidCents, isSeller, isSignedIn } = params;

  // Seller/signed-out checks come first, ahead of the status check below —
  // a seller previewing their own draft, or a signed-out visitor looking at
  // an active listing, both need their own branch regardless of status.
  if (isSeller) return { kind: "seller" };
  if (!isSignedIn) return { kind: "signed_out" };

  const reason = listingUnavailableReason(listing.status);
  if (reason) return { kind: "unavailable", reason };

  if (isAuctionSaleType(listing.sale_type) && auction) {
    const current = currentBidCents ?? auction.starting_price_cents;
    return {
      kind: "auction",
      auctionId: auction.id,
      currentBidCents: current,
      minimumNextBidCents: nextMinimumBidCents(auction, currentBidCents),
      closesAtIso: auction.ends_at,
      ended: auction.status === "ended" || auction.status === "cancelled" || auctionHasEnded(auction.ends_at),
      buyNowPriceCents: listing.sale_type === "auction_with_buy_now" ? auction.buy_now_price_cents : null,
    };
  }

  // listings_price_required_for_non_auction_check (0046) guarantees
  // price_eur is set for every non-auction sale_type, and the branch above
  // already excluded auction listings — the ?? 0 is only here to satisfy
  // the type checker, never expected to fire (same precedent as the old
  // page.tsx's OfferForm askingPrice fallback it replaces).
  return {
    kind: "fixed_price",
    priceEur: listing.price_eur ?? 0,
    offersAllowed: listing.sale_type === "offers_allowed",
  };
}
