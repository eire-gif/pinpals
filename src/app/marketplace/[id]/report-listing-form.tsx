"use client";

import { useActionState, useState } from "react";
import { REPORT_CATEGORIES, REPORT_CATEGORY_LABELS } from "@/lib/admin/reports";
import { reportListing, type ReportListingState } from "./actions";

const initialState: ReportListingState = {};

/**
 * The listing-page counterpart to conversations' ReportForm
 * (src/app/conversations/[id]/report-form.tsx) — same collapsed-behind-a-
 * toggle shape so it doesn't compete with the purchase actions for
 * attention, same reportX() Server Action pattern underneath.
 */
export default function ReportListingForm({ listingId }: { listingId: number }) {
  const action = reportListing.bind(null, listingId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [open, setOpen] = useState(false);

  if (state.success) {
    return (
      <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">
        Thanks — our team will review this listing.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-ink-500 hover:text-red-600 transition"
      >
        Report this listing
      </button>
    );
  }

  return (
    <form action={formAction} className="bg-cream-50 border border-line rounded-xl p-3.5 flex flex-col gap-2.5">
      <div className="text-xs font-bold text-ink-900">Report this listing</div>
      <select
        name="category"
        required
        defaultValue=""
        className="text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface"
      >
        <option value="" disabled>
          Choose a reason
        </option>
        {REPORT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {REPORT_CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      <textarea
        name="description"
        rows={2}
        placeholder="Anything else our team should know? (optional)"
        className="text-sm rounded-lg border-[1.5px] border-line px-3 py-2 resize-none bg-surface"
      />
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-full font-bold text-xs bg-red-600 text-cream-50 hover:bg-red-500 transition disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Submit report"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-4 py-2 rounded-full font-bold text-xs text-ink-500 hover:text-ink-900 transition"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
