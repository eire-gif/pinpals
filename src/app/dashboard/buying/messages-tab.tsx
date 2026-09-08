import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/admin/format";
import { otherParticipantId, isConversationArchived } from "@/lib/messaging";
import Pagination from "@/components/dashboard/pagination";
import MarketplaceEmptyState from "@/components/marketplace/empty-state";
import type { Conversation, ConversationParticipant } from "@/lib/types";

const PAGE_SIZE = 10;

type ConversationRow = Conversation & {
  user_a: ConversationParticipant | null;
  user_b: ConversationParticipant | null;
};

// The task spec's "messages" view. Deliberately a thin summary, not a
// reimplementation — /conversations (src/app/conversations/page.tsx) is the
// real inbox with its own read state, archiving and Buying/Selling filters;
// duplicating that here would mean two places that can drift on what
// "unread" means. This lists the same underlying `conversations` rows
// (excluding this viewer's own archived threads, same as the real inbox's
// default view) and links every row straight into the real thread — no
// separate messaging UI of its own.
export default async function MessagesTab({ userId, page }: { userId: string; page: number }) {
  const supabase = await createClient();
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const [{ data: rows, count }, { data: unreadRows }] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        "*, user_a:profiles!conversations_user_a_id_fkey(id, first_name, last_name, avatar_color), user_b:profiles!conversations_user_b_id_fkey(id, first_name, last_name, avatar_color)",
        { count: "exact" }
      )
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(rangeFrom, rangeTo)
      .returns<ConversationRow[]>(),
    supabase.rpc("conversation_unread_counts"),
  ]);

  const unreadByConversation = new Map(
    ((unreadRows as { conversation_id: number; unread_count: number }[] | null) ?? []).map((r) => [
      r.conversation_id,
      r.unread_count,
    ])
  );

  // Filtered client-side (not a `.or()` clause) since PostgREST can't easily
  // express "whichever side is mine has no archive timestamp" in one filter
  // — same per-side asymmetry isConversationArchived() itself exists to
  // handle. This means `count` above (and so the pager below) can slightly
  // over-count relative to what's actually rendered when a page has any
  // archived threads mixed in — an accepted imprecision for this summary
  // widget, not a correctness issue for the real inbox at /conversations
  // (which has its own dedicated Archived tab and doesn't share this code).
  const visibleRows = (rows ?? []).filter((c) => !isConversationArchived(c, userId));

  if (visibleRows.length === 0) {
    return (
      <MarketplaceEmptyState
        title="No conversations yet"
        description="Message a seller or buyer about a listing and it'll show up here."
        actionHref="/marketplace"
        actionLabel="Browse the marketplace"
      />
    );
  }

  return (
    <div>
      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        <ul>
          {visibleRows.map((c) => {
            const otherId = otherParticipantId(c, userId);
            const other = c.user_a_id === otherId ? c.user_a : c.user_b;
            const name = other ? `${other.first_name} ${other.last_name}`.trim() : "Unknown member";
            const unread = unreadByConversation.get(c.id) ?? 0;
            return (
              <li key={c.id} className="border-b border-line last:border-0">
                <Link
                  href={`/conversations/${c.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-surface-tint transition"
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                    style={{ background: other?.avatar_color ?? "#1f5c2e" }}
                  >
                    {name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink-900 truncate">{name}</div>
                    {c.last_message_at && (
                      <div className="text-xs text-ink-500">{formatDateTime(c.last_message_at)}</div>
                    )}
                  </div>
                  {unread > 0 && (
                    <span className="bg-gold-500 text-navy-900 text-xs font-bold px-2.5 py-1 rounded-full shrink-0">
                      {unread} new
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex justify-end mt-3">
        <Link href="/conversations" className="text-sm font-bold text-green-700 hover:text-green-600">
          Open full inbox &rarr;
        </Link>
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefForPage={(p) => `/dashboard/buying?tab=messages&page=${p}`}
      />
    </div>
  );
}
