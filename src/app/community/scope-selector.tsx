"use client";

import { DIRECTORY_SCOPES, SCOPE_DESCRIPTIONS, SCOPE_LABELS, type DirectoryScope } from "@/lib/community";

/**
 * The All members / My club / My connections switch on Find Golfers.
 *
 * A client component for one reason: picking an option applies it
 * immediately, rather than selecting it and waiting for the member to find
 * the Search button. The other controls in this bar genuinely are a search —
 * you type, you adjust, you submit once. This isn't; it's a switch between
 * three different lists, and a switch that needs confirming doesn't feel
 * like a switch.
 *
 * It submits the surrounding form rather than pushing a URL of its own, so
 * whatever is already typed in the search box and set in the country, county
 * and sort controls is carried along untouched.
 *
 * With JavaScript off the onChange never fires, the radio still checks, and
 * pressing Search still applies it — the same behaviour this had before, so
 * nothing is lost, only a step removed.
 */
export default function ScopeSelector({ value }: { value: DirectoryScope }) {
  return (
    <fieldset className="w-full border-t border-line pt-4 mt-0.5">
      <legend className="sr-only">Who to show</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {DIRECTORY_SCOPES.map((option) => (
          <label
            key={option}
            className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 cursor-pointer border-[1.5px] transition ${
              value === option ? "border-green-600 bg-surface" : "border-line bg-surface-tint"
            }`}
          >
            <input
              type="radio"
              name="scope"
              value={option}
              defaultChecked={value === option}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="w-4 h-4 mt-0.5 accent-green-700 shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{SCOPE_LABELS[option]}</span>
              <span className="block text-[12.5px] text-ink-500 mt-0.5 leading-snug">
                {SCOPE_DESCRIPTIONS[option]}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
