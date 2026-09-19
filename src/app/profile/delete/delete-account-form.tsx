"use client";

import { useActionState } from "react";
import { deleteAccount, type DeleteAccountState } from "./actions";

const initialState: DeleteAccountState = {};

/**
 * The confirmation itself, kept deliberately plain.
 *
 * Two fields rather than one: the password proves it is them, and typing the
 * word proves they meant it. Neither is there to make the member work for it —
 * Apple is explicit that deletion must not be made unnecessarily difficult —
 * but this is the one action on the site that cannot be undone.
 */
export default function DeleteAccountForm() {
  const [state, formAction, pending] = useActionState(deleteAccount, initialState);

  return (
    <form
      action={formAction}
      className="bg-surface border border-line rounded-2xl p-6 flex flex-col gap-5"
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-bold text-sm text-ink-900">Your password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className="border border-line rounded-xl px-3.5 py-2.5 text-base bg-cream-50"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-bold text-sm text-ink-900">
          Type DELETE to confirm
        </span>
        <input
          type="text"
          name="confirm"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          className="border border-line rounded-xl px-3.5 py-2.5 text-base bg-cream-50"
        />
      </label>

      {state.error && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start px-5 py-2.5 rounded-full font-bold text-sm bg-red-600 text-cream-50 hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Deleting…" : "Delete my account"}
      </button>
    </form>
  );
}
