"use client";

import { useEffect } from "react";
import { createClient } from "./supabase/client";

// The client-side half of src/lib/realtime.ts's broadcast design — read
// that file's header comment first. Topic naming is duplicated here (not
// imported) purely because realtime.ts is `import "server-only"` and would
// break the browser bundle; keep these two in sync by hand if either ever
// changes.
export function conversationChannelTopic(conversationId: number): string {
  return `conversation-${conversationId}`;
}

export function inboxChannelTopic(userId: string): string {
  return `inbox-${userId}`;
}

/**
 * Subscribes to exactly one private broadcast topic for the lifetime of the
 * calling component — never one per row/list item, per the task's own
 * "avoid one database subscription per row or conversation preview"
 * instruction. `onEvent` fires with whatever payload src/lib/realtime.ts's
 * broadcast() sent; this hook does no parsing/validation of it itself —
 * that's each caller's job, since the two topics (thread vs inbox) carry
 * different shapes.
 *
 * `private: true` is what makes this an authorized channel — Realtime
 * checks the subscribing user's session against the RLS policies in
 * supabase/realtime/0001_messaging_broadcast_authorization.sql before
 * letting any event through, so an unauthorized topic name just never
 * delivers anything rather than erroring loudly. Nothing here is a
 * substitute for that authorization or for Postgres itself: this hook only
 * ever triggers a UI update, and every caller re-fetches/re-validates
 * through the ordinary RLS-scoped client rather than trusting the broadcast
 * payload as authoritative — see this file's own callers.
 */
export function useBroadcastChannel(topic: string | null, event: string, onEvent: (payload: unknown) => void) {
  useEffect(() => {
    if (!topic) return;

    const supabase = createClient();
    const channel = supabase.channel(topic, { config: { private: true } });

    channel.on("broadcast", { event }, (message) => onEvent(message.payload)).subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // onEvent is intentionally not a dependency: callers pass an inline
    // closure, and re-subscribing on every render (rather than only when
    // topic/event change) would tear down and rebuild the realtime
    // connection constantly. Callers needing fresh state inside onEvent
    // should use a functional state updater (setX(prev => ...)) rather than
    // closing over stale props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, event]);
}
