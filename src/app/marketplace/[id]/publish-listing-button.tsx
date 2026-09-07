"use client";

import { useId, useState, useTransition } from "react";
import { publishListing } from "./actions";

/** Same useTransition + plain-button shape as offers-list.tsx's respond()
 * rather than useActionState — this takes one argument (listingId) and has
 * no form fields of its own, aside from the confirmation checkbox below.
 *
 * Requiring the checkbox before the button even becomes clickable is the
 * "require confirmation before publication" half of this task's spec — the
 * "preview" half is the listing detail page itself: everything above this
 * button on the page (../page.tsx) already renders exactly what a buyer
 * will see once this listing goes live, so there's no separate preview
 * screen to build, just an explicit acknowledgment gate before the
 * irreversible-feeling step of making it public. */
export default function PublishListingButton({ listingId }: { listingId: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const checkboxId = useId();

  function publish() {
    setError(null);
    startTransition(async () => {
      const result = await publishListing(listingId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3 items-start">
      <label htmlFor={checkboxId} className="flex items-start gap-2 text-sm text-ink-900 cursor-pointer">
        <input
          id={checkboxId}
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5"
        />
        I&apos;ve reviewed the photos, price and details above and I&apos;m ready for buyers to see this listing.
      </label>

      {error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{error}</p>}

      <button
        onClick={publish}
        disabled={pending || !confirmed}
        className="px-5 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Publishing…" : "Publish listing"}
      </button>
    </div>
  );
}
