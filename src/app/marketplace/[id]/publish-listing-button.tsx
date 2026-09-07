"use client";

import { useState, useTransition } from "react";
import { publishListing } from "./actions";

/** Same useTransition + plain-button shape as offers-list.tsx's respond()
 * rather than useActionState — this takes one argument (listingId) and has
 * no form fields of its own. */
export default function PublishListingButton({ listingId }: { listingId: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function publish() {
    setError(null);
    startTransition(async () => {
      const result = await publishListing(listingId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2 items-start">
      {error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{error}</p>}
      <button
        onClick={publish}
        disabled={pending}
        className="px-5 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Publishing…" : "Publish listing"}
      </button>
    </div>
  );
}
