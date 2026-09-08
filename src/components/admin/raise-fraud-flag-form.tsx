"use client";

import { useActionState, useState } from "react";
import {
  FRAUD_FLAG_SEVERITIES,
  FRAUD_FLAG_SEVERITY_LABELS,
  FRAUD_FLAG_TYPES,
  FRAUD_FLAG_TYPE_LABELS,
  type FraudFlagTargetType,
} from "@/lib/admin/risk";
import { raiseFraudFlag, type FraudFlagActionState } from "@/app/admin/risk-flags/actions";

const initialState: FraudFlagActionState = {};

/**
 * Raises a fraud/risk flag against one target — embedded on the user/
 * listing/order detail pages (via RiskFlagsPanel) and reused as-is. Any
 * active staff member may raise one — see raiseFraudFlag()'s own comment —
 * so this isn't gated here beyond the page that renders it already being
 * behind requireStaff(). Collapsed behind a toggle, same "don't compete
 * with the primary content for attention" shape as ReportForm/
 * ReportListingForm.
 */
export default function RaiseFraudFlagForm({ targetType, targetId }: { targetType: FraudFlagTargetType; targetId: string }) {
  const [state, formAction, pending] = useActionState(raiseFraudFlag, initialState);
  const [open, setOpen] = useState(false);

  if (state.success) {
    return <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">Flag raised — refreshing…</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-ink-500 hover:text-red-600 transition"
      >
        Raise a risk flag
      </button>
    );
  }

  return (
    <form action={formAction} className="bg-cream-50 border border-line rounded-xl p-3.5 flex flex-col gap-2.5">
      <input type="hidden" name="targetType" value={targetType} />
      <input type="hidden" name="targetId" value={targetId} />
      <div className="text-xs font-bold text-ink-900">Raise a risk flag</div>
      <p className="text-xs text-ink-500">
        An internal signal for staff only — never shown to members, never itself suspends or removes anything.
      </p>
      <div className="flex gap-2">
        <select name="flagType" required defaultValue="" className="flex-1 text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface">
          <option value="" disabled>
            Flag type
          </option>
          {FRAUD_FLAG_TYPES.map((t) => (
            <option key={t} value={t}>
              {FRAUD_FLAG_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select name="severity" defaultValue="medium" className="text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface">
          {FRAUD_FLAG_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {FRAUD_FLAG_SEVERITY_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <textarea
        name="note"
        required
        rows={2}
        placeholder="Why this looks risky (staff-only)"
        className="text-sm rounded-lg border-[1.5px] border-line px-3 py-2 resize-none bg-surface"
      />
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-full font-bold text-xs bg-red-600 text-cream-50 hover:bg-red-500 transition disabled:opacity-60"
        >
          {pending ? "Raising…" : "Raise flag"}
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
