"use client";

import { useState, type KeyboardEvent } from "react";
import Image from "next/image";

/**
 * The listing detail page's photo display — a big main image plus a
 * thumbnail strip when there's more than one (up to MAX_LISTING_IMAGES,
 * src/lib/marketplace.ts). This is also where "preview the listing" (an
 * earlier phase's spec) becomes real for a seller checking a draft with
 * several photos: before this, the page only ever rendered
 * listings.image_url, the single legacy cover field — a seller who
 * uploaded 6 photos while creating the listing had no way to see the other
 * 5 anywhere before publishing.
 *
 * This phase (listing-detail) adds keyboard controls and per-photo alt
 * text: Left/Right arrow keys step through the gallery whenever it (or a
 * thumbnail) has focus, matching the left/right semantics a sighted mouse
 * user already gets from the thumbnail strip, and every image now names
 * its actual position ("Photo 2 of 5") rather than repeating the listing
 * title (main image) or nothing at all (thumbnails, previously alt="").
 */
export default function ListingGallery({ images, title }: { images: string[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeUrl = images[activeIndex];
  const hasMultiple = images.length > 1;

  function step(delta: number) {
    if (!hasMultiple) return;
    setActiveIndex((current) => (current + delta + images.length) % images.length);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    }
  }

  return (
    <div>
      <div
        role="group"
        aria-label={`${title} photos, ${activeIndex + 1} of ${images.length || 1}`}
        aria-roledescription="carousel"
        tabIndex={hasMultiple ? 0 : -1}
        onKeyDown={handleKeyDown}
        className="relative h-80 rounded-2xl overflow-hidden bg-surface-tint border border-line focus:outline-none focus:ring-2 focus:ring-green-600"
      >
        {activeUrl ? (
          <Image
            src={activeUrl}
            alt={images.length > 1 ? `${title} — photo ${activeIndex + 1} of ${images.length}` : title}
            fill
            className="object-cover"
            priority
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink-500">
            <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12h8M12 8v8" />
            </svg>
          </div>
        )}

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-navy-900/70 text-white flex items-center justify-center hover:bg-navy-900/90 transition"
            >
              &larr;
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-navy-900/70 text-white flex items-center justify-center hover:bg-navy-900/90 transition"
            >
              &rarr;
            </button>
          </>
        )}
      </div>

      {hasMultiple && (
        <div className="flex gap-2 mt-3 overflow-x-auto">
          {images.map((url, index) => (
            <button
              key={url + index}
              type="button"
              onClick={() => setActiveIndex(index)}
              onKeyDown={handleKeyDown}
              className={`relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border-2 transition ${
                index === activeIndex ? "border-green-600" : "border-transparent opacity-80 hover:opacity-100"
              }`}
              aria-label={`Show photo ${index + 1} of ${images.length}`}
              aria-current={index === activeIndex}
            >
              <Image src={url} alt={`${title} — photo ${index + 1} of ${images.length}`} fill className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
