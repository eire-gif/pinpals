"use client";

import { useState, useTransition } from "react";
import ListingCard from "./listing-card";
import { loadMoreListings } from "./actions";
import type { MarketplaceFilters, MarketplaceListing } from "@/lib/marketplace-discovery";

/**
 * Renders the (already server-rendered) first page of results, then owns
 * every subsequent "Load more" batch as session-local state.
 *
 * Pagination cursor state is deliberately NOT pushed into the URL — see
 * ../actions.ts's loadMoreListings header comment. What IS URL-synchronised
 * (search/filters/sort, per this phase's spec) lives one level up in
 * marketplace-controls.tsx; a filter change re-renders ./page.tsx with a
 * fresh first page, and page.tsx remounts this component (via a `key` tied
 * to the filters) so accumulated pages from the previous filter set never
 * leak into the new one.
 */
export default function LoadMoreListings({
  initialListings,
  initialNextCursor,
  filters,
  signedIn,
}: {
  initialListings: MarketplaceListing[];
  initialNextCursor: string | null;
  filters: MarketplaceFilters;
  signedIn: boolean;
}) {
  const [listings, setListings] = useState(initialListings);
  const [cursor, setCursor] = useState(initialNextCursor);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleLoadMore() {
    if (!cursor) return;
    setError(null);
    startTransition(async () => {
      const result = await loadMoreListings(filters, cursor);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setListings((prev) => [...prev, ...result.listings]);
      setCursor(result.nextCursor);
    });
  }

  if (listings.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-10 text-center">
        <p className="text-ink-500">
          No listings match those filters yet — try widening your search, or be the first to list something.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} signedIn={signedIn} />
        ))}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        {error && (
          <p className="text-sm text-red-600 bg-red-100 rounded-lg px-4 py-2.5" role="alert">
            {error}
          </p>
        )}
        {cursor && (
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={pending}
            className="px-6 py-3 rounded-full font-bold border-[1.5px] border-green-700 text-green-700 hover:bg-green-100 transition disabled:opacity-60"
          >
            {pending ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}
