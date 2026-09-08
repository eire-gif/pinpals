"use client";

import { useState, useTransition } from "react";
import { muteUser, unmuteUser } from "../actions";

/**
 * Mute/unmute the other participant — the private counterpart to
 * BlockControl (same file's sibling). Unlike blocking, muting never
 * restricts what the other person can do; it's purely a personal signal
 * for the muter's own inbox (see muteUser()'s own comment in ../actions.ts
 * and muted_users' header comment in 0055_marketplace_trust_safety.sql).
 */
export default function MuteControl({ otherUserId, initiallyMuted }: { otherUserId: string; initiallyMuted: boolean }) {
  const [muted, setMuted] = useState(initiallyMuted);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = muted ? await unmuteUser(otherUserId) : await muteUser(otherUserId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMuted(!muted);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`text-xs font-semibold transition disabled:opacity-60 ${
          muted ? "text-green-700 hover:text-green-800" : "text-ink-500 hover:text-ink-900"
        }`}
      >
        {pending ? "Working…" : muted ? "Unmute" : "Mute"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
