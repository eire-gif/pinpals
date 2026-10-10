"use client";

import { useActionState, useEffect, useRef, startTransition } from "react";

type FieldsActionState = { error?: string; success?: boolean };

const initialState: FieldsActionState = {};

/**
 * A Server Action form whose fields are rendered by the (server) caller and
 * passed in as children — for the multi-field editors in /admin/marketplace
 * (shop commission, affiliate products, sponsored banners) that don't fit
 * ModerationForm's single-textarea shape. Same useActionState/pending/error
 * pattern as src/components/admin/moderation-form.tsx.
 *
 * Submits through onSubmit rather than the form `action` prop on purpose:
 * React resets a form after an action-prop submission whatever the
 * outcome, which would wipe a long banner form on a validation error. Here
 * the fields stay as typed on an error; `resetOnSuccess` clears a "create"
 * form once the server accepted it, while an "edit" form keeps its values
 * (the server re-renders them via revalidatePath anyway).
 */
export default function FieldsActionForm({
  action,
  submitLabel,
  pendingLabel,
  children,
  resetOnSuccess = false,
  className = "grid gap-3",
  successLabel = "Saved.",
}: {
  action: (state: FieldsActionState, formData: FormData) => Promise<FieldsActionState>;
  submitLabel: string;
  pendingLabel: string;
  children: React.ReactNode;
  resetOnSuccess?: boolean;
  className?: string;
  successLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={formRef}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-full font-bold text-sm transition disabled:opacity-60 bg-navy-900 text-cream-50 hover:bg-navy-800"
        >
          {pending ? pendingLabel : submitLabel}
        </button>
        {!pending && state.error && (
          <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>
        )}
        {!pending && state.success && (
          <p className="text-xs text-green-700 bg-green-100 rounded-lg px-3 py-2">{successLabel}</p>
        )}
      </div>
    </form>
  );
}
