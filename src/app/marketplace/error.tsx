"use client";

import { useEffect } from "react";

/**
 * Route-segment error boundary (Next's own convention) — catches a thrown
 * fetchMarketplaceListings() error (a genuine Supabase/DB failure, not just
 * "no results", which isn't an error) so a database hiccup shows a
 * recoverable panel in place of the listings grid instead of taking down
 * the whole page. `reset()` re-renders this segment (page.tsx runs again,
 * with the same URL/filters) — the natural "try again" for a page whose
 * only real state is what's in the URL already.
 */
export default function MarketplaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Marketplace search failed:", error);
  }, [error]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-16">
      <div className="bg-surface border border-line rounded-2xl p-10 text-center max-w-md mx-auto">
        <h2 className="font-display font-bold text-xl mb-2">Couldn&apos;t load the marketplace.</h2>
        <p className="text-ink-500 mb-6">
          Something went wrong fetching listings — this is usually temporary.
        </p>
        <button
          type="button"
          onClick={reset}
          className="px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
