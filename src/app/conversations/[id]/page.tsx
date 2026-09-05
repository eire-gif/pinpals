import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { initials } from "@/lib/format";
import { otherParticipantId } from "@/lib/messaging";
import type { Conversation, ConversationParticipant } from "@/lib/types";
import { listLatestMessages } from "../actions";
import ThreadView from "./thread-view";
import MessageForm from "./message-form";
import ReportForm from "./report-form";

type ConversationRow = Conversation & {
  user_a: ConversationParticipant | null;
  user_b: ConversationParticipant | null;
};

export default async function ConversationThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversationId = Number(id);
  if (!conversationId || Number.isNaN(conversationId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS (conversations' own select policy) scopes this to conversations the
  // caller is actually a participant of — a stranger's conversation id just
  // returns no row here, same "404, not a permission error" shape as the
  // admin surface.
  const { data: conversation } = await supabase
    .from("conversations")
    .select("*, user_a:profiles!conversations_user_a_id_fkey(id, first_name, last_name, avatar_color), user_b:profiles!conversations_user_b_id_fkey(id, first_name, last_name, avatar_color)")
    .eq("id", conversationId)
    .maybeSingle<ConversationRow>();
  if (!conversation) notFound();

  const otherId = otherParticipantId(conversation, user.id);
  const other = conversation.user_a_id === otherId ? conversation.user_a : conversation.user_b;
  const me = conversation.user_a_id === user.id ? conversation.user_a : conversation.user_b;
  const otherName = other ? `${other.first_name} ${other.last_name}`.trim() : "Unknown member";

  const participants: Record<string, { id: string; name: string; avatar_color: string | null }> = {};
  if (other) participants[other.id] = { id: other.id, name: otherName, avatar_color: other.avatar_color };
  if (me) participants[me.id] = { id: me.id, name: `${me.first_name} ${me.last_name}`.trim(), avatar_color: me.avatar_color };

  const messagesResult = await listLatestMessages(conversationId);
  const initialMessages = "messages" in messagesResult ? messagesResult.messages : [];
  const initialCursor = "nextCursor" in messagesResult ? messagesResult.nextCursor : null;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 md:py-14">
      <Link href="/conversations" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← All conversations
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-white font-display font-bold text-sm shrink-0"
          style={{ background: other?.avatar_color ?? "#1f5c2e" }}
        >
          {initials(otherName)}
        </div>
        <h1 className="font-display font-bold text-2xl">{otherName}</h1>
      </div>

      <div className="bg-surface border border-line rounded-2xl shadow-sm p-5 mb-4 min-h-[300px]">
        <ThreadView
          conversationId={conversationId}
          initialMessages={initialMessages}
          initialCursor={initialCursor}
          currentUserId={user.id}
          participants={participants}
        />
      </div>

      <div className="mb-5">
        <MessageForm conversationId={conversationId} />
      </div>

      <ReportForm conversationId={conversationId} />
    </div>
  );
}
