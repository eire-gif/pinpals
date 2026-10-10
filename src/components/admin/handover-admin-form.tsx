"use client";

import { useActionState } from "react";

type State = { error?: string; success?: boolean };

/** Release a held sale to the seller now, or freeze its automatic release (0114). */
export default function HandoverAdminForm({ orderId, action }: { orderId: number; action: (prev: State, fd: FormData) => Promise<State> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-3 max-w-lg">
      <input type="hidden" name="orderId" value={orderId} />
      <textarea name="reason" rows={2} required placeholder="Reason (audit log)" className="rounded-lg border border-line px-3 py-2 bg-surface text-sm" />
      <div className="flex gap-2">
        <button name="action" value="release" disabled={pending} className="px-4 py-2 rounded-full bg-green-700 text-cream-50 text-sm font-bold disabled:opacity-60">
          Release to seller now
        </button>
        <button name="action" value="hold" disabled={pending} className="px-4 py-2 rounded-full border border-red-600 text-red-600 text-sm font-bold disabled:opacity-60">
          Hold (freeze release)
        </button>
      </div>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-green-700">Done.</p> : null}
    </form>
  );
}
