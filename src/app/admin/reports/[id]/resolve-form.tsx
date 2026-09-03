"use client";

import { useActionState } from "react";
import type { ReportActionState } from "@/lib/admin/reports";
import { formatDateTime } from "@/lib/admin/format";
import { resolveReport } from "./actions";

const initialState: ReportActionState = {};

/**
 * Resolution form: a required summary plus an optional picker over this
 * report's own target's moderation history (see getReportDetail()'s
 * targetModerationHistory) — never a free-text id field, so staff can only
 * ever pick from actions that are already known to belong to this report's
 * target. resolveReport() re-verifies that belonging server-side regardless
 * (see the comment there) — this UI restriction is a convenience, not the
 * security boundary.
 */
export default function ResolveReportForm({
  reportId,
  moderationHistory,
}: {
  reportId: number;
  moderationHistory: { id: number; action: string; created_at: string }[];
}) {
  const [state, formAction, pending] = useActionState(resolveReport, initialState);

  if (state.success) {
    return <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">Resolved — refreshing…</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="reportId" value={reportId} />
      <textarea
        name="resolution"
        required
        rows={3}
        placeholder="Resolution summary (recorded in the audit log)"
        className="w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 resize-none bg-surface"
      />
      {moderationHistory.length > 0 && (
        <select
          name="linkedActionId"
          defaultValue=""
          className="w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface"
        >
          <option value="">No specific moderation action to link (optional)</option>
          {moderationHistory.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.action} · {formatDateTime(entry.created_at)}
            </option>
          ))}
        </select>
      )}
      {state.error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start px-4 py-2 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
      >
        {pending ? "Resolving…" : "Resolve"}
      </button>
    </form>
  );
}
