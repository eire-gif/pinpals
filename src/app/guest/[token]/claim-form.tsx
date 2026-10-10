"use client";

import { useActionState } from "react";

import { GOLD_BUTTON, NAVY_OUTLINE_BUTTON } from "@/components/marketplace/buy-styles";
import { claimGuestCard, type ClaimState } from "./actions";

export default function ClaimForm({ token, signedIn }: { token: string; signedIn: boolean }) {
  const [state, action, pending] = useActionState<ClaimState, FormData>(claimGuestCard, {});
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="token" value={token} />
      {state.error ? <p className="text-sm font-semibold text-red-600 text-center">{state.error}</p> : null}
      {signedIn ? (
        <button type="submit" disabled={pending} className={`${GOLD_BUTTON} w-full`}>
          {pending ? "Saving…" : "Save this round to my profile"}
        </button>
      ) : (
        <>
          <button type="submit" name="intent" value="signup" disabled={pending} className={`${GOLD_BUTTON} w-full`}>
            Join PinPals to keep this round
          </button>
          <button type="submit" name="intent" value="login" disabled={pending} className={`${NAVY_OUTLINE_BUTTON} w-full`}>
            I already have an account
          </button>
        </>
      )}
    </form>
  );
}
