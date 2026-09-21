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

/**
 * New messages in one open thread.
 *
 * Returns its own unsubscribe, and it is safe to call that before the
 * subscription has finished connecting — the channel exists from the moment
 * it is created.
 */
export function subscribeToConversation(
  conversationId: number,
  onMessage: (message: Message) => void
): () => void {
  const channel = supabase.channel(`conversation-${conversationId}`, {
    config: { private: true },
  });

  channel.on("broadcast", { event: "new_message" }, (payload) => {
    const message = (payload.payload as { message?: Message } | undefined)
      ?.message;
    // Shape-checked rather than trusted. This arrives over a socket, and a
    // malformed payload should be ignored, not rendered as an empty bubble.
    if (message && typeof message.id === "number") onMessage(message);
  });

  void authorise().then(() => channel.subscribe());

  return teardown(channel);
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
