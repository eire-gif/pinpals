"use client";

import { useState, useTransition } from "react";
import { initials } from "@/lib/format";
import type { Message } from "@/lib/types";
import type { MessagesCursor } from "@/lib/messaging";
import { loadOlderMessages } from "../actions";

type Participant = { id: string; name: string; avatar_color: string | null };

/**
 * Renders one page of a conversation (server-fetched, newest N — see
 * listLatestMessages() in ../actions.ts) and manages "load older" as local
 * client state, keyset-paginated via loadOlderMessages(). Deliberately not
 * wired to Realtime (see supabase/migrations/0025_messaging.sql) — a new
 * message triggers a full page revalidate from the server instead, which
 * means any older messages loaded in this component's state are dropped on
 * the next send. That's an accepted simplification for this phase, not an
 * oversight.
 */
export default function ThreadView({
  conversationId,
  initialMessages,
  initialCursor,
  currentUserId,
  participants,
}: {
  conversationId: number;
  initialMessages: Message[];
  initialCursor: MessagesCursor | null;
  currentUserId: string;
  participants: Record<string, Participant>;
}) {
  const [older, setOlder] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<MessagesCursor | null>(initialCursor);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const allMessages = [...older, ...initialMessages];

  function handleLoadOlder() {
    if (!cursor) return;
    setError(null);
    startTransition(async () => {
      const result = await loadOlderMessages(conversationId, cursor);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setOlder((prev) => [...result.messages, ...prev]);
      setCursor(result.nextCursor);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {cursor && (
        <button
          type="button"
          onClick={handleLoadOlder}
          disabled={isPending}
          className="self-center text-xs font-bold text-ink-500 hover:text-green-700 disabled:opacity-60 px-3 py-1.5"
        >
          {isPending ? "Loading…" : "Load older messages"}
        </button>
      )}
      {error && <p className="text-xs text-red-600 text-center">{error}</p>}

      {allMessages.length === 0 ? (
        <p className="text-sm text-ink-500 text-center py-8">
          No messages yet — say hello.
        </p>
      ) : (
        allMessages.map((m) => {
          const mine = m.sender_id === currentUserId;
          const sender = participants[m.sender_id];
          const name = sender?.name ?? "Unknown member";
          return (
            <div key={m.id} className={`flex items-end gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-display font-bold text-[11px] shrink-0"
                style={{ background: sender?.avatar_color ?? "#1f5c2e" }}
                title={name}
              >
                {initials(name)}
              </div>
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                  mine ? "bg-green-700 text-cream-50" : "bg-cream-100 text-ink-900"
                }`}
              >
                {m.hidden_at ? (
                  <span className="italic opacity-75">This message was removed by a moderator.</span>
                ) : (
                  <span className="whitespace-pre-wrap break-words">{m.body}</span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
