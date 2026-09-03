"use client";

import { useActionState } from "react";
import type { ReportActionState } from "@/lib/admin/reports";
import { REPORT_PRIORITIES, REPORT_PRIORITY_LABELS, type ReportPriority } from "@/lib/admin/reports";
import { setReportPriority } from "./actions";

const initialState: ReportActionState = {};

export default function PriorityForm({ reportId, currentPriority }: { reportId: number; currentPriority: ReportPriority }) {
  const [state, formAction, pending] = useActionState(setReportPriority, initialState);

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="reportId" value={reportId} />
        <select
          name="priority"
          defaultValue={currentPriority}
          className="px-3 py-2 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          {REPORT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {REPORT_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition disabled:opacity-60"
        >
          {pending ? "Updating…" : "Update"}
        </button>
      </form>
      {state.error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
      {state.success && <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">Updated.</p>}
    </div>
  );
}
