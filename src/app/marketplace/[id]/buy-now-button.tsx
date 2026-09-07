"use client";

import { useState, useTransition } from "react";
import { buyNow } from "./actions";

/**
 * One button, both Buy Now paths (fixed-price/offers-allowed, and the Buy
 * It Now price on an auction_with_buy_now listing) — buyNow() itself
 * branches on sale_type server-side, so this component only ever needs the
 * listing id. Same useTransition + plain-button shape as offers-list.tsx's
 * respond()/publish-listing-button.tsx's publish(), not useActionState:
 * there's no form of its own, and a successful call never returns here —
 * buyNow() redirects straight to the new order's payment page.
 */
export default function BuyNowButton({
  listingId,
  label = "Buy Now",
  variant = "primary",
}: {
  listingId: number;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await buyNow(listingId);
      // A successful call never resolves here — redirect() has already
      // navigated the browser away. Only an error state comes back.
      if (result?.error) setError(result.error);
    });
  }

  const styles =
    variant === "primary"
      ? "bg-green-700 text-cream-50 hover:bg-green-600"
      : "border-[1.5px] border-green-700 text-green-700 hover:bg-green-100";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`w-full py-3.5 rounded-full font-bold transition disabled:opacity-60 ${styles}`}
      >
        {pending ? "Starting checkout…" : label}
      </button>
      {error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{error}</p>}
    </div>
  );
}
