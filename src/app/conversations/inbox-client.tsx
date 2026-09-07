"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { initials } from "@/lib/format";
import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES } from "@/lib/admin/format";
import type { OrderStatus } from "@/lib/types";
import { INBOX_FILTERS, matchesInboxFilter, type InboxFilter } from "@/lib/messaging";
import { useBroadcastChannel, inboxChannelTopic } from "@/lib/realtime-client";
import { archiveConversation, unarchiveConversation } from "./actions";

export type InboxRow = {
  id: number;
  otherName: string;
  otherAvatarColor: string | null;
  lastMessageAt: string | null;
  listing: { id: number; title: string; status: string; seller_id: string; image_url: string | null } | null;
  orderStatus: string | null;
  role: "buying" | "selling" | null;
  archived: boolean;
  unreadCount: number;
};

const FILTER_LABELS: Record<InboxFilter, string> = {
  all: "All",
  buying: "Buying",
  selling: "Selling",
  archived: "Archived",
};

/**
 * The inbox's client half: tab state, one Realtime subscription for the
 * WHOLE inbox (never one per conversation row — the task's own "avoid one
 * subscription per row or conversation preview" instruction), and the
 * archive/unarchive toggle. The list itself is server-fetched (../page.tsx)
 * and passed down already-shaped — this component filters/renders it, it
 * doesn't re-fetch on its own except via router.refresh() when a broadcast
 * ping arrives, which re-runs the same server query rather than
 * maintaining a second, parallel client-side copy of "what's in my inbox."
 */
export default function InboxClient({ rows, currentUserId }: { rows: InboxRow[]; currentUserId: string }) {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const router = useRouter();

  // One subscription for every conversation this member has, not one per
  // row — a ping just means "go re-fetch," never data to render directly.
  useBroadcastChannel(inboxChannelTopic(currentUserId), "new_message", () => {
    router.refresh();
  });

  const counts = useMemo(() => {
    const c: Record<InboxFilter, number> = { all: 0, buying: 0, selling: 0, archived: 0 };
    for (const filterName of INBOX_FILTERS) {
      c[filterName] = rows.filter((r) => matchesInboxFilter(filterName, r)).length;
    }
    return c;
  }, [rows]);

  const visible = rows.filter((r) => matchesInboxFilter(filter, r));

  return (
    <div>
      <div className="flex gap-1.5 mb-6 border-b border-line">
        {INBOX_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px transition ${
              filter === f ? "border-green-700 text-green-700" : "border-transparent text-ink-500 hover:text-ink-900"
            }`}
          >
            {FILTER_LABELS[f]}
            {counts[f] > 0 && <span className="ml-1.5 text-xs text-ink-500">{counts[f]}</span>}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="bg-surface border border-line rounded-2xl p-8 text-center">
          <p className="text-sm text-ink-500">
            {filter === "archived"
              ? "No archived conversations."
              : filter === "buying"
                ? "No conversations about listings you're buying yet."
                : filter === "selling"
                  ? "No conversations about listings you're selling yet."
                  : "No conversations yet. You can message a golfer once you're connected with them, have exchanged a marketplace offer, or have an accepted tee-time interest together."}
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
          {visible.map((row) => (
            <InboxRowView key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function InboxRowView({ row }: { row: InboxRow }) {
  const [pending, startTransition] = useTransition();

  function toggleArchive() {
    startTransition(async () => {
      if (row.archived) await unarchiveConversation(row.id);
      else await archiveConversation(row.id);
    });
  }

  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-line last:border-0 hover:bg-cream-50 transition">
      <Link href={`/conversations/${row.id}`} className="flex items-center gap-3.5 min-w-0 flex-1">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-white font-display font-bold text-sm shrink-0"
          style={{ background: row.otherAvatarColor ?? "#1f5c2e" }}
        >
          {initials(row.otherName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold truncate">{row.otherName}</span>
            {row.unreadCount > 0 && (
              <span className="shrink-0 bg-green-700 text-cream-50 text-[11px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                {row.unreadCount}
              </span>
            )}
          </div>
          {row.listing ? (
            <div className="text-xs text-ink-500 truncate flex items-center gap-1.5">
              <span
                className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  row.role === "selling" ? "bg-gold-500/20 text-gold-700" : "bg-green-100 text-green-800"
                }`}
              >
                {row.role === "selling" ? "Selling" : "Buying"}
              </span>
              <span className="truncate">{row.listing.title}</span>
              {row.orderStatus && (
                <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${ORDER_STATUS_STYLES[row.orderStatus as OrderStatus] ?? "bg-cream-100 text-ink-700"}`}>
                  {ORDER_STATUS_LABELS[row.orderStatus as OrderStatus] ?? row.orderStatus}
                </span>
              )}
            </div>
          ) : (
            <div className="text-xs text-ink-500">{row.lastMessageAt ? "Tap to view the conversation" : "No messages yet"}</div>
          )}
        </div>
      </Link>
      <button
        type="button"
        onClick={toggleArchive}
        disabled={pending}
        className="shrink-0 text-xs font-bold text-ink-500 hover:text-green-700 disabled:opacity-60 px-2 py-1"
        title={row.archived ? "Unarchive" : "Archive"}
      >
        {row.archived ? "Unarchive" : "Archive"}
      </button>
    </div>
  );
}
