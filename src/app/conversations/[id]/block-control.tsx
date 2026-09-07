"use client";

import { useState, useTransition } from "react";
import { blockUser, unblockUser } from "../actions";

/**
 * Block/unblock the other participant. Blocking doesn't hide or delete
 * anything already said (see blockUser()'s own comment) — it only stops
 * future messages either direction (messages' insert policy, 0049) and new
 * conversations (can_message(), 0049) until unblocked.
 */
export default function BlockControl({ otherUserId, initiallyBlocked }: { otherUserId: string; initiallyBlocked: boolean }) {
  const [blocked, setBlocked] = useState(initiallyBlocked);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = blocked ? await unblockUser(otherUserId) : await blockUser(otherUserId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBlocked(!blocked);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`text-xs font-semibold transition disabled:opacity-60 ${
          blocked ? "text-green-700 hover:text-green-800" : "text-ink-500 hover:text-red-600"
        }`}
      >
        {pending ? "Working…" : blocked ? "Unblock" : "Block"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
