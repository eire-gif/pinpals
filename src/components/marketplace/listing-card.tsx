import Link from "next/link";
import type { MockListing } from "@/lib/marketplace-fixtures";
import { CategoryTile, categoryTint } from "./category-visual";
import PriceTag from "./price-tag";

export default function ListingCard({ listing }: { listing: MockListing }) {
  return (
    <Link
      href={`/marketplace-preview/${listing.slug}`}
      className="group block bg-surface border border-line rounded-2xl overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
    >
      <div
        className="relative h-48 flex items-center justify-center"
        style={{ background: categoryTint(listing.category) }}
      >
        <CategoryTile category={listing.category} className="w-14 h-14" />
        <span className="absolute top-3 right-3 bg-navy-900/90 px-3 py-1.5 rounded-full">
          <PriceTag amountEur={listing.priceEur} size="sm" tone="white" />
        </span>
      </div>
      <div className="p-4">
        <span className="text-[11.5px] uppercase tracking-wider text-green-700 font-bold">
          {listing.category}
        </span>
        <h3 className="font-display font-bold text-lg mt-1 truncate">{listing.title}</h3>
        <p className="text-sm text-ink-500 mt-1 line-clamp-2">{listing.description}</p>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
            {listing.condition}
          </span>
          <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
            {listing.county}
          </span>
        </div>
        <span className="block w-full mt-4 py-2.5 rounded-full font-bold text-sm text-center border-[1.5px] border-green-700 text-green-700 group-hover:bg-green-100 transition">
          View listing
        </span>
      </div>
    </Link>
  );
}
