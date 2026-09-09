import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  parseMarketplaceFilters,
  fetchMarketplaceListings,
  fetchBrandFacets,
  RESULTS_PAGE_SIZE,
} from "@/lib/marketplace-discovery";
import MarketplaceControls from "./marketplace-controls";
import LoadMoreListings from "./load-more-listings";

/**
 * Marketplace discovery (Phase: marketplace-discovery). Replaces the old
 * fixed `.eq("status","active").order(...).limit(60)` fetch with real,
 * filtered, cursor-paginated search (src/lib/marketplace-discovery.ts) —
 * and replaces the old full-bleed navy hero image with a slim header, per
 * this phase's "first viewport... without an oversized marketing hero"
 * spec: useful results now show without scrolling past a hero banner.
 */
export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const filters = parseMarketplaceFilters(raw);
  const listed = raw.listed;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Facets in parallel with the results themselves: they're independent
  // queries against the same filter set, and the brand panel shouldn't add
  // a round-trip to time-to-first-listing. fetchBrandFacets never rejects
  // (it degrades to un-counted brands), so this Promise.all can only fail
  // for the reason the page should fail anyway — the listings query.
  const [{ listings, nextCursor }, brandFacets] = await Promise.all([
    fetchMarketplaceListings(supabase, filters, null, user?.id ?? null, RESULTS_PAGE_SIZE),
    fetchBrandFacets(supabase, filters),
  ]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Marketplace
          </span>
          <h1 className="font-display font-bold text-2xl mt-1.5">Buy and sell golf gear.</h1>
        </div>
        <Link
          href={user ? "/marketplace/new" : "/signup"}
          className="px-5 py-2.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition shrink-0"
        >
          {user ? "List an item" : "Join to start selling"}
        </Link>
      </div>

      {listed && (
        <div className="mb-6 bg-green-100 text-green-800 rounded-xl px-4 py-3 text-sm font-semibold">
          Listing published — it&rsquo;s live on the marketplace now.
        </div>
      )}

      <MarketplaceControls filters={filters} brandFacets={brandFacets} />

      {/* Keyed by the filters themselves so a search/filter/sort change
       * fully remounts the accumulated "Load more" state below, rather than
       * appending a new filter's results onto the previous filter's pages. */}
      <LoadMoreListings
        key={JSON.stringify(filters)}
        initialListings={listings}
        initialNextCursor={nextCursor}
        filters={filters}
        signedIn={!!user}
      />
    </div>
  );
}
