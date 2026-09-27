"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { initials } from "@/lib/format";
import {
  INBOX_FILTERS,
  INBOX_FILTER_LABELS,
  alertFamily,
  inboxTime,
  matchesInboxFilter,
  type AlertFamily,
  type InboxAlert,
  type InboxConversation,
  type InboxCounts,
  type InboxFilter,
  type InboxItem,
} from "@/lib/inbox";
import { useBroadcastChannel, inboxChannelTopic } from "@/lib/realtime-client";
import { archiveConversation, unarchiveConversation } from "@/app/conversations/actions";
import { markAlertRead, markInboxRead } from "./actions";

/**
 * The inbox's client half.
 *
 * The list itself is server-fetched and passed down already merged — this
 * component filters, renders, and re-asks the server when something changes.
 * It never keeps a second parallel copy of "what's in my inbox": a Realtime
 * ping means *go and look again*, never data to render directly.
 *
 * One subscription for the whole inbox, not one per row. That has been the
 * rule since the messaging work and it matters more here, where a row might
 * be a conversation or might be an alert.
 */
export default function InboxList({
  items,
  counts,
  currentUserId,
}: {
  items: InboxItem[];
  counts: InboxCounts;
  currentUserId: string;
}) {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [clearing, startClearing] = useTransition();
  const router = useRouter();

  useBroadcastChannel(inboxChannelTopic(currentUserId), "new_message", () => {
    router.refresh();
  });

  const filterCounts = useMemo(() => {
    const result = { all: 0, messages: 0, alerts: 0, archived: 0 } as Record<InboxFilter, number>;
    for (const name of INBOX_FILTERS) {
      result[name] = items.filter((item) => matchesInboxFilter(item, name)).length;
    }
    return result;
  }, [items]);

  const visible = items.filter((item) => matchesInboxFilter(item, filter));
  const unreadTotal = counts.messages + counts.alerts;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div className="flex gap-1.5 border-b border-line flex-1 min-w-0 overflow-x-auto">
          {INBOX_FILTERS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setFilter(name)}
              aria-current={filter === name ? "true" : undefined}
              className={`px-4 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition ${
                filter === name
                  ? "border-green-700 text-green-700"
                  : "border-transparent text-ink-500 hover:text-ink-900"
              }`}
            >
              {INBOX_FILTER_LABELS[name]}
              {filterCounts[name] > 0 && (
                <span className="ml-1.5 text-xs text-ink-500">{filterCounts[name]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Shown only when there is something to clear. A button that does
            nothing is worse than no button: it teaches people it is safe to
            ignore. */}
        {unreadTotal > 0 && (
          <button
            type="button"
            disabled={clearing}
            onClick={() =>
              startClearing(async () => {
                await markInboxRead();
                router.refresh();
              })
            }
            className="text-sm font-bold text-green-700 hover:text-green-600 disabled:opacity-50 transition shrink-0"
          >
            {clearing ? "Marking…" : "Mark all as read"}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="bg-surface border border-line rounded-2xl p-8 text-center">
          <p className="text-sm text-ink-500">{emptyMessage(filter)}</p>
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
          {visible.map((item) => (
            <Row key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function emptyMessage(filter: InboxFilter): string {
  switch (filter) {
    case "archived":
      return "No archived conversations.";
    case "messages":
      return "No messages yet. You can message a golfer once you're connected with them, have exchanged a marketplace offer, or have an accepted tee-time interest together.";
    case "alerts":
      return "No alerts yet. Offers, auction activity, payments and tee-time replies will show up here.";
    case "all":
      return "Nothing here yet. Messages from other members and alerts about your listings and tee times will both land in this one list.";
  }
}

function Row({ item }: { item: InboxItem }) {
  return item.kind === "conversation" ? (
    <ConversationRow row={item} />
  ) : (
    <AlertRow row={item} />
  );
}

// ---------------------------------------------------------------------------

function ConversationRow({ row }: { row: InboxConversation }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-line last:border-0 hover:bg-cream-50 transition">
      <Link href={row.href} className="flex items-center gap-3.5 min-w-0 flex-1">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-white font-display font-bold text-sm shrink-0"
          style={{ background: row.otherAvatarColor ?? "#1f5c2e" }}
        >
          {initials(row.otherName)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className={`truncate text-sm ${
                row.unreadCount > 0 ? "font-bold text-ink-900" : "font-semibold text-ink-900"
              }`}
            >
              {row.otherName}
            </span>
            <span className="text-xs text-ink-500 shrink-0 ml-auto">{inboxTime(row.at)}</span>
          </div>
          <p className="text-sm text-ink-500 truncate mt-0.5">
            {row.listingTitle ?? "Direct message"}
          </p>
        </div>
      </Link>

      {row.unreadCount > 0 && (
        <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-green-700 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
          {row.unreadCount > 99 ? "99+" : row.unreadCount}
        </span>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            if (row.archived) await unarchiveConversation(row.id);
            else await archiveConversation(row.id);
            router.refresh();
          })
        }
        className="text-xs font-semibold text-ink-500 hover:text-ink-900 disabled:opacity-50 transition shrink-0"
      >
        {row.archived ? "Unarchive" : "Archive"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * An alert row navigates and marks read in the same gesture, and does not
 * wait for the mark to land before navigating. A slow write should never
 * make a notification feel unclickable — the same call this made on
 * /notifications before the merge.
 */
function AlertRow({ row }: { row: InboxAlert }) {
  return (
    <Link
      href={row.href}
      onClick={() => {
        if (row.unread) void markAlertRead(row.id);
      }}
      className={`flex items-start gap-3.5 px-5 py-4 border-b border-line last:border-0 hover:bg-cream-50 transition ${
        row.unread ? "bg-green-100/40" : ""
      }`}
    >
      <AlertGlyph family={alertFamily(row.type)} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={`truncate text-sm ${
              row.unread ? "font-bold text-ink-900" : "font-semibold text-ink-900"
            }`}
          >
            {row.title}
          </span>
          <span className="text-xs text-ink-500 shrink-0 ml-auto">{inboxTime(row.at)}</span>
        </div>
        {row.body && <p className="text-sm text-ink-500 mt-0.5 line-clamp-2">{row.body}</p>}
      </div>

      {row.unread && (
        <span
          className="w-2 h-2 rounded-full bg-green-600 mt-2 shrink-0"
          aria-label="Unread"
        />
      )}
    </Link>
  );
}

/**
 * Coarse, on purpose: one glyph per family rather than per type, so adding a
 * 29th notification type does not mean choosing a 29th icon. The circle is
 * the same size as a conversation avatar so the two row kinds line up down
 * the left edge instead of looking like two lists stapled together.
 */
const FAMILY_STYLE: Record<AlertFamily, { bg: string; fg: string; path: string }> = {
  message: {
    bg: "#e2ede1",
    fg: "#1f5c2e",
    path: "M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-9Zm1.8.5 5.2 3.9L15.2 6H4.8Z",
  },
  offer: {
    bg: "#fff1d9",
    fg: "#8a5a00",
    path: "M10 2.5 12.1 7l4.9.6-3.6 3.4.9 4.8L10 13.5 5.7 15.8l.9-4.8L3 7.6 7.9 7 10 2.5Z",
  },
  auction: {
    bg: "#f0e6ff",
    fg: "#5b3a9b",
    path: "M4 15h8v2H4v-2Zm2.3-9.2 2.1-2.1 5.6 5.7-2.1 2.1-5.6-5.7Zm7.4-2.9 2.4 2.4-1.6 1.6-2.4-2.4 1.6-1.6Z",
  },
  payment: {
    bg: "#e3edf9",
    fg: "#1d4e89",
    path: "M2.5 6.5A1.5 1.5 0 0 1 4 5h12a1.5 1.5 0 0 1 1.5 1.5v1h-15v-1Zm0 3h15v4A1.5 1.5 0 0 1 16 15H4a1.5 1.5 0 0 1-1.5-1.5v-4Zm2 2v1.5h4V11.5h-4Z",
  },
  review: {
    bg: "#fdeaea",
    fg: "#a83a2b",
    path: "M10 3.2c2.3-2 5.6-.6 5.6 2.2 0 2.6-3 5-5.6 7.3C7.4 10.4 4.4 8 4.4 5.4c0-2.8 3.3-4.2 5.6-2.2Z",
  },
  "tee-time": {
    bg: "#e2ede1",
    fg: "#1f5c2e",
    path: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.9 3.6v4.1l3.1 1.9-.8 1.3-3.8-2.3V5.6h1.5Z",
  },
  other: {
    bg: "#eceff3",
    fg: "#647082",
    path: "M10 2.5a4.5 4.5 0 0 0-4.5 4.5v3.2L4 13.2h12l-1.5-3V7A4.5 4.5 0 0 0 10 2.5Zm0 15a2.2 2.2 0 0 0 2.1-1.6H7.9A2.2 2.2 0 0 0 10 17.5Z",
  },
};

function AlertGlyph({ family }: { family: AlertFamily }) {
  const style = FAMILY_STYLE[family];
  return (
    <span
      className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
      style={{ background: style.bg }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 20 20" width="19" height="19" fill={style.fg}>
        <path d={style.path} />
      </svg>
    </span>
  );
}
