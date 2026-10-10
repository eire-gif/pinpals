import Image from "next/image";
import Link from "next/link";
import type { MarketplaceListing } from "@/lib/marketplace-discovery";
import { formatPrice, formatPriceCents, formatTimeRemaining, MARKETPLACE_BADGE_LABELS } from "@/lib/format";
import { displayBrand } from "@/lib/marketplace-brands";
import { isFeatured } from "@/lib/marketplace-growth";
import FavouriteButton from "./favourite-button";

const BADGE_STYLES: Record<MarketplaceListing["sale_type"], string> = {
  fixed_price: "bg-navy-900/90 text-white",
  offers_allowed: "bg-green-700/90 text-white",
  auction: "bg-gold-600/95 text-navy-900",
  auction_with_buy_now: "bg-gold-600/95 text-navy-900",
};

export default function ListingCard({
  listing,
  signedIn,
}: {
  listing: MarketplaceListing;
  signedIn: boolean;
}) {
  const isAuction = listing.sale_type === "auction" || listing.sale_type === "auction_with_buy_now";
  // formatTimeRemaining() (not a direct new Date()/Date.now() call here) is
  // what actually reads the clock — its own default `now` parameter — so
  // this stays a pure render: same props in, same JSX out, no impure global
  // read inline in the component body itself.
  const timeRemaining = listing.auction ? formatTimeRemaining(listing.auction.ends_at) : null;
  const auctionEnded = timeRemaining === "Ended";
  const brandName = displayBrand(listing);

  return (
    <Link
      href={`/marketplace/${listing.id}`}
      className="group block bg-surface rounded-2xl overflow-hidden shadow-[0_3px_14px_rgba(12,32,56,0.08)] hover:shadow-[0_8px_24px_rgba(12,32,56,0.14)] hover:-translate-y-0.5 transition"
    >
      {/* Stable aspect ratio (this phase's spec) so the grid never reflows
       * as photos of very different native dimensions load in — every card
       * reserves exactly the same box up front. */}
      <div className="relative aspect-[4/3] bg-surface-tint">
        {listing.image_url ? (
          <Image
            src={listing.image_url}
            alt={listing.title}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink-500">
            <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12h8M12 8v8" />
            </svg>
          </div>
        )}

        <FavouriteButton listingId={listing.id} initialFavourited={listing.isFavourited} signedIn={signedIn} />

        {/* Paid placement and shop stock outrank the sale type (0115). */}
        {listing.store_id ? (
          <span className="absolute top-3 right-3 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-green-700 text-cream-50">
            New
          </span>
        ) : isFeatured(listing) ? (
          <span className="absolute top-3 right-3 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-gold-400 text-navy-900">
            Featured
          </span>
        ) : (
          <span
            className={`absolute top-3 right-3 text-[11px] font-bold px-2.5 py-1 rounded-full ${BADGE_STYLES[listing.sale_type]}`}
          >
            {MARKETPLACE_BADGE_LABELS[listing.sale_type]}
          </span>
        )}
      </div>

      <div className="p-4">
        <span className="text-[11.5px] uppercase tracking-wider text-green-700 font-bold">
          {listing.category}
          {/* Brand beside the category, not on its own line: the card's
           * vertical space is already spoken for, and "IRONS · MIZUNO" is
           * how a buyer scanning a grid actually reads it. */}
          {brandName && <span className="text-ink-500"> · {brandName}</span>}
        </span>
        <h3 className="font-display font-bold text-lg mt-1 truncate">{listing.title}</h3>

        {isAuction && listing.auction ? (
          <div className="mt-1.5">
            <p className="font-extrabold text-xl text-navy-900">
              {formatPriceCents(listing.currentBidCents ?? listing.auction.starting_price_cents)}
              <span className="text-xs font-semibold text-ink-500">
                {" "}
                {listing.auction.winning_bid_id !== null ? "current bid" : "starting bid"}
              </span>
            </p>
            <p className={`text-xs font-semibold mt-0.5 ${auctionEnded ? "text-ink-500" : "text-green-700"}`}>
              {timeRemaining}
            </p>
          </div>
        ) : (
          <p className="font-extrabold text-xl text-navy-900 mt-1.5">
            {listing.price_eur !== null ? formatPrice(listing.price_eur) : ""}
          </p>
        )}

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">{listing.condition}</span>
          {listing.county && (
            <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">{listing.county}</span>
          )}
          {listing.store_id && listing.stock_quantity != null && listing.stock_quantity > 1 ? (
            <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">{listing.stock_quantity} in stock</span>
          ) : null}
        </div>
        {!listing.store_id ? <p className="text-[11.5px] font-semibold text-green-700 mt-2">✓ Buyer Protection</p> : null}
      </div>
    </Link>
  );
}
