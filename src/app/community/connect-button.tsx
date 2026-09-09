"use client";

import { useActionState } from "react";
import type { ConnectionStatus } from "@/lib/types";
import { sendConnectionRequest, type ConnectionActionState } from "@/app/connections/actions";
import StartConversationButton from "@/components/start-conversation-button";

const initialState: ConnectionActionState = {};

/**
 * The footer row of a Find Golfers tile: a plain-language status on the
 * left, the one action available on the right.
 *
 * It renders the whole row rather than just the button so that the status
 * wording and the control can never disagree — both are derived from the
 * same `status` value here, in one place, instead of the page computing a
 * label and this component computing a button from the same data
 * separately.
 *
 * `pill` is shared by every control below so a solid, an outlined and a
 * disabled state are the same size and sit on the same baseline; only the
 * colours differ.
 */
const PILL = "px-5 py-2 rounded-full font-bold text-sm whitespace-nowrap transition disabled:opacity-50";

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
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink-500">
          <span className="text-green-700" aria-hidden="true">
            ✓
          </span>{" "}
          Connected
        </span>
        <StartConversationButton
          otherUserId={memberId}
          className={`${PILL} border-[1.5px] border-green-700 text-green-700 hover:bg-green-100`}
        />
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink-500">{incoming ? "Waiting on you" : "Awaiting reply"}</span>
        <span className={`${PILL} bg-cream-100 text-ink-500`}>
          {incoming ? "Respond on dashboard" : "Request sent"}
        </span>
      </div>
    );
  }

  return (
    <form action={formAction}>
      {state.error && <p className="text-xs text-red-600 mb-2">{state.error}</p>}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink-500">Open to connect</span>
        <button
          type="submit"
          disabled={pending}
          className={`${PILL} bg-green-700 text-cream-50 hover:bg-green-600`}
        >
          {pending ? "Sending…" : status === "declined" ? "Connect again" : "Connect"}
        </button>
      </div>
    </form>
  );
}
