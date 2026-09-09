"use client";

import { useState } from "react";

/** Mirrors listingDescriptionSchema's max in src/lib/validation/listing.ts. */
export const MAX_DESCRIPTION_LENGTH = 2000;

/** Below this a description isn't really telling a buyer anything — used
 * only to decide whether to nudge, never to block a submission. */
const SHORT_DESCRIPTION_LENGTH = 40;

const PROMPTS = [
  "How much has it been used?",
  "Any marks, dents or wear?",
  "What's included — headcover, tool, receipt?",
  "Why are you selling it?",
];

/**
 * The listing description box. The field itself is not new — what's new is
 * that it now looks like it matters: prompts for what to actually write, a
 * live counter, and a gentle nudge when a description is so short it won't
 * help anyone. Descriptions are searchable (search_marketplace_listings()
 * matches them alongside title, model and brand), so a well-written one is
 * the difference between a listing being findable and being invisible —
 * which is worth saying out loud to the seller rather than leaving them to
 * guess from an unlabelled textarea.
 *
 * Deliberately still optional and still unblocked: a nudge, not a gate. A
 * seller in a hurry gets their listing up either way.
 */
export default function DescriptionField({
  defaultValue = "",
  disabled = false,
  error,
}: {
  defaultValue?: string;
  disabled?: boolean;
  error?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const trimmed = value.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < SHORT_DESCRIPTION_LENGTH;

  return (
    <div className="grid gap-1.5">
      <label htmlFor="description" className="text-[13.5px] font-bold">
        Description <span className="font-normal text-ink-500">(optional, but it sells the item)</span>
      </label>
      <p className="text-xs text-ink-500 -mt-0.5">{PROMPTS.join(" · ")}</p>
      <textarea
        id="description"
        name="description"
        rows={5}
        maxLength={MAX_DESCRIPTION_LENGTH}
        disabled={disabled}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Bought new in 2023, played about a dozen rounds. Small sky mark on the crown, otherwise mint. Comes with the original headcover and adjustment tool."
        className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 bg-surface disabled:opacity-60 resize-y"
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-ink-500">
          {tooShort
            ? "A line or two more — condition and what's included — gets far more replies."
            : "Buyers can search the words you write here."}
        </p>
        <span className="text-xs text-ink-500 shrink-0 tabular-nums">
          {value.length}/{MAX_DESCRIPTION_LENGTH}
        </span>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
