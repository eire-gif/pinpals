import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { initials } from "@/lib/format";
import { otherParticipantId } from "@/lib/messaging";
import type { Conversation, ConversationParticipant } from "@/lib/types";

type ConversationRow = Conversation & {
  user_a: ConversationParticipant | null;
  user_b: ConversationParticipant | null;
};

export default async function ConversationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows } = await supabase
    .from("conversations")
    .select("*, user_a:profiles!conversations_user_a_id_fkey(id, first_name, last_name, avatar_color), user_b:profiles!conversations_user_b_id_fkey(id, first_name, last_name, avatar_color)")
    .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<ConversationRow[]>();

  const conversations = rows ?? [];

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 md:py-14">
      <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
        <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Messages
      </span>
      <h1 className="font-display font-bold text-3xl md:text-4xl mt-2 mb-8">Your conversations</h1>

      {conversations.length === 0 ? (
        <div className="bg-surface border border-line rounded-2xl p-8 text-center">
          <p className="text-sm text-ink-500">
            No conversations yet. You can message a golfer once you&apos;re connected with them, have exchanged a
            marketplace offer, or have an accepted tee-time interest together.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
          {conversations.map((c) => {
            const otherId = otherParticipantId(c, user.id);
            const other = c.user_a_id === otherId ? c.user_a : c.user_b;
            const name = other ? `${other.first_name} ${other.last_name}`.trim() : "Unknown member";
            return (
              <Link
                key={c.id}
                href={`/conversations/${c.id}`}
                className="flex items-center gap-3.5 px-5 py-4 border-b border-line last:border-0 hover:bg-cream-50 transition"
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-white font-display font-bold text-sm shrink-0"
                  style={{ background: other?.avatar_color ?? "#1f5c2e" }}
                >
                  {initials(name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display font-bold truncate">{name}</div>
                  <div className="text-xs text-ink-500">
                    {c.last_message_at ? "Tap to view the conversation" : "No messages yet"}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
