"use client";

import { useActionState } from "react";
import { sendParentRequest, type ParentEmailState } from "./actions";

const initialState: ParentEmailState = {};

/**
 * A 13–15 year old sends (or re-sends) the approval email to a parent.
 * `defaultEmail` is empty on purpose when the address on file is only shown
 * masked — they type it again to resend, or a new one to change it.
 */
export default function ParentEmailForm({ submitLabel = "Send to my parent" }: { submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(sendParentRequest, initialState);

  if (state.sent) {
    return (
      <p className="text-sm text-green-800 bg-green-100 rounded-lg px-3.5 py-2.5">
        Sent. Ask them to check their inbox (and their spam folder) for an email from PinPals.
      </p>
    );
  }

  return (
    <form action={formAction} className="grid gap-2">
      <label htmlFor="parent-email" className="text-[13.5px] font-bold">Parent or guardian&rsquo;s email</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id="parent-email"
          name="email"
          type="email"
          required
          autoComplete="off"
          className="flex-1 min-w-0 px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600"
        />
        <button
          type="submit"
          disabled={pending}
          className="px-5 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
        >
          {pending ? "Sending…" : submitLabel}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>}
    </form>
  );
}
