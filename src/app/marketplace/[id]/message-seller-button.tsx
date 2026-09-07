"use client";

import { useState, useTransition } from "react";
import { startConversation } from "@/app/conversations/actions";

/**
 * The seller card's Message button (this phase's spec). startConversation()
 * (src/app/conversations/actions.ts) already exists and already redirects
 * on success — it's what a marketplace offer/negotiation is meant to route
 * through once eligibility is established (can_message(), see
 * supabase/migrations/0025_messaging.sql), so this is a thin client wrapper
 * around it rather than a second messaging entry point. Passing `listingId`
 * is what makes this a marketplace conversation rather than a generic one —
 * see 0049_marketplace_messaging.sql's listing-scoped uniqueness: the same
 * buyer/seller pair gets a fresh thread per listing they message about,
 * never merged into one catch-all conversation.
 */
export default function MessageSellerButton({ sellerId, listingId }: { sellerId: string; listingId: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await startConversation(sellerId, listingId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="w-full py-2.5 rounded-full font-bold text-sm border-[1.5px] border-navy-900 text-navy-900 hover:bg-cream-100 transition disabled:opacity-60"
      >
        {pending ? "Opening…" : "Message seller"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
