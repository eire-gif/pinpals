"use client";

import { useActionState, useState, useTransition } from "react";
import type { Message } from "@/lib/types";
import type { MessagesCursor } from "@/lib/messaging";
import type { ConversationAccessState } from "@/lib/admin/messaging";
import { formatDateTime } from "@/lib/admin/format";
import AdminAvatar from "@/components/admin/avatar";
import { grantConversationAccess, loadOlderConversationAccess, hideMessage, restoreMessage } from "./actions";

const initialState: ConversationAccessState = {};

/**
 * The only place in the admin console that ever shows message content — see
 * the privacy model comment at the top of supabase/migrations/0025_messaging.sql.
 * Nothing here is preloaded by the report detail page's own server fetch;
 * everything below only exists after a staff member submits a reason and
 * grantConversationAccess() returns a window, and every additional page
 * loaded here fires its own audited reveal.
 */
export default function ConversationAccessPanel({
  reportId,
  label,
  canModerate,
}: {
  reportId: number;
  label: string;
  canModerate: boolean;
}) {
  const [state, formAction, pending] = useActionState(grantConversationAccess, initialState);
  const [reason, setReason] = useState("");
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [participants, setParticipants] = useState<{ id: string; name: string }[]>([]);
  const [cursor, setCursor] = useState<MessagesCursor | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Sync local view state the first time a reveal succeeds — subsequent
  // "load older" calls append directly rather than going through
  // useActionState again, so this only fires once per reveal.
  if (state.success && state.messages && messages === null) {
    setMessages(state.messages);
    setParticipants(state.participants ?? []);
    setCursor(state.nextCursor ?? null);
  }

  function handleLoadOlder() {
    if (!cursor) return;
    setLoadError(null);
    startTransition(async () => {
      const result = await loadOlderConversationAccess(reportId, reason, cursor);
      if (result.error) {
        setLoadError(result.error);
        return;
      }
      setMessages((prev) => [...(result.messages ?? []), ...(prev ?? [])]);
      setCursor(result.nextCursor ?? null);
    });
  }

  function participantName(senderId: string): string {
    return participants.find((p) => p.id === senderId)?.name ?? "Unknown member";
  }

  if (messages === null) {
    return (
      <form action={formAction} className="flex flex-col gap-2.5">
        <p className="text-xs text-ink-500">
          Viewing {label.toLowerCase()} content requires a reason. This is recorded in the audit log every time,
          including for follow-up pages of the same conversation.
        </p>
        <input type="hidden" name="reportId" value={reportId} />
        <textarea
          name="reason"
          required
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why do you need to see this conversation? (recorded in the audit log)"
          className="w-full text-sm rounded-lg border-[1.5px] border-line px-3 py-2 resize-none bg-surface"
        />
        {state.error && <p className="text-xs text-red-600 bg-red-100 rounded-lg px-3 py-2">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="self-start px-4 py-2 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition disabled:opacity-60"
        >
          {pending ? "Loading…" : "Reveal conversation"}
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-500">
        Access reason on file: <span className="text-ink-900">{reason}</span>
      </p>

      {cursor && (
        <button
          type="button"
          onClick={handleLoadOlder}
          disabled={isPending}
          className="self-center text-xs font-bold text-ink-500 hover:text-navy-900 disabled:opacity-60"
        >
          {isPending ? "Loading…" : "Load older messages"}
        </button>
      )}
      {loadError && <p className="text-xs text-red-600">{loadError}</p>}

      {messages.length === 0 ? (
        <p className="text-sm text-ink-500 text-center py-6">No messages in this window.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <li key={m.id} className="border border-line rounded-xl p-3.5">
              <div className="flex items-center gap-2.5 mb-1.5">
                <AdminAvatar name={participantName(m.sender_id)} color={null} size="sm" />
                <div className="text-xs">
                  <span className="font-semibold text-ink-900">{participantName(m.sender_id)}</span>
                  <span className="text-ink-500"> · {formatDateTime(m.created_at)}</span>
                  {m.hidden_at && <span className="text-red-600 font-semibold"> · Hidden</span>}
                </div>
              </div>
              <p className="text-sm text-ink-900 whitespace-pre-wrap">{m.body}</p>
              {m.hidden_reason && (
                <p className="text-xs text-ink-500 mt-1.5">Hidden reason: {m.hidden_reason}</p>
              )}
              {canModerate && (
                <div className="mt-2.5">
                  {m.hidden_at ? (
                    <MessageActionForm action={restoreMessage} messageId={m.id} reportId={reportId} submitLabel="Restore" pendingLabel="Restoring…" />
                  ) : (
                    <MessageActionForm action={hideMessage} messageId={m.id} reportId={reportId} submitLabel="Hide" pendingLabel="Hiding…" tone="danger" />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type SimpleState = { error?: string; success?: boolean };
const simpleInitial: SimpleState = {};

function MessageActionForm({
  action,
  messageId,
  reportId,
  submitLabel,
  pendingLabel,
  tone = "default",
}: {
  action: (state: SimpleState, formData: FormData) => Promise<SimpleState>;
  messageId: number;
  reportId: number;
  submitLabel: string;
  pendingLabel: string;
  tone?: "default" | "danger";
}) {
  const [state, formAction, pending] = useActionState(action, simpleInitial);
  const [open, setOpen] = useState(false);

  if (state.success) {
    return <p className="text-xs text-green-700">Done — refresh the page to see the updated state.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-xs font-bold ${tone === "danger" ? "text-red-600 hover:text-red-500" : "text-ink-500 hover:text-navy-900"}`}
      >
        {submitLabel}
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="messageId" value={messageId} />
      <input type="hidden" name="reportId" value={reportId} />
      <textarea
        name="reason"
        required
        rows={2}
        placeholder="Reason (recorded in the audit log)"
        className="w-full text-xs rounded-lg border-[1.5px] border-line px-2.5 py-1.5 resize-none bg-surface"
      />
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className={`self-start px-3 py-1.5 rounded-full font-bold text-xs transition disabled:opacity-60 ${
          tone === "danger" ? "bg-red-600 text-cream-50 hover:bg-red-500" : "bg-navy-900 text-cream-50 hover:bg-navy-800"
        }`}
      >
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
