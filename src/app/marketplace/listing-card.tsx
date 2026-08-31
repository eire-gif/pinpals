import Image from "next/image";
import Link from "next/link";
import type { Listing } from "@/lib/types";
import { formatPrice } from "@/lib/format";

export default function ListingCard({ listing }: { listing: Listing }) {
  return (
    <Link
      href={`/marketplace/${listing.id}`}
      className="group block bg-surface border border-line rounded-2xl overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition">
      <div className="relative h-48 bg-surface-tint">
        {listing.image_url ? (
          <Image
            src={listing.image_url}
            alt={listing.title}
            fill
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
        <span className="absolute top-3 right-3 bg-navy-900/90 text-white text-xs font-bold px-3 py-1.5 rounded-full">
          {formatPrice(listing.price_eur)}
        </span>
      </div>
      <div className="p-4">
        <span className="text-[11.5px] uppercase tracking-wider text-green-700 font-bold">
          {listing.category}
        </span>
        <h3 className="font-display font-bold text-lg mt-1 truncate">
          {listing.title}
        </h3>
        {listing.description && (
          <p className="text-sm text-ink-500 mt-1 line-clamp-2">{listing.description}</p>
        )}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
            {listing.condition}
          </span>
          {listing.county && (
            <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
              {listing.county}
            </span>
          )}
        </div>
        <span className="block w-full mt-4 py-2.5 rounded-full font-bold text-sm text-center border-[1.5px] border-green-700 text-green-700 group-hover:bg-green-100 transition">
          View &amp; make an offer
        </span>
      </div>
    </Link>
  );
}
