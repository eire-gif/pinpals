"use client";

import { useActionState } from "react";
import DateOfBirthFields from "@/components/date-of-birth-fields";
import { saveDateOfBirth, type DobState } from "./actions";
import ParentEmailForm from "./parent-email-form";

const initialState: DobState = {};

/**
 * For members who joined before PinPals asked (0159): add a date of birth,
 * once. If it makes them 13–15, the next step is a parent's email, right
 * here — the rest of the site waits on that.
 */
export default function DateOfBirthCard() {
  const [state, formAction, pending] = useActionState(saveDateOfBirth, initialState);

  if (state.done && state.needsParent) {
    return (
      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm grid gap-3">
        <h2 className="font-display font-bold text-lg">One more step: ask a parent</h2>
        <p className="text-sm text-ink-500">
          Members under 16 need a parent or guardian to approve their account. We&rsquo;ll email them a link.
        </p>
        <ParentEmailForm />
      </div>
    );
  }
  if (state.done) {
    return <p className="bg-green-100 text-green-800 rounded-xl px-4 py-3 text-sm font-semibold">Thanks — your date of birth is saved.</p>;
  }

  return (
    <form action={formAction} className="bg-surface border-2 border-gold-500 rounded-2xl p-6 shadow-sm grid gap-3">
      <h2 className="font-display font-bold text-lg">Add your date of birth</h2>
      <p className="text-sm text-ink-500">
        PinPals now asks every member for their date of birth. It&rsquo;s never shown to anyone, and you
        can only enter it once — check it before you save.
      </p>
      <DateOfBirthFields idPrefix="dob-card" />
      {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="justify-self-start px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save date of birth"}
      </button>
    </form>
  );
}
