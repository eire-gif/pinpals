"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleFavourite } from "./actions";

/**
 * The card-level favourite/save control (this phase's spec: "favourite
 * control and accessible labels"). Sits on top of the cover image
 * (listing-card.tsx), so it's a real <button> with stopPropagation — the
 * card itself is a <Link> to the listing, and a favourite click must never
 * also navigate there.
 *
 * A signed-out visitor still sees the control (never hidden — a guest
 * browsing the marketplace shouldn't wonder why some cards have a heart and
 * others don't) but a click sends them to sign in rather than silently
 * failing, since listing_favourites' RLS requires a real auth.uid().
 */
export default function FavouriteButton({
  listingId,
  initialFavourited,
  signedIn,
}: {
  listingId: number;
  initialFavourited: boolean;
  signedIn: boolean;
}) {
  const [favourited, setFavourited] = useState(initialFavourited);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!signedIn) {
      router.push("/login");
      return;
    }

    const next = !favourited;
    setFavourited(next); // optimistic — reverted below if the write fails
    startTransition(async () => {
      const result = await toggleFavourite(listingId);
      if ("error" in result) {
        setFavourited(!next);
      }
    });
  }

  const label = favourited ? "Remove from favourites" : "Save to favourites";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-pressed={favourited}
      aria-label={label}
      title={label}
      className="absolute top-3 left-3 w-9 h-9 rounded-full bg-navy-900/70 hover:bg-navy-900/90 backdrop-blur-sm flex items-center justify-center transition disabled:opacity-70"
    >
      <svg
        className={`w-[18px] h-[18px] transition ${favourited ? "text-gold-500" : "text-white"}`}
        viewBox="0 0 24 24"
        fill={favourited ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 21s-6.7-4.35-9.33-8.2C1.02 10.6 1.6 7.2 4.5 5.7c2.3-1.2 4.9-.4 6.5 1.6a1 1 0 001.5 0c1.6-2 4.2-2.8 6.5-1.6 2.9 1.5 3.48 4.9 1.83 7.1C18.7 16.65 12 21 12 21z"
        />
      </svg>
    </button>
  );
}
