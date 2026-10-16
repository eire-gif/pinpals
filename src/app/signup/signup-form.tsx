"use client";

import { useActionState, useState } from "react";
import DateOfBirthFields from "@/components/date-of-birth-fields";
import { ageFromIso, checkDateOfBirth, MIN_JOIN_AGE, PARENT_LINK_AGE } from "@/lib/junior";
import { signUp, type SignUpState } from "./actions";

const initialState: SignUpState = {};

export default function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);
  // Only to decide whether to show the parent's email field. The server
  // checks the date again (src/lib/signup.ts) — this is a convenience.
  const [dob, setDob] = useState("");
  const checked = checkDateOfBirth(dob);
  const age = checked.ok ? ageFromIso(checked.date) : null;
  const needsParent = age !== null && age >= MIN_JOIN_AGE && age < PARENT_LINK_AGE;

  if (state.blocked) {
    return <p className="text-center text-ink-900 py-4">{state.error}</p>;
  }

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
        {state.needsParent && (
          <p className="text-ink-500 mt-3">
            We&rsquo;ve also emailed your parent or guardian. Once they say yes, live scoring and
            sharing your rounds switch on.
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-1.5 min-w-0">
          <label htmlFor="first" className="text-[13.5px] font-bold">First name</label>
          <input id="first" name="first" required autoComplete="given-name"
            className="w-full px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        </div>
        <div className="grid gap-1.5 min-w-0">
          <label htmlFor="last" className="text-[13.5px] font-bold">Last name</label>
          <input id="last" name="last" required autoComplete="family-name"
            className="w-full px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        </div>
      </div>
      <div className="grid gap-1.5 min-w-0">
        <label htmlFor="email" className="text-[13.5px] font-bold">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email"
          className="w-full px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
      </div>
      <div className="grid gap-1.5 min-w-0">
        <label htmlFor="password" className="text-[13.5px] font-bold">Password</label>
        <input id="password" name="password" type="password" required minLength={6} autoComplete="new-password"
          className="w-full px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        <span className="text-xs text-ink-500">At least 6 characters.</span>
      </div>

      <DateOfBirthFields onChange={setDob} />

      {needsParent && (
        <div className="grid gap-1.5 min-w-0">
          <label htmlFor="parentEmail" className="text-[13.5px] font-bold">Parent or guardian&rsquo;s email</label>
          <input id="parentEmail" name="parentEmail" type="email" required autoComplete="off"
            className="w-full px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
          <span className="text-xs text-ink-500">A parent or guardian approves accounts for members under 16 — we&rsquo;ll email them a link.</span>
        </div>
      )}

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
