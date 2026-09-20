import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  MESSAGE_MAX_LENGTH,
  containsSensitiveData,
  otherParticipantId,
} from "@/lib/messaging";
import {
  broadcast,
  conversationChannelTopic,
  inboxChannelTopic,
} from "@/lib/realtime";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { notifyUser } from "@/lib/notifications-server";
import type { Conversation, Message } from "@/lib/types";

/**
 * Sending a message, once and for both callers.
 *
 * This was the body of sendMessage() in src/app/conversations/actions.ts and
 * nothing about it has changed — it moved so that the app's
 * /api/app/messages route and the website's form run the SAME send, the way
 * createInvite() is shared by the tee-time form and /api/app/tee-times/
 * invites.
 *
 * The alternative was a second copy for the app, and a second copy of this
 * particular function is a poor idea: it is where the card-number rule, the
 * block check, the rate limit and the notification fan-out all live. A copy
 * that drifts doesn't fail loudly — it quietly lets the app send something
 * the website would have refused.
 *
 * The caller supplies the Supabase client, which is what makes it work from
 * both places: a cookie-scoped one from the website, a bearer-token one from
 * the route. Neither is the admin client, so RLS still decides whether this
 * member may write to this conversation at all.
 */

export const SEND_MESSAGE_MAX_ATTEMPTS = 30;
export const SEND_MESSAGE_WINDOW_SECONDS = 5 * 60;

export type SendMessageFailure =
  | "invalid"
  | "rate_limited"
  | "not_found"
  | "forbidden"
  | "failed";

export type SendMessageResult =
  | { ok: true; value: Message }
  | { ok: false; reason: SendMessageFailure; message: string };

export async function sendMessageTo(params: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: number;
  body: string;
}): Promise<SendMessageResult> {
  const { supabase, userId, conversationId } = params;

  const rateLimit = await checkRateLimit({
    action: "send-message",
    identifier: userId,
    maxHits: SEND_MESSAGE_MAX_ATTEMPTS,
    windowSeconds: SEND_MESSAGE_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      message: rateLimitMessage(rateLimit.retryAfterSeconds),
    };
  }

  const body = params.body.trim();
  if (!body) {
    return { ok: false, reason: "invalid", message: "Message can't be empty." };
  }
  if (body.length > MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      reason: "invalid",
      message: `Messages are limited to ${MESSAGE_MAX_LENGTH} characters.`,
    };
  }

  const sensitive = containsSensitiveData(body);
  if (sensitive.blocked) {
    return { ok: false, reason: "invalid", message: sensitive.reason };
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, user_a_id, user_b_id")
    .eq("id", conversationId)
    .maybeSingle<Pick<Conversation, "id" | "user_a_id" | "user_b_id">>();

  if (!conversation) {
    return {
      ok: false,
      reason: "not_found",
      message: "Conversation not found.",
    };
  }

  const otherId = otherParticipantId(conversation, userId);
  if (otherId) {
    // is_blocked() returns a plain scalar boolean (not a row/table), so this
    // is a direct RPC call with no .single()/.returns() postprocessing.
    const { data: blocked } = await supabase.rpc("is_blocked", {
      a: userId,
      b: otherId,
    });
    if (blocked) {
      return {
        ok: false,
        reason: "forbidden",
        message: "You can't send messages in this conversation.",
      };
    }
  }

  const { data: message, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: userId, body })
    .select("*")
    .single<Message>();

  if (error || !message) {
    // validate_message_content() (0049) raises its own specific message for
    // the sensitive-content case — surfaced directly on the off chance the
    // containsSensitiveData() check above missed something the DB's copy of
    // the rule still catches, same "the DB's own exception text is already
    // written for a human" discipline as placeBid()/offerAction() elsewhere.
    const dbMessage = error?.message ?? "";
    if (
      dbMessage.includes("card number") ||
      dbMessage.includes("IBAN") ||
      dbMessage.includes("verification")
    ) {
      return { ok: false, reason: "invalid", message: dbMessage };
    }
    return {
      ok: false,
      reason: "failed",
      message: "Couldn't send that message — please try again.",
    };
  }

  if (otherId) {
    await broadcast(conversationChannelTopic(conversationId), "new_message", {
      message,
    });
    await broadcast(inboxChannelTopic(otherId), "new_message", {
      conversationId,
      senderId: userId,
      preview: body.slice(0, 140),
      createdAt: message.created_at,
    });

    // Best-effort, same as the broadcasts above — a notification failing to
    // write must never fail the send itself. notify_user() is
    // service-role-only (see 0056's own comment), so this goes through the
    // admin client.
    const { data: sender } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", userId)
      .maybeSingle<{ first_name: string; last_name: string }>();
    const senderName = sender
      ? `${sender.first_name} ${sender.last_name}`.trim()
      : "A member";

    await notifyUser(createAdminClient(), {
      userId: otherId,
      type: "new_message",
      title: "New message",
      body: `${senderName} sent you a message: "${body.slice(0, 140)}${body.length > 140 ? "…" : ""}"`,
      // Never put another member's free-text message content in an email —
      // see notifyUser()'s own comment on emailBody.
      emailBody: `${senderName} sent you a new message on Pinpals.`,
      href: `/conversations/${conversationId}`,
      data: { conversationId },
      dedupeKey: `message:${message.id}:notify`,
    });
  }

  return { ok: true, value: message };
}
