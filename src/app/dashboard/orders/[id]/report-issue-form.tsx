"use client";

import { useActionState, useState } from "react";
import { ORDER_REPORT_CATEGORIES, REPORT_CATEGORY_LABELS } from "@/lib/admin/reports";
import { reportOrderIssue, type OrderActionState } from "./actions";

const initialState: OrderActionState = {};

/**
 * The order-page counterpart to ReportForm/ReportListingForm — same
 * collapsed-behind-a-toggle shape, same reportX() Server Action pattern,
 * but order-shaped: a "wants a refund" checkbox (reports.wants_refund,
 * 0055_marketplace_trust_safety.sql) alongside the usual category/
 * description/evidence fields, and only ORDER_REPORT_CATEGORIES on offer —
 * "Fake listing" or "Harassment" don't make sense once there's a completed
 * order to report an issue against.
 */
export default function ReportIssueForm({ orderId }: { orderId: number }) {
  const action = reportOrderIssue.bind(null, orderId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [open, setOpen] = useState(false);

  if (state.success) {
    return (
      <p className="text-sm text-green-700 bg-green-100 rounded-lg px-4 py-3">
        Thanks — our team will review this order and be in touch.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-ink-500 hover:text-red-600 transition"
      >
        Report an issue with this order
      </button>
    );
  }

  return (
    <form action={formAction} className="bg-surface border border-line rounded-2xl shadow-sm p-5 flex flex-col gap-3">
      <div className="font-display font-bold text-ink-900">Report an issue with this order</div>
      <select
        name="category"
        required
        defaultValue=""
        className="text-sm rounded-lg border-[1.5px] border-line px-3 py-2.5 bg-cream-50"
      >
        <option value="" disabled>
          Choose a reason
        </option>
        {ORDER_REPORT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {REPORT_CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      <textarea
        name="description"
        rows={3}
        placeholder="What happened?"
        className="text-sm rounded-lg border-[1.5px] border-line px-3 py-2.5 resize-none bg-cream-50"
      />
      <textarea
        name="evidence"
        rows={2}
        placeholder="Links or references for evidence — one per line (optional)"
        className="text-sm rounded-lg border-[1.5px] border-line px-3 py-2.5 resize-none bg-cream-50"
      />
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" name="wantsRefund" value="true" className="w-4 h-4" />
        I&rsquo;d like to request a refund for this order
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-red-600 text-cream-50 hover:bg-red-500 transition disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Submit report"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-5 py-2.5 rounded-full font-bold text-sm text-ink-500 hover:text-ink-900 transition"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
