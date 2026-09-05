"use client";

import { useActionState } from "react";
import type { ModerationState } from "@/lib/admin/moderation";
import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from "@/lib/admin/roles";
import { changeStaffRole } from "./actions";

const initialState: ModerationState = {};

/**
 * Per-row "change role" control on /admin/staff. Reuses ModerationState (not
 * a bespoke type) since it needs nothing beyond error/success, but can't
 * reuse ModerationForm itself — that component only has room for a hidden id
 * and a reason textarea, and this needs a role <select> too.
 */
export default function ChangeRoleForm({ userId, currentRole }: { userId: string; currentRole: StaffRole }) {
  const [state, formAction, pending] = useActionState(changeStaffRole, initialState);

  if (state.success) {
    return <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">Done — refreshing…</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={currentRole}
        className="px-3 py-2 rounded-lg border-[1.5px] border-line bg-surface text-xs"
      >
        {STAFF_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <textarea
        name="reason"
        required
        rows={2}
        placeholder="Reason (recorded in the audit log)"
        className="w-full text-xs rounded-lg border-[1.5px] border-line px-3 py-2 resize-none bg-surface"
      />
      {state.error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start px-3 py-1.5 rounded-full font-bold text-xs bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Change role"}
      </button>
    </form>
  );
}
