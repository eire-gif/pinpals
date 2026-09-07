import ListingCard from "../listing-card";
import type { MarketplaceListing } from "@/lib/marketplace-discovery";

/**
 * "related listings loaded efficiently" (this phase's spec) — ../page.tsx
 * fetches these through the exact same fetchMarketplaceListings() batched
 * query the /marketplace grid itself uses (one RPC call + up to three
 * batched follow-ups for the whole page, never one query per card — see
 * that function's own header comment), just scoped to this listing's
 * category and capped at a handful of results. This component only renders
 * what it's handed, reusing the grid's own ListingCard so a related listing
 * looks and behaves exactly like it does on /marketplace.
 */
export default function RelatedListings({
  listings,
  signedIn,
}: {
  listings: MarketplaceListing[];
  signedIn: boolean;
}) {
  if (listings.length === 0) return null;

  return (
    <div className="mt-14 pt-10 border-t border-line">
      <h2 className="font-display font-bold text-xl mb-5">You might also like</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} signedIn={signedIn} />
        ))}
      </div>
    </div>
  );
}
