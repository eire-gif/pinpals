"use client";

import { useActionState } from "react";

type SimpleActionState = { error?: string; success?: boolean };

const initialState: SimpleActionState = {};

/**
 * A single-click Server Action with no input field — for actions like
 * claiming or releasing a report, where asking for a "reason" would just be
 * busywork (the audit log entry's actor/timestamp already say who did what,
 * when). Same useActionState/pending/error/success shape as
 * src/components/admin/moderation-form.tsx, just without the required
 * textarea — kept as a separate component rather than making that
 * textarea optional, since every existing ModerationForm caller relies on
 * it always being there.
 */
export default function SimpleActionForm({
  action,
  idField,
  id,
  submitLabel,
  pendingLabel,
  tone = "default",
  successLabel = "Done — refreshing…",
}: {
  action: (state: SimpleActionState, formData: FormData) => Promise<SimpleActionState>;
  idField: string;
  id: string | number;
  submitLabel: string;
  pendingLabel: string;
  tone?: "default" | "danger";
  successLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  if (state.success) {
    return <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">{successLabel}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name={idField} value={id} />
      {state.error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
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
