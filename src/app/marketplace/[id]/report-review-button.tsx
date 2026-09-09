"use client";

import { useActionState, useState } from "react";
import { REVIEW_REPORT_CATEGORIES, REPORT_CATEGORY_LABELS } from "@/lib/admin/reports";
import { reportReview, type ReviewReportState } from "@/app/dashboard/buying/actions";

const initialState: ReviewReportState = {};

/**
 * Same collapsed-toggle shape as ReportForm (src/app/conversations/[id]/
 * report-form.tsx) — a small "Report" link that expands into the reason
 * form — but built against reportReview() rather than ReportForm's
 * conversation/message/user actions, since a review report has no
 * conversation to bind to. Kept as its own small component rather than
 * widening ReportForm's ReportTarget union: ReportForm's actions all live
 * in src/app/conversations/actions.ts and share its rate-limit constants,
 * while reportReview() lives beside submitReview() in dashboard/buying/
 * actions.ts (reviews' own natural home) — importing across that boundary
 * into ReportForm would be a stranger coupling than just having a second,
 * near-identical small form.
 */
export default function ReportReviewButton({ reviewId }: { reviewId: number }) {
  const [state, formAction, pending] = useActionState(reportReview.bind(null, reviewId), initialState);
  const [open, setOpen] = useState(false);

  if (state.success) {
    return <p className="text-xs text-green-700">Thanks — our team will review this.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-ink-500 hover:text-red-600 transition"
      >
        Report this review
      </button>
    );
  }

  return (
    <form action={formAction} className="bg-cream-50 border border-line rounded-xl p-3.5 flex flex-col gap-2.5 max-w-sm">
      <select
        name="category"
        required
        defaultValue=""
        className="text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface"
      >
        <option value="" disabled>
          Choose a reason
        </option>
        {REVIEW_REPORT_CATEGORIES.map((c) => (
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
