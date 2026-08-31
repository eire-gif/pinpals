"use client";

import { useActionState } from "react";
import { signUp, type SignUpState } from "./actions";

const initialState: SignUpState = {};

export default function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  if (state.success) {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 rounded-full bg-green-100 text-green-700 flex items-center justify-center mx-auto mb-4">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M4 4h16v16H4z" opacity="0" />
            <path d="M3 7l9 6 9-6" />
            <path d="M21 7v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </div>
        <h2 className="font-display font-bold text-2xl mb-2">Check your inbox</h2>
        <p className="text-ink-500">
          We&rsquo;ve sent a confirmation link. Click it to activate your account and set up your
          home club and handicap.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="first" className="text-[13.5px] font-bold">First name</label>
          <input id="first" name="first" required autoComplete="given-name"
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="last" className="text-[13.5px] font-bold">Last name</label>
          <input id="last" name="last" required autoComplete="family-name"
            className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="email" className="text-[13.5px] font-bold">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email"
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="password" className="text-[13.5px] font-bold">Password</label>
        <input id="password" name="password" type="password" required minLength={6} autoComplete="new-password"
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        <span className="text-xs text-ink-500">At least 6 characters.</span>
      </div>

      {state.error && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Creating your account…" : "Create my account"}
      </button>
    </form>
  );
}
