import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getMockListingBySlug,
  listMockListingsBySeller,
  MOCK_LISTINGS,
} from "@/lib/marketplace-fixtures";
import { CategoryTile, categoryTint } from "@/components/marketplace/category-visual";
import PriceTag from "@/components/marketplace/price-tag";
import SellerBadge from "@/components/marketplace/seller-badge";
import ListingCard from "@/components/marketplace/listing-card";
import MobileActionBar from "@/components/marketplace/mobile-action-bar";

type ListingPageParams = { slug: string };

export function generateStaticParams(): ListingPageParams[] {
  return MOCK_LISTINGS.map((listing) => ({ slug: listing.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<ListingPageParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const listing = getMockListingBySlug(slug);
  return {
    title: listing ? `${listing.title} | Pinpals Marketplace` : "Listing not found | Pinpals",
  };
}

// Mock-data counterpart to the pre-existing /marketplace/[id] detail page —
// see src/lib/marketplace-fixtures.ts's file header for why this is a
// separate, database-free route rather than an extension of the real one.
// No offer form, no "accept/decline", no order creation: the seller panel
// below is a clearly-labelled placeholder, not a disabled version of real
// functionality, so it can't be mistaken for a broken feature.
export default async function MarketplaceListingPage({
  params,
}: {
  params: Promise<ListingPageParams>;
}) {
  const { slug } = await params;
  const listing = getMockListingBySlug(slug);
  if (!listing) notFound();

  const moreFromSeller = listMockListingsBySeller(listing.seller.name, listing.slug).slice(0, 3);

  return (
    <div className="pb-24 md:pb-0">
      <div className="max-w-3xl mx-auto px-6 py-10 md:py-14">
        <Link
          href="/marketplace-preview"
          className="inline-flex items-center gap-1.5 text-sm text-green-700 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2 rounded"
        >
          &larr; Back to marketplace
        </Link>

        <article className="grid md:grid-cols-2 gap-8 mt-6">
          <div
            className="relative h-72 md:h-80 rounded-2xl overflow-hidden border border-line flex items-center justify-center"
            style={{ background: categoryTint(listing.category) }}
          >
            <CategoryTile category={listing.category} className="w-20 h-20" />
          </div>

          <div>
            <span className="text-[11.5px] uppercase tracking-wider text-green-700 font-bold">
              {listing.category}
            </span>
            <h1 className="font-display font-bold text-3xl mt-1">{listing.title}</h1>
            <PriceTag amountEur={listing.priceEur} size="lg" className="block mt-2" />

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                {listing.condition}
              </span>
              <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                {listing.county}
              </span>
            </div>

            <p className="text-ink-700 mt-4">{listing.description}</p>

            <div className="mt-6 pt-6 border-t border-line">
              <h2 className="text-xs font-bold uppercase tracking-wider text-ink-500 mb-3">
                Seller
              </h2>
              <SellerBadge seller={listing.seller} />
            </div>
          </div>
        </article>

        <section aria-labelledby="contact-seller-heading" className="mt-10 pt-8 border-t border-line hidden md:block">
          <h2 id="contact-seller-heading" className="font-display font-bold text-xl mb-4">
            Interested in this item?
          </h2>
          <div className="max-w-sm bg-surface-tint border border-line rounded-2xl p-6 text-center">
            <p className="text-sm text-ink-500 mb-4">
              Messaging and offers connect to real listings once this marketplace foundation is wired
              up to the database — this preview shows the layout only.
            </p>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="w-full py-3 rounded-full font-bold bg-cream-100 text-ink-500 cursor-not-allowed"
            >
              Message seller
            </button>
          </div>
        </section>

        {moreFromSeller.length > 0 && (
          <section aria-labelledby="more-from-seller-heading" className="mt-10 pt-8 border-t border-line">
            <h2 id="more-from-seller-heading" className="font-display font-bold text-xl mb-4">
              More from {listing.seller.name.split(" ")[0]}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {moreFromSeller.map((other) => (
                <ListingCard key={other.id} listing={other} />
              ))}
            </div>
          </section>
        )}
      </div>

      <MobileActionBar
        label="Message seller"
        href="#"
        disabled
        disabledNote="Messaging connects once this marketplace foundation is wired up to the database."
      />
    </div>
  );
}
