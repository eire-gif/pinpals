"use client";

import { useActionState } from "react";
import type { InterestStatus } from "@/lib/types";
import { INTEREST_STATUS_LABELS } from "@/lib/tee-times";
import { expressInterest, type InterestState } from "./actions";

const initialState: InterestState = {};

const STATUS_STYLES: Record<InterestStatus, string> = {
  pending: "bg-cream-100 text-ink-900",
  accepted: "bg-green-100 text-green-800",
  confirmed: "bg-green-700 text-cream-50",
  declined: "bg-red-100 text-red-600",
};

export default function InterestButton({
  inviteId,
  initialStatus,
}: {
  inviteId: number;
  initialStatus?: InterestStatus;
}) {
  const expressInterestForInvite = expressInterest.bind(null, inviteId);
  const [state, formAction, pending] = useActionState(expressInterestForInvite, initialState);

  const status: InterestStatus | undefined = state.success ? "pending" : initialStatus;

  if (status) {
    return (
      <span
        className={`block w-full text-center py-2.5 rounded-full font-bold text-sm ${STATUS_STYLES[status]}`}
      >
        {status === "pending" ? "Interest sent" : INTEREST_STATUS_LABELS[status]}
      </span>
    );
  }

  return (
    <form action={formAction}>
      {state.error && (
        <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2 mb-2">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Sending…" : "I'm interested"}
      </button>
    </form>
  );
}

