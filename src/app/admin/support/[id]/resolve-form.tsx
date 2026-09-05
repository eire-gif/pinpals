"use client";

import { useActionState } from "react";
import type { SupportCaseActionState } from "@/lib/admin/support-cases";
import { resolveCase } from "./actions";

const initialState: SupportCaseActionState = {};

export default function ResolveCaseForm({ caseId }: { caseId: number }) {
  const [state, formAction, pending] = useActionState(resolveCase, initialState);

  if (state.success) {
    return <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">Resolved — refreshing…</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      <textarea
        name="resolution"
        required
        rows={3}
        placeholder="Resolution summary (recorded in the audit log)"
        className="w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 resize-none bg-surface"
      />
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
