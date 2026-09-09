import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CATEGORIES } from "@/lib/marketplace";
import { ALL_REGIONS } from "@/lib/regions";
import { listMockListings } from "@/lib/marketplace-fixtures";
import MarketplaceSearchBar from "@/components/marketplace/search-bar";
import CategoryNav from "@/components/marketplace/category-nav";
import ListingCard from "@/components/marketplace/listing-card";
import MarketplaceEmptyState from "@/components/marketplace/empty-state";
import MobileActionBar from "@/components/marketplace/mobile-action-bar";

export const metadata: Metadata = {
  title: "Marketplace | Pinpals",
  description: "Buy and sell golf clubs and gear with other Pinpals members across Ireland.",
};

type MarketplaceSearchParams = {
  q?: string;
  category?: string;
  county?: string;
  sort?: string;
};

// ============ MARKETPLACE FOUNDATION SHELL (PREVIEW, ISOLATED) ============
// This route (and /marketplace-preview/[slug]) reads exclusively from the
// development fixture in src/lib/marketplace-fixtures.ts — no Supabase
// client, no listings/offers table access, no bidding. It is intentionally
// isolated under /marketplace-preview, not linked from primary navigation,
// and does not replace or disconnect the real, database-backed
// /marketplace and /marketplace/[id] routes, which remain live and
// untouched. This lets the visual foundation be reviewed on its own before
// the phase that wires these shared components up to real data and real
// offers.
export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<MarketplaceSearchParams>;
}) {
  const { q = "", category = "", county = "", sort = "recent" } = await searchParams;

  const listings = listMockListings({
    q,
    category: category || undefined,
    county: county || undefined,
    sort: sort === "price_low" || sort === "price_high" ? sort : "recent",
  });

  function buildCategoryHref(nextCategory?: string): string {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (nextCategory) params.set("category", nextCategory);
    if (county) params.set("county", county);
    if (sort && sort !== "recent") params.set("sort", sort);
    const qs = params.toString();
    return `/marketplace-preview${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="pb-24 md:pb-0">
      <div className="relative bg-navy-900 text-white pt-16 pb-14 overflow-hidden">
        <Image
          src="/images/marketplace-header.jpg"
          alt=""
          fill
          className="object-cover -z-10 opacity-40"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,22,40,0.55)] to-[rgba(9,22,40,0.92)] -z-10" />
        <div className="max-w-6xl mx-auto px-6">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" aria-hidden="true" /> Marketplace
          </span>
          <h1 className="font-display font-bold text-4xl mt-2.5">Buy and sell golf gear.</h1>
          <p className="text-white/80 mt-3 max-w-[52ch]">
            Clear out the garage or find your next set — clubs, bags and gear, golfer to golfer.
          </p>
          <Link
            href="/marketplace/new"
            className="hidden md:inline-block mt-6 px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
          >
            Sell an item
          </Link>
        </div>
      </div>

      <section aria-labelledby="marketplace-listings-heading" className="max-w-6xl mx-auto px-6 py-14">
        <h2 id="marketplace-listings-heading" className="sr-only">
          Marketplace listings
        </h2>

        <div className="grid gap-5 mb-8">
          <MarketplaceSearchBar defaultQuery={q} defaultCounty={county} defaultSort={sort} counties={ALL_REGIONS} />
          <CategoryNav
            categories={CATEGORIES}
            activeCategory={category || undefined}
            buildHref={buildCategoryHref}
          />
        </div>

        {listings.length === 0 ? (
          <MarketplaceEmptyState
            title="No listings match that search"
            description="Try a different category, county or search term — or be the first to list something like it."
            actionHref="/marketplace/new"
            actionLabel="List an item"
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>

      <MobileActionBar label="Sell an item" href="/marketplace/new" />
    </div>
  );
}
