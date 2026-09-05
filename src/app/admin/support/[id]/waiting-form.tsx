"use client";

import { useActionState } from "react";
import type { SupportCaseActionState } from "@/lib/admin/support-cases";
import { setCaseWaitingOnMember } from "./actions";

const initialState: SupportCaseActionState = {};

/** Toggles a claimed case between "claimed" (actively being worked) and
 * "waiting_on_member" (blocked on the member's own reply) — the one
 * non-terminal status change a case goes through beyond claim/release. */
export default function WaitingForm({ caseId, isWaiting }: { caseId: number; isWaiting: boolean }) {
  const [state, formAction, pending] = useActionState(setCaseWaitingOnMember, initialState);

  if (state.success) {
    return <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">Updated — refreshing…</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="waiting" value={isWaiting ? "false" : "true"} />
      {state.error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start px-4 py-2 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition disabled:opacity-60"
      >
        {pending ? "Updating…" : isWaiting ? "Mark back in progress" : "Mark waiting on member"}
      </button>
    </form>
  );
}
