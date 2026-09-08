import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPriceCents, formatTimeRemaining } from "@/lib/format";
import MarketplaceEmptyState from "@/components/marketplace/empty-state";
import OffersList from "@/app/marketplace/[id]/offers-list";
import type { Auction, Offer } from "@/lib/types";

type OfferRow = Offer & { listings: { id: number; title: string; seller_id: string } | null };
type AuctionRow = Auction & { listings: { id: number; title: string; image_url: string | null } | null };

// The task spec's "incoming offers and live auctions". Offers are grouped by
// listing and rendered through OffersList (src/app/marketplace/[id]/offers-list.tsx)
// UNMODIFIED — that component already is the seller's accept/decline/counter
// UI, just built for one listing's own page; calling it once per listing
// group here (rather than teaching it a multi-listing shape) means this
// tab adds zero new offer-mutation logic of its own — offerAction() (0048)
// stays the one place a seller's response is ever written.
export default async function OffersAuctionsTab({ userId }: { userId: string }) {
  const supabase = await createClient();

  const [{ data: offers }, { data: auctions }] = await Promise.all([
    supabase
      .from("offers")
      .select("*, listings!inner(id, title, seller_id)")
      .eq("listings.seller_id", userId)
      .in("status", ["pending", "countered"])
      .order("expires_at", { ascending: true })
      .returns<OfferRow[]>(),
    supabase
      .from("auctions")
      .select("*, listings!inner(id, title, image_url, seller_id)")
      .eq("listings.seller_id", userId)
      .in("status", ["live", "scheduled"])
      .order("ends_at", { ascending: true })
      .returns<AuctionRow[]>(),
  ]);

  const offerRows = offers ?? [];
  const auctionRows = auctions ?? [];

  const winningBidIds = auctionRows.map((a) => a.winning_bid_id).filter((id): id is number => id !== null);
  const { data: winningBids } = winningBidIds.length
    ? await supabase.from("bids").select("id, amount_cents").in("id", winningBidIds)
    : { data: [] as { id: number; amount_cents: number }[] };
  const bidAmountById = new Map((winningBids ?? []).map((b) => [b.id, b.amount_cents]));

  // Group offers by listing, preserving the soonest-expiring-first order
  // from the query above.
  const offersByListing = new Map<number, { title: string; offers: Offer[] }>();
  for (const offer of offerRows) {
    if (!offer.listings) continue;
    const group = offersByListing.get(offer.listings.id);
    if (group) {
      group.offers.push(offer);
    } else {
      offersByListing.set(offer.listings.id, { title: offer.listings.title, offers: [offer] });
    }
  }

  return (
    <div className="grid gap-10">
      <section>
        <h2 className="font-display font-bold text-lg mb-4">Incoming offers</h2>
        {offersByListing.size === 0 ? (
          <MarketplaceEmptyState
            title="No offers right now"
            description="Offers buyers make on your listings that allow them show up here, grouped by listing."
          />
        ) : (
          <div className="grid gap-6">
            {[...offersByListing.entries()].map(([listingId, group]) => (
              <div key={listingId}>
                <Link
                  href={`/marketplace/${listingId}`}
                  className="font-bold text-ink-900 hover:underline text-sm mb-2 inline-block"
                >
                  {group.title}
                </Link>
                <OffersList offers={group.offers} listingId={listingId} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display font-bold text-lg mb-4">Live auctions</h2>
        {auctionRows.length === 0 ? (
          <MarketplaceEmptyState
            title="No live auctions"
            description="An auction-style listing you've started shows up here while it's scheduled or live."
          />
        ) : (
          <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
            <ul>
              {auctionRows.map((auction) => {
                const currentBidCents = auction.winning_bid_id
                  ? bidAmountById.get(auction.winning_bid_id) ?? auction.starting_price_cents
                  : auction.starting_price_cents;
                return (
                  <li key={auction.id} className="border-b border-line last:border-0">
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
                        <div className="font-semibold text-ink-900 truncate">{auction.listings?.title}</div>
                        <div className="text-xs text-ink-500">
                          {auction.winning_bid_id ? "Current bid" : "Starting price"}: {formatPriceCents(currentBidCents)}
                        </div>
                      </div>
                      <span className="text-xs font-bold px-2.5 py-1.5 rounded-full bg-gold-500/20 text-gold-700 shrink-0">
                        {auction.status === "live" ? formatTimeRemaining(auction.ends_at) : "Scheduled"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
