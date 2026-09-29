import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  MESSAGE_MAX_LENGTH,
  containsSensitiveData,
  otherMemberIds,
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
  /** A `message-images` storage path from uploadMessageImage(), for a message
   *  that carries a photo. Never a URL — that bucket is private and its URLs
   *  expire (0086). */
  imagePath?: string | null;
}): Promise<SendMessageResult> {
  const { supabase, userId, conversationId } = params;
  const imagePath = params.imagePath ?? null;

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
  // A photo is a message on its own. Without one, a blank body still isn't.
  if (!body && !imagePath) {
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
    .select("id, kind, title")
    .eq("id", conversationId)
    .maybeSingle<Pick<Conversation, "id" | "kind" | "title">>();

  if (!conversation) {
    return {
      ok: false,
      reason: "not_found",
      message: "Conversation not found.",
    };
  }

  // Everyone else in it. One query instead of reading two columns, because a
  // group has as many recipients as it has members and the broadcast and the
  // notification both need all of them. RLS scopes this to conversations the
  // sender is in, so an empty list means they are not a participant.
  const { data: memberRows } = await supabase
    .from("conversation_members")
    .select("member_id")
    .eq("conversation_id", conversationId)
    .returns<{ member_id: string }[]>();

  const members = memberRows ?? [];
  if (!members.some((m) => m.member_id === userId)) {
    return { ok: false, reason: "not_found", message: "Conversation not found." };
  }
  const recipientIds = otherMemberIds(members, userId);

  // conversation_has_block() answers "is anybody in here blocked with me", in
  // either direction, in one call rather than one per member. The insert
  // policy enforces the same rule — this is here so the refusal arrives as a
  // sentence rather than as a raw RLS violation.
  const { data: blocked } = await supabase.rpc("conversation_has_block", {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  if (blocked) {
    return {
      ok: false,
      reason: "forbidden",
      message: "You can't send messages in this conversation.",
    };
  }

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: userId,
      body,
      image_path: imagePath,
    })
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

  if (recipientIds.length > 0) {
    // What the recipient sees before opening the thread. A photo with no
    // caption has no text to preview, and "" would render as a thread that
    // apparently just went quiet.
    const preview = body ? body.slice(0, 140) : "📷 Photo";

    await broadcast(conversationChannelTopic(conversationId), "new_message", {
      message,
    });
    // One per recipient. A group of six is six inbox broadcasts, which is the
    // honest cost of six people needing to be told — the conversation channel
    // above is still one broadcast for the thread itself.
    for (const recipientId of recipientIds) {
      await broadcast(inboxChannelTopic(recipientId), "new_message", {
        conversationId,
        senderId: userId,
        preview,
        createdAt: message.created_at,
      });
    }

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

    // A group says where the message landed; a direct thread does not need
    // to, because the sender's name already says it.
    const where = conversation.kind === "group" && conversation.title
      ? ` in ${conversation.title}`
      : "";

    const admin = createAdminClient();
    for (const recipientId of recipientIds) {
      await notifyUser(admin, {
        userId: recipientId,
        type: "new_message",
        title: conversation.kind === "group" ? "New group message" : "New message",
        body: body
          ? `${senderName} sent a message${where}: "${body.slice(0, 140)}${body.length > 140 ? "…" : ""}"`
          : `${senderName} sent a photo${where}.`,
        // Never put another member's free-text message content in an email —
        // see notifyUser()'s own comment on emailBody.
        emailBody: `${senderName} sent a new message on Pinpals.`,
        href: `/conversations/${conversationId}`,
        data: { conversationId },
        // Per recipient, not per message: a group's six notifications are six
        // different rows for six different people, and one shared key would
        // let notify_user()'s own dedupe drop five of them.
        dedupeKey: `message:${message.id}:notify:${recipientId}`,
      });
    }
  }

  return { ok: true, value: message };
}
