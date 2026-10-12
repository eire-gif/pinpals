import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "./supabase";
import type { Message } from "./messages";

/**
 * Live updates, on the same two channels the website already uses.
 *
 * src/lib/realtime.ts on the server broadcasts to exactly two topics, and
 * this is the other end of them:
 *
 *   conversation-<id>  every new message in one thread. Subscribed to only
 *                      while that thread is open — at most one at a time.
 *   inbox-<userId>     a single "something changed" ping for a member's
 *                      ENTIRE inbox, never one subscription per row. The
 *                      payload is treated as "go re-fetch", not as data to
 *                      render, so a ping that arrives out of order or twice
 *                      costs one query and nothing else.
 *
 * Both are PRIVATE channels, which means Realtime authorises the join
 * against the policies in migration 0082 before sending anything. Those
 * policies were missing from the project until then, so if a subscription
 * here silently never fires, that migration is the first thing to check.
 *
 * Nothing here is load-bearing. Postgres is the only durable copy and every
 * screen re-fetches on focus anyway: a broadcast that never arrives means a
 * member sees the reply a moment later instead of instantly.
 */

/**
 * setAuth() hands Realtime the member's access token.
 *
 * Without it the socket connects as anon and every private join is refused —
 * and refused quietly, which is the confusing part. Called before each
 * subscribe rather than once at startup so a token refreshed in the
 * background is the one in use.
 */
async function authorise(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) await supabase.realtime.setAuth(token);
}

function teardown(channel: RealtimeChannel): () => void {
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** What the open thread hears besides new messages (0130). Each is a hint to
 *  re-fetch something small, never data to render. */
export type ConversationEvents = {
  onMessage: (message: Message) => void;
  /** A reaction changed, or a message was deleted for everyone. */
  onMessageChanged?: (messageId: number, what: "reaction" | "deleted") => void;
  /** Someone's read cursor moved — the ✓✓. */
  onRead?: (memberId: string, lastReadAt: string) => void;
};

/**
 * Everything live in one open thread.
 *
 * Returns its own unsubscribe, and it is safe to call that before the
 * subscription has finished connecting — the channel exists from the moment
 * it is created. (The old single-callback form still works.)
 */
export function subscribeToConversation(
  conversationId: number,
  handlers: ConversationEvents | ((message: Message) => void)
): () => void {
  const h: ConversationEvents = typeof handlers === "function" ? { onMessage: handlers } : handlers;
  const channel = supabase.channel(`conversation-${conversationId}`, {
    config: { private: true },
  });

  channel.on("broadcast", { event: "new_message" }, (payload) => {
    const message = (payload.payload as { message?: Message } | undefined)
      ?.message;
    // Shape-checked rather than trusted. This arrives over a socket, and a
    // malformed payload should be ignored, not rendered as an empty bubble.
    if (message && typeof message.id === "number") h.onMessage(message);
  });

  channel.on("broadcast", { event: "message_changed" }, (payload) => {
    const p = payload.payload as { message_id?: unknown; what?: unknown } | undefined;
    const id = Number(p?.message_id);
    if (Number.isInteger(id) && (p?.what === "reaction" || p?.what === "deleted")) {
      h.onMessageChanged?.(id, p.what);
    }
  });

  channel.on("broadcast", { event: "read" }, (payload) => {
    const p = payload.payload as { member_id?: unknown; last_read_at?: unknown } | undefined;
    if (typeof p?.member_id === "string" && typeof p.last_read_at === "string") {
      h.onRead?.(p.member_id, p.last_read_at);
    }
  });

  void authorise().then(() => channel.subscribe());

  return teardown(channel);
}

/**
 * "Seán is typing…" — the one topic members publish on themselves
 * (`typing-<id>`, 0130), kept apart from `conversation-<id>` so a forged
 * event can only ever fake a typing indicator.
 *
 * `ping()` is throttled to one send every 3 seconds; listeners treat a ping
 * as "typing for the next 5 seconds". The sender id in the payload is only
 * a hint from another member of the same thread — fine for a dot.
 */
export function subscribeToTyping(
  conversationId: number,
  me: string,
  onTyping: (memberId: string) => void
): { ping: () => void; stop: () => void } {
  const channel = supabase.channel(`typing-${conversationId}`, {
    config: { private: true, broadcast: { self: false } },
  });
  channel.on("broadcast", { event: "typing" }, (payload) => {
    const who = (payload.payload as { member_id?: unknown } | undefined)?.member_id;
    if (typeof who === "string" && who !== me) onTyping(who);
  });
  let ready = false;
  let last = 0;
  void authorise().then(() =>
    channel.subscribe((status) => {
      ready = status === "SUBSCRIBED";
    })
  );
  return {
    ping: () => {
      const now = Date.now();
      if (!ready || now - last < 3000) return;
      last = now;
      void channel.send({ type: "broadcast", event: "typing", payload: { member_id: me } });
    },
    stop: teardown(channel),
  };
}

/** "Something in your inbox changed." Deliberately carries no data the caller
 *  is meant to render — see the header note. */
export function subscribeToInbox(
  userId: string,
  onChange: () => void
): () => void {
  const channel = supabase.channel(`inbox-${userId}`, {
    config: { private: true },
  });

  channel.on("broadcast", { event: "new_message" }, () => onChange());

  void authorise().then(() => channel.subscribe());

  return teardown(channel);
}
