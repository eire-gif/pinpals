"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { blockAction, unblockAction } from "@/app/feed/actions";

/**
 * Block or unblock, from a member's page. The confirmation is part of the
 * page rather than a browser dialog, because it has to say what a block
 * actually does — and that is more than "are you sure".
 */
export default function BlockControl({ memberId, name, blocked }: { memberId: string; name: string; blocked: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const first = name.split(" ")[0] || "this member";

  function run(action: "block" | "unblock") {
    setError(null);
    startTransition(async () => {
      const result = action === "block" ? await blockAction(memberId) : await unblockAction(memberId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (blocked) {
    return (
      <div className="grid gap-2 border-b border-line pb-4">
        <p className="text-sm">
          <span className="font-bold">You&rsquo;ve blocked {first}.</span>{" "}
          <span className="text-ink-500">Neither of you sees the other&rsquo;s posts or comments, or can message the other.</span>
        </p>
        <button
          type="button"
          onClick={() => run("unblock")}
          disabled={pending}
          className="justify-self-start px-4 py-2 rounded-full text-sm font-bold border-[1.5px] border-line hover:bg-cream-100 disabled:opacity-50"
        >
          {pending ? "Unblocking…" : `Unblock ${first}`}
        </button>
        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="grid gap-2 rounded-xl bg-red-100 p-3" role="alertdialog" aria-labelledby="block-title">
        <p id="block-title" className="text-sm font-bold text-ink-900">Block {name}?</p>
        <p className="text-[13px] text-ink-900">
          You won&rsquo;t see {first}&rsquo;s posts or comments, and {first} won&rsquo;t see yours. Neither of you can message the other.
          {" "}{first} isn&rsquo;t told, and you can unblock here at any time.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => run("block")}
            disabled={pending}
            className="px-4 py-2 rounded-full text-sm font-bold bg-red-600 text-white disabled:opacity-50"
          >
            {pending ? "Blocking…" : "Block"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="px-4 py-2 rounded-full text-sm font-bold text-ink-500">
            Cancel
          </button>
        </div>
        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="justify-self-start text-sm font-semibold text-ink-500 hover:text-red-600"
    >
      Block {first}
    </button>
  );
}
