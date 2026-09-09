"use client";

import { useActionState } from "react";
import { setHomeClub, type SetHomeClubState } from "./actions";

const initialState: SetHomeClubState = {};

export default function SetHomeClubButton({
  clubId,
  clubName,
}: {
  clubId: number;
  clubName: string;
}) {
  const [state, formAction, pending] = useActionState(setHomeClub, initialState);

  // Stays on the page after saving rather than redirecting to the profile:
  // someone who has just found their club is usually about to look at who
  // else plays there, and bouncing them away from that list to prove the
  // save worked would be the wrong trade.
  if (state.done) {
    return (
      <span className="inline-flex items-center gap-2 px-5 py-3 rounded-full font-bold bg-green-100 text-green-800">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
          <path d="M4 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Your home club
      </span>
    );
  }

  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="clubId" value={clubId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 px-5 py-3 rounded-full font-bold bg-white/10 text-white hover:bg-white/20 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Set as my home club"}
      </button>
      {state.error && (
        <span className="text-sm text-red-200 bg-red-900/40 rounded-lg px-3 py-2 self-center">
          {state.error}
        </span>
      )}
      <span className="sr-only">{clubName}</span>
    </form>
  );
}
