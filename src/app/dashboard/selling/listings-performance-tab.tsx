import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, formatPriceCents, formatTimeRemaining, SELLER_LISTING_STATUS_LABELS, SELLER_LISTING_STATUS_STYLES } from "@/lib/format";
import Pagination from "@/components/dashboard/pagination";
import MarketplaceEmptyState from "@/components/marketplace/empty-state";
import type { Auction, Listing } from "@/lib/types";

const PAGE_SIZE = 10;

// The task spec's "listings and listing performance" — src/app/dashboard/listings
// already owns full listing MANAGEMENT (draft/edit, status tabs); this adds
// the genuinely new part, per-listing performance counts, and links back
// there for anything actionable. No count is stored anywhere (see the
// research this phase did — no view_count/favourite_count column exists on
// `listings` at all), so every number here is a fresh count query, exactly
// like every other read in this app that has no denormalized total to lean on.
export default async function ListingsPerformanceTab({ userId, page }: { userId: string; page: number }) {
  const supabase = await createClient();
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const { data: listings, count } = await supabase
    .from("listings")
    .select("*", { count: "exact" })
    .eq("seller_id", userId)
    .order("created_at", { ascending: false })
    .range(rangeFrom, rangeTo)
    .returns<Listing[]>();

  const rows = listings ?? [];
  const listingIds = rows.map((l) => l.id);

  const [{ data: favouriteRows }, { data: offerRows }, { data: auctionRows }] = await Promise.all([
    listingIds.length
      ? supabase.from("listing_favourites").select("listing_id").in("listing_id", listingIds)
      : Promise.resolve({ data: [] as { listing_id: number }[] }),
    listingIds.length
      ? supabase.from("offers").select("listing_id, status").in("listing_id", listingIds).in("status", ["pending", "countered"])
      : Promise.resolve({ data: [] as { listing_id: number; status: string }[] }),
    listingIds.length
      ? supabase.from("auctions").select("*").in("listing_id", listingIds).returns<Auction[]>()
      : Promise.resolve({ data: [] as Auction[] }),
  ]);

  const favouriteCountByListing = new Map<number, number>();
  for (const row of favouriteRows ?? []) {
    favouriteCountByListing.set(row.listing_id, (favouriteCountByListing.get(row.listing_id) ?? 0) + 1);
  }
  const activeOfferCountByListing = new Map<number, number>();
  for (const row of offerRows ?? []) {
    activeOfferCountByListing.set(row.listing_id, (activeOfferCountByListing.get(row.listing_id) ?? 0) + 1);
  }
  const auctionByListing = new Map((auctionRows ?? []).map((a) => [a.listing_id, a]));

  const winningBidIds = (auctionRows ?? []).map((a) => a.winning_bid_id).filter((id): id is number => id !== null);
  const { data: winningBids } = winningBidIds.length
    ? await supabase.from("bids").select("id, amount_cents").in("id", winningBidIds)
    : { data: [] as { id: number; amount_cents: number }[] };
  const bidAmountById = new Map((winningBids ?? []).map((b) => [b.id, b.amount_cents]));

  if (rows.length === 0) {
    return (
      <MarketplaceEmptyState
        title="No listings yet"
        description="List your first item and its performance — saves and offers — will show up here."
        actionHref="/marketplace/new"
        actionLabel="List an item"
      />
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Link href="/dashboard/listings" className="text-sm font-bold text-green-700 hover:text-green-600">
          Manage listings &rarr;
        </Link>
      </div>

      <div className="grid gap-3">
        {rows.map((listing) => {
          const favourites = favouriteCountByListing.get(listing.id) ?? 0;
          const activeOffers = activeOfferCountByListing.get(listing.id) ?? 0;
          const auction = auctionByListing.get(listing.id);
          const currentBidCents = auction
            ? auction.winning_bid_id
              ? bidAmountById.get(auction.winning_bid_id) ?? auction.starting_price_cents
              : auction.starting_price_cents
            : null;

          return (
            <div key={listing.id} className="flex items-center gap-4 bg-surface border border-line rounded-xl p-4 flex-wrap">
              <div className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-surface-tint">
                {listing.image_url ? (
                  <Image src={listing.image_url} alt="" fill className="object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-ink-500">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M8 12h8M12 8v8" />
                    </svg>
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/marketplace/${listing.id}`} className="font-bold text-ink-900 hover:underline truncate">
                    {listing.title}
                  </Link>
                  <span
                    className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full shrink-0 ${SELLER_LISTING_STATUS_STYLES[listing.status]}`}
                  >
                    {SELLER_LISTING_STATUS_LABELS[listing.status]}
                  </span>
                </div>
                <p className="text-sm text-ink-500 mt-0.5">
                  {auction && currentBidCents !== null
                    ? `${formatPriceCents(currentBidCents)} current bid`
                    : listing.price_eur !== null
                      ? formatPrice(listing.price_eur)
                      : "Auction"}
                  {auction && (auction.status === "live" || auction.status === "scheduled") && (
                    <> &middot; {formatTimeRemaining(auction.ends_at)}</>
                  )}
                </p>
              </div>

              <div className="flex gap-2 shrink-0">
                <span className="text-xs font-bold px-2.5 py-1.5 rounded-full bg-cream-100 text-ink-900">
                  &hearts; {favourites}
                </span>
                {activeOffers > 0 && (
                  <span className="text-xs font-bold px-2.5 py-1.5 rounded-full bg-gold-500/20 text-gold-700">
                    {activeOffers} active {activeOffers === 1 ? "offer" : "offers"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefForPage={(p) => `/dashboard/selling?tab=listings&page=${p}`}
      />
    </div>
  );
}
