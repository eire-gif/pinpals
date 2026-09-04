"use client";

import { useActionState } from "react";
import type { ConnectionStatus } from "@/lib/types";
import { sendConnectionRequest, type ConnectionActionState } from "@/app/connections/actions";
import StartConversationButton from "@/components/start-conversation-button";

const initialState: ConnectionActionState = {};

export default function ConnectButton({
  memberId,
  initialStatus,
  incoming = false,
}: {
  memberId: string;
  initialStatus?: ConnectionStatus;
  incoming?: boolean;
}) {
  const action = sendConnectionRequest.bind(null, memberId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const status = state.success ? "pending" : initialStatus;

  if (status === "accepted") {
    return (
      <div className="flex flex-col gap-2">
        <span className="block w-full py-2.5 rounded-full font-bold text-sm bg-green-100 text-green-800 text-center">Connected</span>
        <StartConversationButton otherUserId={memberId} />
      </div>
    );
  }
  if (status === "pending") {
    return (
      <span className="block w-full py-2.5 rounded-full font-bold text-sm bg-cream-100 text-ink-500">
        {incoming ? "Respond on dashboard" : "Request sent"}
      </span>
    );
  }

  return (
    <form action={formAction}>
      {state.error && <p className="text-xs text-red-600 mb-2">{state.error}</p>}
      <button type="submit" disabled={pending} className="w-full py-2.5 rounded-full font-bold text-sm border-[1.5px] border-green-700 text-green-700 hover:bg-green-100 transition disabled:opacity-50">
        {pending ? "Sending…" : status === "declined" ? "Connect again" : "Connect"}
      </button>
    </form>
  );
}

