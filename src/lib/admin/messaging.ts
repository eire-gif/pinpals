import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildMessagesCursorFilter, nextMessagesCursor, type MessagesCursor } from "@/lib/messaging";
import type { Message } from "@/lib/types";

// The read side of the admin privileged-access model — see the privacy
// model comment at the top of supabase/migrations/0025_messaging.sql and
// grantConversationAccess()/hideMessage()/restoreMessage() in
// src/app/admin/reports/[id]/actions.ts, which are the only callers of
// anything in this file. There is deliberately no "list all conversations"
// or "list all messages" query anywhere in this app — every read here is
// scoped to one specific conversation, reached from one specific report.

export const CONVERSATION_ACCESS_WINDOW_SIZE = 30;

export type ConversationAccessParticipant = { id: string; name: string };

export type ConversationAccessWindow = {
  conversationId: number;
  participants: ConversationAccessParticipant[];
  messages: Message[];
  nextCursor: MessagesCursor | null;
};

// The useActionState shape for grantConversationAccess()/loadOlderConversationAccess()
// (src/app/admin/reports/[id]/actions.ts) — like ModerationState, but carrying
// the revealed window's data on success. Import this as `import type` from a
// client component (the "server-only" import above is erased along with any
// other type-only import, so that's safe).
export type ConversationAccessState = {
  error?: string;
  success?: boolean;
} & Partial<ConversationAccessWindow>;

/**
 * Resolves a report's target (target_type 'conversation' or 'message') down
 * to the conversation it lives in, plus the timestamp to anchor the first
 * reveal's window on: the reported message's own created_at for a 'message'
 * target, or the report's own filed-at time for a whole-conversation
 * report — either way, "what was actually relevant when this was reported,"
 * not the present moment. Returns null if the target row no longer exists.
 */
async function resolveConversationAnchor(
  admin: ReturnType<typeof createAdminClient>,
  targetType: "conversation" | "message",
  targetId: string,
  reportCreatedAt: string
): Promise<{ conversationId: number; anchor: string } | null> {
  if (targetType === "conversation") {
    const { data } = await admin
      .from("conversations")
      .select("id")
      .eq("id", Number(targetId))
      .maybeSingle<{ id: number }>();
    if (!data) return null;
    return { conversationId: data.id, anchor: reportCreatedAt };
  }

  const { data } = await admin
    .from("messages")
    .select("conversation_id, created_at")
    .eq("id", Number(targetId))
    .maybeSingle<{ conversation_id: number; created_at: string }>();
  if (!data) return null;
  return { conversationId: data.conversation_id, anchor: data.created_at };
}

/**
 * Loads one bounded, minimized window of a conversation's messages for the
 * admin conversation-access panel — never the whole thread. Pass `cursor`
 * for a "load older" follow-up (still bounded to CONVERSATION_ACCESS_WINDOW_SIZE);
 * omit it for the initial reveal, which anchors on resolveConversationAnchor()'s
 * result. This function does NOT write the audit log entry — the caller
 * (grantConversationAccess() in src/app/admin/reports/[id]/actions.ts) does
 * that itself, since it's the one that knows the actor/reason/report id.
 */
export async function getConversationAccessWindow(params: {
  targetType: "conversation" | "message";
  targetId: string;
  reportCreatedAt: string;
  cursor?: MessagesCursor;
}): Promise<ConversationAccessWindow | { notFound: true }> {
  const admin = createAdminClient();
  const resolved = await resolveConversationAnchor(admin, params.targetType, params.targetId, params.reportCreatedAt);
  if (!resolved) return { notFound: true };

  let query = admin
    .from("messages")
    .select("*")
    .eq("conversation_id", resolved.conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CONVERSATION_ACCESS_WINDOW_SIZE);

  query = params.cursor
    ? query.or(buildMessagesCursorFilter(params.cursor))
    : query.lte("created_at", resolved.anchor);

  const { data: rows } = await query.returns<Message[]>();
  const messages = (rows ?? []).slice().reverse();

  const { data: conversation } = await admin
    .from("conversations")
    .select("user_a_id, user_b_id")
    .eq("id", resolved.conversationId)
    .maybeSingle<{ user_a_id: string; user_b_id: string }>();

  const participantIds = conversation ? [conversation.user_a_id, conversation.user_b_id] : [];
  const { data: profiles } = participantIds.length
    ? await admin.from("profiles").select("id, first_name, last_name").in("id", participantIds)
    : { data: [] as { id: string; first_name: string; last_name: string }[] };

  const participants: ConversationAccessParticipant[] = (profiles ?? []).map((p) => ({
    id: p.id,
    name: `${p.first_name} ${p.last_name}`.trim(),
  }));

  return {
    conversationId: resolved.conversationId,
    participants,
    messages,
    nextCursor: nextMessagesCursor(rows ?? [], CONVERSATION_ACCESS_WINDOW_SIZE),
  };
}
