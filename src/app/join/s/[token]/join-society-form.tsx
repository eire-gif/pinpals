"use client";

import { useActionState } from "react";

import { GOLD_BUTTON, NAVY_OUTLINE_BUTTON } from "@/components/marketplace/buy-styles";
import { joinSociety, type JoinSocietyState } from "./actions";

export default function JoinSocietyForm({ token, email, groupName, signedIn }: { token: string; email: string; groupName: string; signedIn: boolean }) {
  const [state, action, pending] = useActionState<JoinSocietyState, FormData>(joinSociety, {});
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} />
      {state.error ? <p className="text-sm font-semibold text-red-600 text-center">{state.error}</p> : null}
      {signedIn ? (
        <button type="submit" disabled={pending} className={`${GOLD_BUTTON} w-full`}>
          {pending ? "Joining…" : `Join ${groupName}`}
        </button>
      ) : (
        <>
          <button type="submit" name="intent" value="signup" disabled={pending} className={`${GOLD_BUTTON} w-full`}>
            Join PinPals — it&rsquo;s free
          </button>
          <button type="submit" name="intent" value="login" disabled={pending} className={`${NAVY_OUTLINE_BUTTON} w-full`}>
            I already have an account
          </button>
          <p className="text-xs text-ink-500 text-center">You&rsquo;ll be in {groupName} as soon as you&rsquo;re signed in.</p>
        </>
      )}
    </form>
  );
}
