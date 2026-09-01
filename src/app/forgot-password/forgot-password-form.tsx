"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = {};

export default function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  if (state.success) {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 rounded-full bg-green-100 text-green-700 flex items-center justify-center mx-auto mb-4">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 7l9 6 9-6" />
            <path d="M21 7v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </div>
        <h2 className="font-display font-bold text-2xl mb-2">Check your inbox</h2>
        <p className="text-ink-500">
          If that email belongs to a Pinpals account, we&rsquo;ve sent a link to reset your
          password. It expires after a short while, so use it soon.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="email" className="text-[13.5px] font-bold">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email"
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        <span className="text-xs text-ink-500">We&rsquo;ll email you a link to set a new password.</span>
      </div>

      {state.error && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Sending link…" : "Send reset link"}
      </button>
    </form>
  );
}
