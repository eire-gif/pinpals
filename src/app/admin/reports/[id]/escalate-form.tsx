"use client";

import { useActionState } from "react";
import type { ReportActionState } from "@/lib/admin/reports";
import { ESCALATION_ROLES } from "@/lib/admin/reports";
import { ROLE_LABELS } from "@/lib/admin/roles";
import { escalateReport } from "./actions";

const initialState: ReportActionState = {};

/**
 * Hands this report to a specific higher role — see escalateReport()'s own
 * comment for who may call this (any active staff member, not just
 * MODERATION_ROLES) and why. Same required-reason-textarea shape as
 * ModerationForm, plus a role picker ModerationForm's fixed one-extra-field
 * shape can't express.
 */
export default function EscalateForm({ reportId }: { reportId: number }) {
  const [state, formAction, pending] = useActionState(escalateReport, initialState);

  if (state.success) {
    return <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">Escalated — refreshing…</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="reportId" value={reportId} />
      <select
        name="escalatedToRole"
        required
        defaultValue=""
        className="px-3 py-2 rounded-full border-[1.5px] border-line bg-surface text-sm"
      >
        <option value="" disabled>
          Escalate to…
        </option>
        {ESCALATION_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <textarea
        name="reason"
        required
        rows={2}
        placeholder="Why this needs a higher role (recorded in the audit log)"
        className="text-sm rounded-lg border-[1.5px] border-line px-3 py-2 resize-none bg-surface"
      />
      {state.error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start px-4 py-2 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition disabled:opacity-60"
      >
        {pending ? "Escalating…" : "Escalate"}
      </button>
    </form>
  );
}
