"use client";

import { useActionState } from "react";
import type { SupportCaseActionState } from "@/lib/admin/support-cases";
import { SUPPORT_CASE_PRIORITIES, SUPPORT_CASE_PRIORITY_LABELS, type SupportCasePriority } from "@/lib/admin/support-cases";
import { setCasePriority } from "./actions";

const initialState: SupportCaseActionState = {};

export default function PriorityForm({ caseId, currentPriority }: { caseId: number; currentPriority: SupportCasePriority }) {
  const [state, formAction, pending] = useActionState(setCasePriority, initialState);

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="caseId" value={caseId} />
        <select
          name="priority"
          defaultValue={currentPriority}
          className="px-3 py-2 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          {SUPPORT_CASE_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {SUPPORT_CASE_PRIORITY_LABELS[p]}
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
