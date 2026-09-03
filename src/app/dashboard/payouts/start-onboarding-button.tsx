"use client";

import { useActionState } from "react";
import { startOrResumeOnboarding, type OnboardingState } from "./actions";

const initialState: OnboardingState = {};

/**
 * The one control on /dashboard/payouts that actually does anything —
 * everything else on the page is a read-only status summary. Redirects to
 * Stripe on success, so there's no "success" state to render here the way
 * src/components/admin/simple-action-form.tsx has one; an error means the
 * redirect never happened.
 */
export default function StartOnboardingButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const [state, formAction, pending] = useActionState(startOrResumeOnboarding, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 items-start">
      {state.error && (
        <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="px-5 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? pendingLabel : label}
      </button>
    </form>
  );
}
