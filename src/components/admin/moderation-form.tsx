"use client";

import { useActionState } from "react";
import type { ModerationState } from "@/lib/admin/moderation";

const initialState: ModerationState = {};

/**
 * One small form: a required "reason" textarea (recorded in the audit log —
 * see recordAdminAction()) plus a submit button, wired to a moderation
 * Server Action via useActionState. Shared by every admin detail page's
 * suspend/reinstate, hide/restore, cancel/restore controls so the six
 * actions in this slice don't each duplicate the same form/error/pending UI.
 *
 * Deliberately not optimistic: on success it shows a brief confirmation and
 * leaves the rest to the server — the enclosing Server Component re-fetches
 * via revalidatePath() and swaps this form out for whichever one matches the
 * new status (e.g. "Hide" becomes "Restore"), consistent with the rest of
 * this admin console being server-rendered rather than client-state-driven.
 */
export default function ModerationForm({
  action,
  idField,
  id,
  submitLabel,
  pendingLabel,
  tone = "default",
  placeholder = "Reason (recorded in the audit log)",
  // Every existing caller (suspend/reinstate, hide/restore, cancel/restore)
  // is a "reason for a status change", hence the default. The admin notes
  // form (src/app/admin/users/[id]/page.tsx) reuses this same component for
  // a free-text note body rather than a reason, so it overrides this to
  // "note" — existing callers are unaffected since they don't pass it.
  fieldName = "reason",
}: {
  action: (state: ModerationState, formData: FormData) => Promise<ModerationState>;
  idField: string;
  id: string | number;
  submitLabel: string;
  pendingLabel: string;
  tone?: "default" | "danger";
  placeholder?: string;
  fieldName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  if (state.success) {
    return (
      <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">
        Done — refreshing…
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name={idField} value={id} />
      <textarea
        name={fieldName}
        required
        rows={2}
        placeholder={placeholder}
        className="w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 resize-none bg-surface"
      />
      {state.error && (
        <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className={`self-start px-4 py-2 rounded-full font-bold text-sm transition disabled:opacity-60 ${
          tone === "danger"
            ? "bg-red-600 text-cream-50 hover:bg-red-500"
            : "bg-navy-900 text-cream-50 hover:bg-navy-800"
        }`}
      >
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
