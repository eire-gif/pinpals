"use client";

import { useActionState } from "react";
import { ROLE_LABELS, STAFF_ROLES } from "@/lib/admin/roles";
import { grantStaffRole, type GrantStaffState } from "./actions";

const initialState: GrantStaffState = {};

// Mirrors src/app/admin/support/new/form.tsx's member-lookup + disambiguation
// pattern: the "member" field is never trusted as an identity by itself —
// the server action resolves it to a real profiles row, and shows candidates
// when more than one matches rather than guessing.
export default function GrantStaffForm() {
  const [state, formAction, pending] = useActionState(grantStaffRole, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-xl">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-900">Member</span>
        <input
          type="text"
          name="member"
          required
          placeholder="Email or full name"
          className="px-4 py-2.5 rounded-lg border-[1.5px] border-line bg-surface text-sm"
        />
        {state.candidates && state.candidates.length > 0 && (
          <ul className="text-xs text-ink-500 mt-1 list-disc list-inside">
            {state.candidates.map((c) => (
              <li key={c.id}>
                {c.name} {c.email && <>— {c.email}</>}
              </li>
            ))}
          </ul>
        )}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-900">Role</span>
        <select
          name="role"
          required
          defaultValue=""
          className="px-4 py-2.5 rounded-lg border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="" disabled>
            Choose…
          </option>
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink-900">Reason</span>
        <textarea
          name="reason"
          required
          rows={2}
          placeholder="Why this member is getting staff access — recorded in the audit log"
          className="px-4 py-2.5 rounded-lg border-[1.5px] border-line bg-surface text-sm resize-none"
        />
      </label>

      {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-4 py-3">{state.error}</p>}

      {state.success ? (
        <p className="text-sm text-green-700 bg-green-100 rounded-lg px-4 py-3">Granted — refreshing…</p>
      ) : (
        <button
          type="submit"
          disabled={pending}
          className="self-start px-6 py-3 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
        >
          {pending ? "Granting…" : "Grant staff access"}
        </button>
      )}
    </form>
  );
}
