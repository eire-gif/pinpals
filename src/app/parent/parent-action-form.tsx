"use client";

import { useActionState, type ReactNode } from "react";
import type { ParentActionState } from "./actions";

const initialState: ParentActionState = {};

/**
 * One small form on the parent dashboard: hidden fields and inputs from the
 * server page, a submit button, and the action's answer underneath. The page
 * re-renders from the server after each change (revalidatePath).
 */
export default function ParentActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving…",
  tone = "default",
  className = "",
}: {
  action: (state: ParentActionState, formData: FormData) => Promise<ParentActionState>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  tone?: "default" | "quiet" | "danger";
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const button =
    tone === "danger"
      ? "bg-red-600 text-cream-50 hover:bg-red-500"
      : tone === "quiet"
        ? "bg-cream-100 text-ink-900 hover:bg-line"
        : "bg-green-700 text-cream-50 hover:bg-green-600";

  return (
    <form action={formAction} className={`grid gap-2 ${className}`}>
      {children}
      <button type="submit" disabled={pending} className={`justify-self-start px-4 py-2 rounded-full font-bold text-sm transition disabled:opacity-60 ${button}`}>
        {pending ? pendingLabel : submitLabel}
      </button>
      {state.error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
      {state.done && <p className="text-xs text-green-800 bg-green-100 rounded-lg px-3 py-2">{state.done}</p>}
    </form>
  );
}
