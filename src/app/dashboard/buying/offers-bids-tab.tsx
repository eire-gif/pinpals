import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, formatPriceCents } from "@/lib/format";
import { isOfferActionable } from "@/lib/marketplace";
import NextActionBadge from "@/components/dashboard/next-action-badge";
import Pagination from "@/components/dashboard/pagination";
import MarketplaceEmptyState from "@/components/marketplace/empty-state";
import type { Offer, OfferStatus } from "@/lib/types";

const OFFERS_PAGE_SIZE = 10;
const BIDS_PAGE_SIZE = 10;
// A buyer's raw bid history can have several rows per auction (each raise is
// its own immutable ledger row, 0039) — this caps how many of their most
// recent bids get pulled before deduping down to "one row per auction, their
// own current best" below. Generous enough that a buyer with even very
// active bidding habits still sees every auction they're genuinely in.
const RECENT_BIDS_FETCH_LIMIT = 200;

// Buyer-perspective wording — same voice as
// src/app/marketplace/[id]/my-offer-status.tsx's own (unexported) map, which
// this mirrors deliberately rather than importing (that file doesn't export
// it) so a buyer sees identical wording for the same offer whether they're
// looking at one listing or their whole offers inbox here.
const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  pending: "Waiting on seller",
  countered: "Seller countered",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

const OFFER_STATUS_STYLES: Record<OfferStatus, string> = {
  pending: "bg-cream-100 text-ink-900",
  countered: "bg-gold-500/20 text-gold-700",
  accepted: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-600",
  withdrawn: "bg-cream-100 text-ink-500",
  expired: "bg-cream-100 text-ink-500",
};

type OfferRow = Offer & {
  listings: { id: number; title: string; image_url: string | null; status: string } | null;
};

type BidRow = {
  id: number;
  auction_id: number;
  amount_cents: number;
  created_at: string;
  auctions: {
    id: number;
    listing_id: number;
    status: string;
    ends_at: string;
    winning_bid_id: number | null;
    listings: { id: number; title: string; image_url: string | null } | null;
  } | null;
};

export default async function OffersBidsTab({
  userId,
  offersPage,
  bidsPage,
}: {
  userId: string;
  offersPage: number;
  bidsPage: number;
}) {
  const supabase = await createClient();

  const rangeFrom = (offersPage - 1) * OFFERS_PAGE_SIZE;
  const rangeTo = rangeFrom + OFFERS_PAGE_SIZE - 1;

  const [{ data: offers, count: offersCount }, { data: recentBids }] = await Promise.all([
    supabase
      .from("offers")
      .select("*, listings(id, title, image_url, status)", { count: "exact" })
      .eq("buyer_id", userId)
      .order("expires_at", { ascending: true })
      .range(rangeFrom, rangeTo)
      .returns<OfferRow[]>(),
    supabase
      .from("bids")
      .select("id, auction_id, amount_cents, created_at, auctions(id, listing_id, status, ends_at, winning_bid_id, listings(id, title, image_url))")
      .eq("bidder_id", userId)
      .order("created_at", { ascending: false })
      .limit(RECENT_BIDS_FETCH_LIMIT)
      .returns<BidRow[]>(),
  ]);

  const offerRows = offers ?? [];

  // One row per auction — this buyer's own highest bid on it, which is all
  // that matters for "am I currently winning" (auction.winning_bid_id is
  // always the single current-high bid across every bidder, 0039's
  // apply_new_bid()). Sorted soonest-ending first, same convention as the
  // offers query above, then paginated in-memory (see this file's own
  // header comment on why this list isn't a real .range() query).
  const bestBidByAuction = new Map<number, BidRow>();
  for (const bid of recentBids ?? []) {
    if (!bid.auctions) continue;
    const existing = bestBidByAuction.get(bid.auction_id);
    if (!existing || bid.amount_cents > existing.amount_cents) {
      bestBidByAuction.set(bid.auction_id, bid);
    }
  }
  const allBidRows = [...bestBidByAuction.values()].sort(
    (a, b) => new Date(a.auctions!.ends_at).getTime() - new Date(b.auctions!.ends_at).getTime()
  );
  const bidsTotal = allBidRows.length;
  const bidsRangeFrom = (bidsPage - 1) * BIDS_PAGE_SIZE;
  const bidRows = allBidRows.slice(bidsRangeFrom, bidsRangeFrom + BIDS_PAGE_SIZE);

  return (
    <div className="grid gap-10">
      <section>
        <h2 className="font-display font-bold text-lg mb-4">Active offers</h2>
        {offerRows.length === 0 ? (
          <MarketplaceEmptyState
            title="No offers yet"
            description="Make an offer on a listing that allows them, and it'll show up here."
            actionHref="/marketplace"
            actionLabel="Browse the marketplace"
          />
        ) : (
          <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
            <ul>
              {offerRows.map((offer) => {
                const actionable = isOfferActionable(offer.status);
                return (
                  <li key={offer.id} className="border-b border-line last:border-0">
                    <Link
                      href={offer.listings ? `/marketplace/${offer.listings.id}` : "/marketplace"}
                      className="flex items-center gap-4 px-5 py-4 hover:bg-surface-tint transition flex-wrap"
                    >
                      {offer.listings?.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={offer.listings.image_url}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover border border-line shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-ink-900 truncate">
                          {offer.listings?.title ?? "Listing no longer available"}
                        </div>
                        <div className="text-xs text-ink-500">{formatPrice(offer.amount_eur)} offer</div>
                      </div>
                      <div className="shrink-0">
                        {actionable ? (
                          <NextActionBadge
                            label={offer.status === "countered" ? "Respond to counter" : "Waiting on seller"}
                            deadlineIso={offer.expires_at}
                          />
                        ) : (
                          <span
                            className={`text-xs font-bold px-2.5 py-1 rounded-full ${OFFER_STATUS_STYLES[offer.status]}`}
                          >
                            {OFFER_STATUS_LABELS[offer.status]}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <Pagination
          page={offersPage}
          pageSize={OFFERS_PAGE_SIZE}
          total={offersCount ?? 0}
          hrefForPage={(p) => `/dashboard/buying?tab=offers&offersPage=${p}&bidsPage=${bidsPage}`}
        />
      </section>

      <section>
        <h2 className="font-display font-bold text-lg mb-4">Active bids</h2>
        {bidRows.length === 0 ? (
          <MarketplaceEmptyState
            title="No bids yet"
            description="Bid on an auction listing and it'll show up here, with whether you're currently winning."
            actionHref="/marketplace"
            actionLabel="Browse the marketplace"
          />
        ) : (
          <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
            <ul>
              {bidRows.map((bid) => {
                const auction = bid.auctions!;
                const isWinning = auction.winning_bid_id === bid.id;
                const isLive = auction.status === "live" || auction.status === "scheduled";
                return (
                  <li key={bid.id} className="border-b border-line last:border-0">
                    <Link
                      href={`/marketplace/${auction.listing_id}`}
                      className="flex items-center gap-4 px-5 py-4 hover:bg-surface-tint transition flex-wrap"
                    >
                      {auction.listings?.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={auction.listings.image_url}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover border border-line shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-ink-900 truncate">
                          {auction.listings?.title ?? "Listing no longer available"}
                        </div>
                        <div className="text-xs text-ink-500">Your bid: {formatPriceCents(bid.amount_cents)}</div>
                      </div>
                      <div className="shrink-0">
                        {isLive ? (
                          <NextActionBadge
                            label={isWinning ? "Winning" : "Outbid — bid again"}
                            deadlineIso={auction.ends_at}
                          />
                        ) : (
                          <span
                            className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                              isWinning ? "bg-green-100 text-green-800" : "bg-cream-100 text-ink-500"
                            }`}
                          >
                            {isWinning ? "Won" : "Ended"}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <Pagination
          page={bidsPage}
          pageSize={BIDS_PAGE_SIZE}
          total={bidsTotal}
          hrefForPage={(p) => `/dashboard/buying?tab=offers&offersPage=${offersPage}&bidsPage=${p}`}
        />
      </section>
    </div>
  );
}
