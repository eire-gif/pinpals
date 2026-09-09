"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MESSAGE_MAX_LENGTH,
  MESSAGES_PAGE_SIZE,
  buildMessagesCursorFilter,
  nextMessagesCursor,
  otherParticipantId,
  containsSensitiveData,
  type MessagesCursor,
} from "@/lib/messaging";
import { conversationChannelTopic, inboxChannelTopic, broadcast } from "@/lib/realtime";
import { REPORT_CATEGORIES, parseEvidenceRefs, type ReportCategory } from "@/lib/admin/reports";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { notifyUser } from "@/lib/notifications-server";
import type { Conversation, Message } from "@/lib/types";

export type MessageActionState = { error?: string; success?: boolean };

// By user id (every action below requires an authenticated participant
// already). Messages: generous enough for real back-and-forth conversation,
// tight enough to blunt a scripted spam loop. Reports: the moderation queue
// is a shared, limited-staff resource — a much lower ceiling than messages.
// Starting a conversation and blocking are both rare, deliberate actions a
// real member does a handful of times, not dozens — tight ceilings, mainly
// to blunt a scripted eligibility-probing or block/unblock-flapping loop.
// Marking a thread read/archived isn't rate-limited at all: it's routine UI
// state a member can toggle while just browsing their own inbox, bounded
// anyway by how many conversations they actually have, and RLS (not this)
// is what actually protects it.
const SEND_MESSAGE_MAX_ATTEMPTS = 30;
const SEND_MESSAGE_WINDOW_SECONDS = 5 * 60;
const REPORT_MAX_ATTEMPTS = 10;
const REPORT_WINDOW_SECONDS = 60 * 60;
const START_CONVERSATION_MAX_ATTEMPTS = 20;
const START_CONVERSATION_WINDOW_SECONDS = 60 * 60;
const BLOCK_USER_MAX_ATTEMPTS = 20;
const BLOCK_USER_WINDOW_SECONDS = 60 * 60;

function refreshThread(conversationId: number) {
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath("/conversations");
}

/**
 * Starts (or reopens) a conversation with `otherUserId` and redirects into
 * it. Pass `listingId` for a marketplace thread — this phase's own
 * uniqueness rule (0049_marketplace_messaging.sql's partial unique indexes)
 * means the same two members get one conversation per listing they talk
 * about, plus at most one listing-less conversation for everything else
 * (connections, tee-times). The actual eligibility check is the
 * `can_message()`-backed insert policy — this function's own guard is only
 * there to turn a raw RLS rejection into a friendly error.
 */
export async function startConversation(otherUserId: string, listingId?: number): Promise<MessageActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (otherUserId === user.id) return { error: "You can't message yourself." };

  const rateLimit = await checkRateLimit({
    action: "start-conversation",
    identifier: user.id,
    maxHits: START_CONVERSATION_MAX_ATTEMPTS,
    windowSeconds: START_CONVERSATION_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const [a, b] = [user.id, otherUserId].sort();

  let existingQuery = supabase.from("conversations").select("id").eq("user_a_id", a).eq("user_b_id", b);
  existingQuery = listingId ? existingQuery.eq("listing_id", listingId) : existingQuery.is("listing_id", null);
  const { data: existing } = await existingQuery.maybeSingle<Pick<Conversation, "id">>();

  if (existing) redirect(`/conversations/${existing.id}`);

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ user_a_id: a, user_b_id: b, listing_id: listingId ?? null })
    .select("id")
    .single<Pick<Conversation, "id">>();

  if (error || !created) {
    // The insert policy's can_message() check is what actually rejects an
    // ineligible pair (including a blocked one, since 0049 folded
    // is_blocked() into can_message() itself) — this is the friendly
    // version of that rejection.
    return {
      error: "You can only message a golfer you're connected with, have exchanged a marketplace offer with, or have an accepted tee-time interest with.",
    };
  }

  redirect(`/conversations/${created.id}`);
}

/** Loads the latest page of a conversation's messages, oldest-first for
 * display. Used for the thread's initial server render. */
export async function listLatestMessages(conversationId: number): Promise<{ messages: Message[]; nextCursor: MessagesCursor | null } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE)
    .returns<Message[]>();

  if (error) return { error: "Couldn't load messages." };

  const rows = data ?? [];
  return { messages: rows.slice().reverse(), nextCursor: nextMessagesCursor(rows, MESSAGES_PAGE_SIZE) };
}

/**
 * Loads the next (older) page from a keyset cursor — called directly from
 * the thread's "Load older messages" client component, not via a form. RLS
 * (messages' own select policy) is what actually stops this from reaching a
 * conversation the caller isn't part of; there is deliberately no separate
 * participant check here duplicating that.
 */
export async function loadOlderMessages(conversationId: number, cursor: MessagesCursor): Promise<{ messages: Message[]; nextCursor: MessagesCursor | null } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .or(buildMessagesCursorFilter(cursor))
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE)
    .returns<Message[]>();

  if (error) return { error: "Couldn't load older messages." };

  const rows = data ?? [];
  return { messages: rows.slice().reverse(), nextCursor: nextMessagesCursor(rows, MESSAGES_PAGE_SIZE) };
}

/**
 * Sends a message. Two friendly-error pre-checks ahead of the actual
 * insert — a blocked-either-direction check (is_blocked(), granted to
 * authenticated specifically for this — see 0049) and the same
 * containsSensitiveData() heuristic validate_message_content() (0049)
 * enforces server-side — neither is the real boundary, both just turn a
 * raw DB rejection into a specific, actionable error message; the insert's
 * own RLS policy and trigger are what's actually enforced regardless of
 * what this function does or doesn't check first.
 *
 * After a successful insert, best-effort broadcasts the new message to
 * anyone with this thread open right now, and a lightweight ping to the
 * other participant's inbox — see src/lib/realtime.ts. Neither broadcast
 * can fail this action; `refreshThread()`'s revalidation is what
 * guarantees correctness regardless of whether the broadcast arrives.
 */
export async function sendMessage(conversationId: number, _prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rateLimit = await checkRateLimit({
    action: "send-message",
    identifier: user.id,
    maxHits: SEND_MESSAGE_MAX_ATTEMPTS,
    windowSeconds: SEND_MESSAGE_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Message can't be empty." };
  if (body.length > MESSAGE_MAX_LENGTH) return { error: `Messages are limited to ${MESSAGE_MAX_LENGTH} characters.` };

  const sensitive = containsSensitiveData(body);
  if (sensitive.blocked) return { error: sensitive.reason };

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, user_a_id, user_b_id")
    .eq("id", conversationId)
    .maybeSingle<Pick<Conversation, "id" | "user_a_id" | "user_b_id">>();
  if (!conversation) return { error: "Conversation not found." };

  const otherId = otherParticipantId(conversation, user.id);
  if (otherId) {
    // is_blocked() returns a plain scalar boolean (not a row/table), so this
    // is a direct RPC call with no .single()/.returns() postprocessing.
    const { data: blocked } = await supabase.rpc("is_blocked", { a: user.id, b: otherId });
    if (blocked) {
      return { error: "You can't send messages in this conversation." };
    }
  }

  const { data: message, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: user.id, body })
    .select("*")
    .single<Message>();

  if (error || !message) {
    // validate_message_content() (0049) raises its own specific message for
    // the sensitive-content case — surfaced directly on the off chance the
    // client-side containsSensitiveData() check above missed something the
    // DB's copy of the rule still catches, same "the DB's own exception text
    // is already written for a human" discipline as placeBid()/offerAction()'s
    // known-rejection-snippet matching elsewhere in this app.
    const dbMessage = error?.message ?? "";
    if (dbMessage.includes("card number") || dbMessage.includes("IBAN") || dbMessage.includes("verification")) {
      return { error: dbMessage };
    }
    return { error: "Couldn't send that message — please try again." };
  }

  if (otherId) {
    await broadcast(conversationChannelTopic(conversationId), "new_message", { message });
    await broadcast(inboxChannelTopic(otherId), "new_message", {
      conversationId,
      senderId: user.id,
      preview: body.slice(0, 140),
      createdAt: message.created_at,
    });

    // Best-effort, same as the broadcasts above — a notification failing to
    // write must never fail the send itself. notify_user() is
    // service-role-only (see 0056's own comment), so this goes through the
    // admin client, same as reportMessage()/reportConversation() below.
    const { data: sender } = await supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle<{ first_name: string; last_name: string }>();
    const senderName = sender ? `${sender.first_name} ${sender.last_name}`.trim() : "A member";
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

  refreshThread(conversationId);
  return { success: true };
}

/**
 * Marks everything in this conversation as read up to right now, for the
 * caller's own side only — prevent_conversation_tampering() (0049) is what
 * actually stops this from touching the other participant's read state or
 * any other column; this function just picks `now()` and writes it to
 * whichever of the two read-cursor columns is the caller's own.
 */
export async function markConversationRead(conversationId: number): Promise<MessageActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, user_a_id, user_b_id")
    .eq("id", conversationId)
    .maybeSingle<Pick<Conversation, "id" | "user_a_id" | "user_b_id">>();
  if (!conversation) return { error: "Conversation not found." };

  const nowIso = new Date().toISOString();
  const column = conversation.user_a_id === user.id ? "user_a_last_read_at" : "user_b_last_read_at";

  const { error } = await supabase.from("conversations").update({ [column]: nowIso }).eq("id", conversationId);
  if (error) return { error: "Couldn't mark this conversation read." };

  revalidatePath("/conversations");
  return { success: true };
}

async function setArchived(conversationId: number, archived: boolean): Promise<MessageActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, user_a_id, user_b_id")
    .eq("id", conversationId)
    .maybeSingle<Pick<Conversation, "id" | "user_a_id" | "user_b_id">>();
  if (!conversation) return { error: "Conversation not found." };

  const column = conversation.user_a_id === user.id ? "user_a_archived_at" : "user_b_archived_at";
  const { error } = await supabase
    .from("conversations")
    .update({ [column]: archived ? new Date().toISOString() : null })
    .eq("id", conversationId);
  if (error) return { error: "Couldn't update this conversation." };

  refreshThread(conversationId);
  return { success: true };
}

/** Archives this conversation for the caller only — the other participant's
 * inbox is entirely unaffected (0049's per-side archive columns). */
export async function archiveConversation(conversationId: number): Promise<MessageActionState> {
  return setArchived(conversationId, true);
}

export async function unarchiveConversation(conversationId: number): Promise<MessageActionState> {
  return setArchived(conversationId, false);
}

/**
 * Blocks `otherUserId`: no more messages either direction in any existing
 * conversation between them (messages' insert policy, 0049) and no new
 * conversation can start (can_message(), 0049) until unblocked. Existing
 * message history is untouched either way — blocking stops future contact,
 * it isn't a delete/hide action.
 */
export async function blockUser(otherUserId: string): Promise<MessageActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (otherUserId === user.id) return { error: "You can't block yourself." };

  const rateLimit = await checkRateLimit({
    action: "block-user",
    identifier: user.id,
    maxHits: BLOCK_USER_MAX_ATTEMPTS,
    windowSeconds: BLOCK_USER_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const { error } = await supabase.from("blocked_users").insert({ blocker_id: user.id, blocked_id: otherUserId });
  if (error && error.code !== "23505") return { error: "Couldn't block that member — please try again." };

  revalidatePath("/conversations");
  return { success: true };
}

export async function unblockUser(otherUserId: string): Promise<MessageActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", otherUserId);
  if (error) return { error: "Couldn't unblock that member — please try again." };

  revalidatePath("/conversations");
  return { success: true };
}

/**
 * The user-facing entry point the admin privileged-access model depends on
 * (see the privacy model note in supabase/migrations/0025_messaging.sql):
 * a report filed here is what lets a moderator open grantConversationAccess()
 * on the resulting /admin/reports/[id] case. `reports` has no insert policy
 * for `authenticated` at all (see 0016_admin_reports.sql) — writing here
 * goes through the service-role client, same as respondToOffer()'s order
 * write, after re-verifying participancy under the caller's own RLS-bound
 * session first (never trust the conversationId alone).
 */
export async function reportConversation(conversationId: number, _prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rateLimit = await checkRateLimit({
    action: "report-conversation",
    identifier: user.id,
    maxHits: REPORT_MAX_ATTEMPTS,
    windowSeconds: REPORT_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const category = String(formData.get("category") ?? "") as ReportCategory;
  const description = String(formData.get("description") ?? "").trim();
  const evidenceRefs = parseEvidenceRefs(String(formData.get("evidence") ?? ""));

  if (!REPORT_CATEGORIES.includes(category)) return { error: "Please choose a reason." };
  if (description.length > 4000) return { error: "Please keep the description under 4000 characters." };

  // RLS-bound select: returns a row only if `user` is actually a
  // participant of this conversation. This is the participancy check —
  // the service-role insert below trusts it completely.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle<Pick<Conversation, "id">>();
  if (!conversation) return { error: "Conversation not found." };

  const admin = createAdminClient();
  const { error } = await admin.from("reports").insert({
    reporter_id: user.id,
    target_type: "conversation",
    target_id: String(conversationId),
    category,
    description: description || null,
    evidence_refs: evidenceRefs.length ? evidenceRefs : null,
  });

  if (error) return { error: "Couldn't file that report — please try again." };

  refreshThread(conversationId);
  return { success: true };
}

/**
 * The per-message counterpart to reportConversation() — 'message' has been
 * a valid reports.target_type since 0016_admin_reports.sql, specifically
 * anticipating this. Same participancy-then-service-role-insert shape:
 * `messages`' own SELECT policy is the participancy check (a stranger's
 * message id just returns no row), the service-role insert trusts that
 * completely.
 */
export async function reportMessage(messageId: number, _prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rateLimit = await checkRateLimit({
    action: "report-message",
    identifier: user.id,
    maxHits: REPORT_MAX_ATTEMPTS,
    windowSeconds: REPORT_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const category = String(formData.get("category") ?? "") as ReportCategory;
  const description = String(formData.get("description") ?? "").trim();
  const evidenceRefs = parseEvidenceRefs(String(formData.get("evidence") ?? ""));

  if (!REPORT_CATEGORIES.includes(category)) return { error: "Please choose a reason." };
  if (description.length > 4000) return { error: "Please keep the description under 4000 characters." };

  const { data: message } = await supabase
    .from("messages")
    .select("id, conversation_id")
    .eq("id", messageId)
    .maybeSingle<Pick<Message, "id" | "conversation_id">>();
  if (!message) return { error: "Message not found." };

  const admin = createAdminClient();
  const { error } = await admin.from("reports").insert({
    reporter_id: user.id,
    target_type: "message",
    target_id: String(messageId),
    category,
    description: description || null,
    evidence_refs: evidenceRefs.length ? evidenceRefs : null,
  });

  if (error) return { error: "Couldn't file that report — please try again." };

  refreshThread(message.conversation_id);
  return { success: true };
}

/**
 * The member-facing counterpart to reportConversation()/reportMessage() for
 * `target_type = 'user'` — the oldest of the three (valid on `reports`
 * since 0016_admin_reports.sql), but never had a member-facing entry point
 * until now. Deliberately requires an existing conversation between the
 * two members (rather than accepting any profile id) as its participancy
 * check, same "never trust the id alone" discipline as reportConversation()
 * — a stranger can't be reported without ever having interacted with them.
 */
export async function reportUser(otherUserId: string, _prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (otherUserId === user.id) return { error: "You can't report yourself." };

  const rateLimit = await checkRateLimit({
    action: "report-user",
    identifier: user.id,
    maxHits: REPORT_MAX_ATTEMPTS,
    windowSeconds: REPORT_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const category = String(formData.get("category") ?? "") as ReportCategory;
  const description = String(formData.get("description") ?? "").trim();
  const evidenceRefs = parseEvidenceRefs(String(formData.get("evidence") ?? ""));

  if (!REPORT_CATEGORIES.includes(category)) return { error: "Please choose a reason." };
  if (description.length > 4000) return { error: "Please keep the description under 4000 characters." };

  const [a, b] = [user.id, otherUserId].sort();
  const { data: sharedConversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_a_id", a)
    .eq("user_b_id", b)
    .limit(1)
    .maybeSingle<Pick<Conversation, "id">>();
  if (!sharedConversation) return { error: "You can only report a member you've been in conversation with." };

  const admin = createAdminClient();
  const { error } = await admin.from("reports").insert({
    reporter_id: user.id,
    target_type: "user",
    target_id: otherUserId,
    category,
    description: description || null,
    evidence_refs: evidenceRefs.length ? evidenceRefs : null,
  });

  if (error) return { error: "Couldn't file that report — please try again." };

  refreshThread(sharedConversation.id);
  return { success: true };
}

// Same shape and reasoning as BLOCK_USER_MAX_ATTEMPTS above — a rare,
// deliberate action a real member does a handful of times, tight ceiling
// mainly to blunt a scripted mute/unmute-flapping loop.
const MUTE_USER_MAX_ATTEMPTS = 20;
const MUTE_USER_WINDOW_SECONDS = 60 * 60;

/**
 * Mutes `otherUserId` — a purely personal, asymmetric "don't surface to me"
 * signal (muted_users, 0055_marketplace_trust_safety.sql). Unlike
 * blockUser(), this never touches messaging or offer eligibility: the
 * other member can still message and trade normally, and has no way to
 * see they've been muted (RLS on muted_users scopes every row to its own
 * muter_id). It's purely a client-side/inbox-display signal for the
 * muter's own conversation list.
 */
export async function muteUser(otherUserId: string): Promise<MessageActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (otherUserId === user.id) return { error: "You can't mute yourself." };

  const rateLimit = await checkRateLimit({
    action: "mute-user",
    identifier: user.id,
    maxHits: MUTE_USER_MAX_ATTEMPTS,
    windowSeconds: MUTE_USER_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const { error } = await supabase.from("muted_users").insert({ muter_id: user.id, muted_id: otherUserId });
  if (error && error.code !== "23505") return { error: "Couldn't mute that member — please try again." };

  revalidatePath("/conversations");
  return { success: true };
}

export async function unmuteUser(otherUserId: string): Promise<MessageActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("muted_users")
    .delete()
    .eq("muter_id", user.id)
    .eq("muted_id", otherUserId);
  if (error) return { error: "Couldn't unmute that member — please try again." };

  revalidatePath("/conversations");
  return { success: true };
}
