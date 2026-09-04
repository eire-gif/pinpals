"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MESSAGE_MAX_LENGTH, MESSAGES_PAGE_SIZE, buildMessagesCursorFilter, nextMessagesCursor, type MessagesCursor } from "@/lib/messaging";
import { REPORT_CATEGORIES, type ReportCategory } from "@/lib/admin/reports";
import type { Conversation, Message } from "@/lib/types";

export type MessageActionState = { error?: string; success?: boolean };

function refreshThread(conversationId: number) {
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath("/conversations");
}

/**
 * Starts (or reopens) a conversation with `otherUserId` and redirects into
 * it. The actual eligibility check is the `can_message()`-backed insert
 * policy on `conversations` (see supabase/migrations/0025_messaging.sql) —
 * this function's own guard is only there to turn a raw RLS rejection into
 * a friendly error instead of a generic Postgres error message.
 */
export async function startConversation(otherUserId: string): Promise<MessageActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (otherUserId === user.id) return { error: "You can't message yourself." };

  const [a, b] = [user.id, otherUserId].sort();

  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_a_id", a)
    .eq("user_b_id", b)
    .maybeSingle<Pick<Conversation, "id">>();

  if (existing) redirect(`/conversations/${existing.id}`);

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ user_a_id: a, user_b_id: b })
    .select("id")
    .single<Pick<Conversation, "id">>();

  if (error || !created) {
    // The insert policy's can_message() check is what actually rejects an
    // ineligible pair — this is the friendly version of that rejection.
    return { error: "You can only message a golfer you're connected with, have exchanged a marketplace offer with, or have an accepted tee-time interest with." };
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

export async function sendMessage(conversationId: number, _prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Message can't be empty." };
  if (body.length > MESSAGE_MAX_LENGTH) return { error: `Messages are limited to ${MESSAGE_MAX_LENGTH} characters.` };

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body,
  });

  if (error) return { error: "Couldn't send that message — please try again." };

  refreshThread(conversationId);
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

  const category = String(formData.get("category") ?? "") as ReportCategory;
  const description = String(formData.get("description") ?? "").trim();

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
  });

  if (error) return { error: "Couldn't file that report — please try again." };

  refreshThread(conversationId);
  return { success: true };
}
