"use client";

import { useActionState } from "react";
import { openStripeAccountManagement, type ManageOnStripeState } from "./actions";

const initialState: ManageOnStripeState = {};

/** Same shape as ../start-onboarding-button.tsx — a single control that
 * either redirects to Stripe on success or shows why it couldn't. */
export default function ManageOnStripeButton() {
  const [state, formAction, pending] = useActionState(openStripeAccountManagement, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 items-start">
      {state.error && (
        <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="px-5 py-3 rounded-full font-bold bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
      >
        {pending ? "Opening Stripe…" : "Manage bank & account details on Stripe"}
      </button>
    </form>
  );
}
