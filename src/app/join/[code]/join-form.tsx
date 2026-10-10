"use client";

import { useActionState } from "react";

import { GOLD_BUTTON, NAVY_OUTLINE_BUTTON } from "@/components/marketplace/buy-styles";
import { acceptInvite, type JoinState } from "./actions";

export default function JoinForm({ code, firstName, signedIn }: { code: string; firstName: string; signedIn: boolean }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(acceptInvite, {});
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="code" value={code} />
      {state.error ? <p className="text-sm font-semibold text-red-600 text-center">{state.error}</p> : null}
      {signedIn ? (
        <button type="submit" disabled={pending} className={`${GOLD_BUTTON} w-full`}>
          {pending ? "Connecting…" : `Connect with ${firstName}`}
        </button>
      ) : (
        <>
          <button type="submit" name="intent" value="signup" disabled={pending} className={`${GOLD_BUTTON} w-full`}>
            Join PinPals — it&rsquo;s free
          </button>
          <button type="submit" name="intent" value="login" disabled={pending} className={`${NAVY_OUTLINE_BUTTON} w-full`}>
            I already have an account
          </button>
          <p className="text-xs text-ink-500 text-center">You&rsquo;ll be connected with {firstName} as soon as you&rsquo;re in.</p>
        </>
      )}
    </form>
  );
}
