import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { initials } from "@/lib/format";
import {
  CONVERSATION_MEMBERS_EMBED,
  conversationName,
  otherParticipantId,
  type ConversationMemberRow,
} from "@/lib/messaging";
import type { Conversation } from "@/lib/types";
import { listLatestMessages, markConversationRead } from "../actions";
import ThreadView from "./thread-view";
import ReportForm from "./report-form";
import BlockControl from "./block-control";
import MuteControl from "./mute-control";
import ListingContextCard from "./listing-context-card";

type ConversationRow = Conversation & {
  members: ConversationMemberRow[];
  listing: { id: number; title: string; status: string; price_eur: number | null; image_url: string | null } | null;
  order: { id: number; status: string } | null;
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
    .select(
      `*, ${CONVERSATION_MEMBERS_EMBED}, listing:listings(id, title, status, price_eur, image_url), order:orders(id, status)`
    )
    .eq("id", conversationId)
    .maybeSingle<ConversationRow>();
  if (!conversation) notFound();

  const members = conversation.members ?? [];
  // Null for a group: block/mute/report are all about one other person, and a
  // group has no such person. The controls below are hidden for one.
  const otherId = otherParticipantId(conversation, user.id);
  const otherName = conversationName(conversation, members, user.id);

  // Every member, so a group's bubbles carry the right name and colour rather
  // than falling back to "Unknown member" for everyone but the two the old
  // query happened to join.
  const participants: Record<string, { id: string; name: string; avatar_color: string | null }> = {};
  for (const member of members) {
    if (!member.profile) continue;
    participants[member.profile.id] = {
      id: member.profile.id,
      name: `${member.profile.first_name} ${member.profile.last_name}`.trim() || "Unknown member",
      avatar_color: member.profile.avatar_color,
    };
  }

  const [messagesResult, blockedResult, myBlockResult, myMuteResult] = await Promise.all([
    listLatestMessages(conversationId),
    // Either direction — this is what actually disables the composer, since
    // messages' own insert policy (0049) rejects the send regardless of
    // which side blocked the other.
    otherId ? supabase.rpc("is_blocked", { a: user.id, b: otherId }) : Promise.resolve({ data: false }),
    // Specifically "did I block them" — BlockControl's own toggle state
    // (a viewer can only ever unblock a block THEY made).
    otherId
      ? supabase.from("blocked_users").select("blocker_id").eq("blocker_id", user.id).eq("blocked_id", otherId).maybeSingle()
      : Promise.resolve({ data: null }),
    // Specifically "have I muted them" — MuteControl's own toggle state,
    // scoped to the caller's own mute rows by muted_users' RLS.
    otherId
      ? supabase.from("muted_users").select("muter_id").eq("muter_id", user.id).eq("muted_id", otherId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Best-effort — mark-as-read failing must never stop the thread from
  // rendering (same non-blocking discipline as every other secondary write
  // in this app). markConversationRead() re-verifies participancy itself.
  void markConversationRead(conversationId);

  const initialMessages = "messages" in messagesResult ? messagesResult.messages : [];
  const initialCursor = "nextCursor" in messagesResult ? messagesResult.nextCursor : null;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 md:py-14">
      <Link href="/conversations" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← All conversations
      </Link>

      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-white font-display font-bold text-sm shrink-0"
            style={{
              background:
                conversation.kind === "group"
                  ? "#0c2038"
                  : (participants[otherId ?? ""]?.avatar_color ?? "#1f5c2e"),
            }}
          >
            {initials(otherName)}
          </div>
          <div>
            <h1 className="font-display font-bold text-2xl">{otherName}</h1>
            {conversation.kind === "group" && (
              // Who is actually in here. A group with no member list is a
              // thread you are talking into without knowing who is listening.
              <p className="text-sm text-ink-500">
                {members
                  .map((m) => participants[m.member_id]?.name ?? "Unknown member")
                  .join(", ")}
              </p>
            )}
          </div>
        </div>
        {otherId && (
          <div className="flex items-center gap-3">
            <MuteControl otherUserId={otherId} initiallyMuted={!!myMuteResult.data} />
            <BlockControl otherUserId={otherId} initiallyBlocked={!!myBlockResult.data} />
          </div>
        )}
      </div>

      <ListingContextCard listing={conversation.listing} order={conversation.order} />

      <div className="bg-surface border border-line rounded-2xl shadow-sm p-5 mb-4 min-h-[300px]">
        <ThreadView
          conversationId={conversationId}
          initialMessages={initialMessages}
          initialCursor={initialCursor}
          currentUserId={user.id}
          participants={participants}
          blocked={!!blockedResult.data}
        />
      </div>

      <div className="flex items-center gap-4">
        <ReportForm target={{ type: "conversation", id: conversationId }} />
        {otherId && <ReportForm target={{ type: "user", id: otherId }} label="Report this member" />}
      </div>
    </div>
  );
}
