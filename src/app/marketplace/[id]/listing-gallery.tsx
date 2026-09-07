"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * The listing detail page's photo display — a big main image plus a
 * thumbnail strip when there's more than one (up to MAX_LISTING_IMAGES,
 * src/lib/marketplace.ts). This is also where "preview the listing" (this
 * task's spec) becomes real for a seller checking a draft with several
 * photos: before this, the page only ever rendered listings.image_url, the
 * single legacy cover field — a seller who uploaded 6 photos while creating
 * the listing had no way to see the other 5 anywhere before publishing.
 */
export default function ListingGallery({ images, title }: { images: string[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeUrl = images[activeIndex];

  return (
    <div>
      <div className="relative h-80 rounded-2xl overflow-hidden bg-surface-tint border border-line">
        {activeUrl ? (
          <Image src={activeUrl} alt={title} fill className="object-cover" priority />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink-500">
            <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12h8M12 8v8" />
            </svg>
          </div>
        )}
      </div>

      {images.length > 1 && (
        <div className="flex gap-2 mt-3 overflow-x-auto">
          {images.map((url, index) => (
            <button
              key={url + index}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border-2 transition ${
                index === activeIndex ? "border-green-600" : "border-transparent opacity-80 hover:opacity-100"
              }`}
              aria-label={`Show photo ${index + 1}`}
            >
              <Image src={url} alt="" fill className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
