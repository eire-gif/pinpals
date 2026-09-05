"use client";

import { useActionState } from "react";
import { startConversation } from "@/app/conversations/actions";

type State = { error?: string; success?: boolean };
const initialState: State = {};

/**
 * A "Message" button for anywhere the app already shows two members with a
 * legitimate connection between them (an accepted connection, a marketplace
 * offer thread, a confirmed tee-time interest) — startConversation() redirects
 * into the conversation on success, or returns a friendly error if
 * can_message() disagrees (see supabase/migrations/0025_messaging.sql).
 */
export default function StartConversationButton({
  otherUserId,
  className = "w-full py-2.5 rounded-full font-bold text-sm border-[1.5px] border-green-700 text-green-700 hover:bg-green-100 transition disabled:opacity-50",
  label = "Message",
}: {
  otherUserId: string;
  className?: string;
  label?: string;
}) {
  const action = startConversation.bind(null, otherUserId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction}>
      {state.error && <p className="text-xs text-red-600 mb-1.5">{state.error}</p>}
      <button type="submit" disabled={pending} className={className}>
        {pending ? "Opening…" : label}
      </button>
    </form>
  );
}
