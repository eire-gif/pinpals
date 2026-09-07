"use client";

import { useMemo, useState } from "react";
import { initials } from "@/lib/format";
import type { Message } from "@/lib/types";
import type { MessagesCursor } from "@/lib/messaging";
import { conversationChannelTopic, useBroadcastChannel } from "@/lib/realtime-client";
import { loadOlderMessages, sendMessage } from "../actions";
import MessageForm from "./message-form";
import ReportForm from "./report-form";

type Participant = { id: string; name: string; avatar_color: string | null };

type PendingMessage = {
  tempId: string;
  body: string;
  createdAt: string;
  status: "sending" | "failed";
};

/**
 * Renders a conversation's messages and owns everything about how they get
 * there: the initial server-fetched page, "load older" keyset pagination,
 * one Realtime subscription for THIS thread (never one per message — the
 * task's own "avoid one subscription per row" instruction applies here too,
 * just at conversation scope instead of inbox scope), and optimistic
 * sending with retry.
 *
 * Postgres stays authoritative throughout: a broadcast is only ever a nudge
 * to render something that already landed in the database (this component
 * never treats a broadcast payload as something to act on beyond display),
 * and an optimistic send is only ever local UI state until sendMessage()'s
 * own insert actually succeeds — a failed send never fakes success, it
 * surfaces a retry instead.
 */
export default function ThreadView({
  conversationId,
  initialMessages,
  initialCursor,
  currentUserId,
  participants,
  blocked,
}: {
  conversationId: number;
  initialMessages: Message[];
  initialCursor: MessagesCursor | null;
  currentUserId: string;
  participants: Record<string, Participant>;
  /** Either direction blocked — the composer is disabled either way, since
   * messages' own insert policy (0049) would reject the send regardless of
   * which side did the blocking. */
  blocked: boolean;
}) {
  const [older, setOlder] = useState<Message[]>([]);
  // Messages that arrived via Realtime broadcast from the OTHER participant
  // — our own sends are already reflected via the optimistic/pending state
  // below plus the server revalidation sendMessage() triggers, so this only
  // ever needs to hold someone else's message we haven't server-refetched
  // yet. Deduped against initialMessages/older by id before rendering.
  const [live, setLive] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [cursor, setCursor] = useState<MessagesCursor | null>(initialCursor);
  const [loadOlderError, setLoadOlderError] = useState<string | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [reportingId, setReportingId] = useState<number | null>(null);

  useBroadcastChannel(conversationChannelTopic(conversationId), "new_message", (rawPayload) => {
    const payload = rawPayload as { message: Message };
    const incoming = payload?.message;
    if (!incoming || incoming.sender_id === currentUserId) return;
    setLive((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
  });

  const allMessages = useMemo(() => {
    const byId = new Map<number, Message>();
    for (const m of [...older, ...initialMessages, ...live]) byId.set(m.id, m);
    return Array.from(byId.values()).sort((a, b) => {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return diff !== 0 ? diff : a.id - b.id;
    });
  }, [older, initialMessages, live]);

  async function handleLoadOlder() {
    if (!cursor) return;
    setLoadOlderError(null);
    setIsLoadingOlder(true);
    const result = await loadOlderMessages(conversationId, cursor);
    setIsLoadingOlder(false);
    if ("error" in result) {
      setLoadOlderError(result.error);
      return;
    }
    setOlder((prev) => [...result.messages, ...prev]);
    setCursor(result.nextCursor);
  }

  async function attemptSend(tempId: string, body: string) {
    const formData = new FormData();
    formData.set("body", body);
    const result = await sendMessage(conversationId, {}, formData);
    if (result.error) {
      setPending((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, status: "failed" as const } : p)));
      return;
    }
    // On success, refreshThread()'s revalidatePath (inside sendMessage())
    // brings the confirmed row back through `initialMessages` on the next
    // render — dropped from `pending` here rather than promoted into local
    // state directly, so there's exactly one source of truth for a
    // confirmed message (the server-fetched props), not two.
    setPending((prev) => prev.filter((p) => p.tempId !== tempId));
  }

  function handleSend(body: string) {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPending((prev) => [...prev, { tempId, body, createdAt: new Date().toISOString(), status: "sending" }]);
    void attemptSend(tempId, body);
  }

  function handleRetry(tempId: string) {
    const item = pending.find((p) => p.tempId === tempId);
    if (!item) return;
    setPending((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, status: "sending" as const } : p)));
    void attemptSend(tempId, item.body);
  }

  function handleDiscard(tempId: string) {
    setPending((prev) => prev.filter((p) => p.tempId !== tempId));
  }

  return (
    <div className="flex flex-col gap-3">
      {cursor && (
        <button
          type="button"
          onClick={handleLoadOlder}
          disabled={isLoadingOlder}
          className="self-center text-xs font-bold text-ink-500 hover:text-green-700 disabled:opacity-60 px-3 py-1.5"
        >
          {isLoadingOlder ? "Loading…" : "Load older messages"}
        </button>
      )}
      {loadOlderError && <p className="text-xs text-red-600 text-center">{loadOlderError}</p>}

      {allMessages.length === 0 && pending.length === 0 ? (
        <p className="text-sm text-ink-500 text-center py-8">No messages yet — say hello.</p>
      ) : (
        <>
          {allMessages.map((m) => {
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
                <div className="flex flex-col gap-1 max-w-[75%]">
                  <div className={`rounded-2xl px-4 py-2.5 text-sm ${mine ? "bg-green-700 text-cream-50" : "bg-cream-100 text-ink-900"}`}>
                    {m.hidden_at ? (
                      <span className="italic opacity-75">This message was removed by a moderator.</span>
                    ) : (
                      <span className="whitespace-pre-wrap break-words">{m.body}</span>
                    )}
                  </div>
                  {!mine && !m.hidden_at && (
                    <div className={reportingId === m.id ? "" : "self-end"}>
                      {reportingId === m.id ? (
                        <ReportForm target={{ type: "message", id: m.id }} label="Report this message" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setReportingId(m.id)}
                          className="text-[11px] text-ink-500 hover:text-red-600 transition"
                        >
                          Report
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {pending.map((p) => (
            <div key={p.tempId} className="flex items-end gap-2.5 flex-row-reverse">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-display font-bold text-[11px] shrink-0"
                style={{ background: participants[currentUserId]?.avatar_color ?? "#1f5c2e" }}
              >
                {initials(participants[currentUserId]?.name ?? "Me")}
              </div>
              <div className="flex flex-col gap-1 max-w-[75%] items-end">
                <div className={`rounded-2xl px-4 py-2.5 text-sm bg-green-700 text-cream-50 ${p.status === "sending" ? "opacity-60" : "opacity-90"}`}>
                  <span className="whitespace-pre-wrap break-words">{p.body}</span>
                </div>
                {p.status === "sending" && <span className="text-[11px] text-ink-500">Sending…</span>}
                {p.status === "failed" && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-red-600">Couldn&rsquo;t send</span>
                    <button type="button" onClick={() => handleRetry(p.tempId)} className="text-[11px] font-bold text-green-700 hover:text-green-800">
                      Retry
                    </button>
                    <button type="button" onClick={() => handleDiscard(p.tempId)} className="text-[11px] text-ink-500 hover:text-ink-900">
                      Discard
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      <div className="mt-2">
        <MessageForm onSend={handleSend} disabled={blocked} />
        {blocked && <p className="text-xs text-ink-500 mt-2">You can&rsquo;t send messages in this conversation right now.</p>}
      </div>
    </div>
  );
}
