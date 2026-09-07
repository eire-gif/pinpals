import "server-only";
import { SUPABASE_URL } from "./supabase/config";

// Best-effort live-update delivery for messaging — see 0049_marketplace_
// messaging.sql's own header comment on why this exists and what it
// deliberately doesn't do. Postgres (the ordinary `messages` insert, guarded
// by that migration's RLS/triggers) is the only durable write; this is
// purely "also nudge anyone looking at a relevant screen right now,"
// exactly the way `revalidatePath()` already is elsewhere in this app for
// the non-realtime case. A broadcast that never arrives — network hiccup,
// Realtime momentarily down — must never fail the message send itself, same
// "a secondary system failing must never break the primary flow" discipline
// as checkRateLimit()'s own fail-open behaviour.
//
// Sent via Supabase's HTTP Broadcast endpoint (not a websocket) precisely
// because this runs from a Server Action/route handler — a serverless
// invocation has no business holding a persistent Realtime connection open
// just to fire one message and disconnect. The receiving side (ThreadView/
// the inbox list, both "use client") subscribes normally, over a websocket,
// via the browser Supabase client.
//
// Two topics only, never one per row/conversation — the task's own "avoid
// one database subscription per row or conversation preview" instruction:
//   - `conversation-<id>`: every new message in that one thread. Only ever
//     subscribed to while that thread is actually open (at most one at a
//     time per browser tab).
//   - `inbox-<userId>`: a lightweight ping ("something changed in one of
//     your conversations") for the inbox list — one subscription for a
//     user's ENTIRE inbox, regardless of how many conversations they have,
//     never one per conversation row. The inbox list treats this as "go
//     re-fetch," not as data to render directly.
//
// Both topics are `private: true` — receiving requires passing Realtime
// Authorization, enforced by RLS policies on `realtime.messages` (see this
// project's Supabase dashboard / a follow-up migration against the
// `realtime` schema, which — being a Supabase-managed schema outside this
// repo's own `public` schema migrations — is configured directly on the
// project rather than through supabase/migrations/*.sql). Sending (this
// function) always goes through the service-role key, so a client can only
// ever receive on these topics, never publish to them directly — spoofing a
// "new message" broadcast still requires an actual authorized insert.
export function conversationChannelTopic(conversationId: number): string {
  return `conversation-${conversationId}`;
}

export function inboxChannelTopic(userId: string): string {
  return `inbox-${userId}`;
}

/**
 * Fires a single broadcast event. Never throws — logs and returns on any
 * failure, exactly like checkRateLimit()'s own "an infrastructure failure
 * here must never become a way to break the primary flow" contract.
 */
export async function broadcast(topic: string, event: string, payload: Record<string, unknown>): Promise<void> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    // Same "not configured yet" tolerance as the Stripe webhook route — a
    // preview/local environment with no service-role key set shouldn't
    // crash message sending, just silently skip the live-update push.
    return;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        messages: [{ topic, event, payload, private: true }],
      }),
    });
    if (!response.ok) {
      console.error(`Realtime broadcast to "${topic}" failed: ${response.status} ${await response.text()}`);
    }
  } catch (err) {
    console.error(`Realtime broadcast to "${topic}" threw:`, err instanceof Error ? err.message : err);
  }
}
