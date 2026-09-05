"use client";

import { useActionState } from "react";
import type { SupportCaseActionState } from "@/lib/admin/support-cases";
import { formatDateTime } from "@/lib/admin/format";
import { linkCaseAction } from "./actions";

const initialState: SupportCaseActionState = {};

/**
 * Points this case at an existing, already-authorized admin_audit_log
 * row — never a free-text id field, so staff can only ever pick from
 * actions already known to belong to this case's own requester or linked
 * record (see getSupportCaseDetail()'s requesterAccountHistory/
 * linkedTargetHistory). linkCaseAction() re-verifies that belonging
 * server-side regardless (see the comment there) — this UI restriction is a
 * convenience, not the security boundary.
 */
export default function LinkActionForm({
  caseId,
  candidates,
}: {
  caseId: number;
  candidates: { id: number; action: string; created_at: string; source: "member" | "linked record" }[];
}) {
  const [state, formAction, pending] = useActionState(linkCaseAction, initialState);

  if (state.success) {
    return <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">Linked — refreshing…</p>;
  }

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-ink-500">
        No moderation actions recorded yet against this case&rsquo;s member or linked record.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      <select
        name="auditLogId"
        required
        defaultValue=""
        className="w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface"
      >
        <option value="" disabled>
          Choose an action to link…
        </option>
        {candidates.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.action} · {entry.source} · {formatDateTime(entry.created_at)}
          </option>
        ))}
      </select>
      <input
        type="text"
        name="note"
        placeholder="Why this action is relevant to this case (optional)"
        className="w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 bg-surface"
      />
      {state.error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start px-4 py-2 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition disabled:opacity-60"
      >
        {pending ? "Linking…" : "Link action"}
      </button>
    </form>
  );
}
