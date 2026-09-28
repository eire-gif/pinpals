import Ionicons from "@expo/vector-icons/Ionicons";

import { listInbox, type InboxRow } from "./messages";
import { supabase } from "./supabase";

/**
 * One inbox: conversations and alerts in a single list.
 *
 * Mirrors src/lib/inbox.ts on the website, the way theme.ts mirrors
 * globals.css — the merge rules and the filter names have to agree, and there
 * is no shared package between the two.
 *
 * What is NOT mirrored is the arithmetic. inbox_unread_counts()
 * (0083_unified_inbox.sql) owns both numbers, and both surfaces call it, so
 * a badge here can never disagree with the same badge on the site or with the
 * list underneath it. Before this, the app counted notifications with one
 * query and messages with another and the envelope showed a dot because
 * nothing could say what the total was.
 */

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type InboxConversation = InboxRow & { kind: "conversation"; at: string };

export type InboxAlert = {
  kind: "alert";
  id: number;
  at: string;
  type: string;
  title: string;
  body: string | null;
  /** A website path, e.g. /marketplace/12. Opened in the app's own web view,
   *  never handed to the browser. */
  href: string;
  unread: boolean;
};

export type InboxItem = InboxConversation | InboxAlert;

export type InboxCounts = { messages: number; alerts: number };

export const inboxTotal = (counts: InboxCounts): number =>
  counts.messages + counts.alerts;

/**
 * "3 unread messages and 2 alerts", not "5 unread".
 *
 * The two mean different things to the person reading them — one is somebody
 * waiting on a reply, the other is the site telling you something — and a
 * single merged number hides which of those is true. The badge can be one
 * number because a badge has no room to say more; a line of text does.
 */
export function describeUnread(messages: number, alerts: number): string {
  const parts: string[] = [];
  if (messages > 0)
    parts.push(`${messages} unread ${messages === 1 ? "message" : "messages"}`);
  if (alerts > 0) parts.push(`${alerts} ${alerts === 1 ? "alert" : "alerts"}`);
  return parts.join(" and ");
}

/**
 * Written for every message so the recipient gets an email and a push — and
 * never shown, because the conversation is the row a member reads. Showing
 * both would put every message in the list twice with two unread states that
 * nothing could reconcile. Same rule, same constant name, on the website.
 */
const DELIVERY_ONLY_ALERT_TYPES = ["new_message"];

export const isDeliveryOnlyAlert = (type: string): boolean =>
  DELIVERY_ONLY_ALERT_TYPES.includes(type);

// ---------------------------------------------------------------------------
// Interleaving and filtering
// ---------------------------------------------------------------------------

export function mergeInbox(
  conversations: InboxConversation[],
  alerts: InboxAlert[]
): InboxItem[] {
  return [...conversations, ...alerts].sort((a, b) => {
    const byTime = Date.parse(b.at) - Date.parse(a.at);
    if (byTime !== 0 && Number.isFinite(byTime)) return byTime;
    if (a.kind !== b.kind) return a.kind === "conversation" ? -1 : 1;
    return b.id - a.id;
  });
}

export const INBOX_FILTERS = ["all", "messages", "alerts"] as const;

export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const INBOX_FILTER_LABELS: Record<InboxFilter, string> = {
  all: "All",
  messages: "Messages",
  alerts: "Alerts",
};

/**
 * No "Archived" chip here, unlike the website.
 *
 * listInbox() already drops archived threads, and archiving itself lives on
 * the website — offering a filter for a state the app cannot put anything
 * into would be a tab that is empty for everyone who has only ever used the
 * app.
 */
export function matchesInboxFilter(item: InboxItem, filter: InboxFilter): boolean {
  if (filter === "all") return true;
  if (filter === "messages") return item.kind === "conversation";
  return item.kind === "alert";
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/**
 * One glyph per family rather than per type, so a 29th notification type does
 * not mean choosing a 29th icon. The families match alertFamily() on the
 * website; only the glyph names are Ionicons rather than SVG paths.
 */
export function alertIcon(type: string): keyof typeof Ionicons.glyphMap {
  if (type.startsWith("tee_time_")) return "golf-outline";
  if (type.startsWith("offer_") || type === "reservation_expired") return "pricetag-outline";
  if (type.startsWith("auction_") || type === "outbid") return "hammer-outline";
  if (
    type.startsWith("payment_") ||
    type.startsWith("refund_") ||
    type.startsWith("dispute_") ||
    type === "seller_action_required"
  ) {
    return "card-outline";
  }
  if (type === "review_available") return "star-outline";
  if (type === "new_message") return "chatbubble-outline";
  return "notifications-outline";
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Matches the website's INBOX_ALERTS_LIMIT. Newest first, so the cap only
 *  ever drops what a member is least likely to be looking for. */
const ALERTS_LIMIT = 50;

type AlertRow = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: { href?: string } | null;
  read_at: string | null;
  created_at: string;
};

export type LoadedInbox = { items: InboxItem[]; counts: InboxCounts };

/**
 * Everything the screen needs, in three round trips — two of which listInbox()
 * was already making.
 *
 * RLS decides what comes back: `notifications` and `conversations` both carry
 * own-rows-only SELECT policies, so there is no user filter here to forget.
 */
export async function loadInbox(userId: string): Promise<LoadedInbox> {
  const [conversations, alerts, counts] = await Promise.all([
    listInbox(userId),
    supabase
      .from("notifications")
      .select("id, type, title, body, data, read_at, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(ALERTS_LIMIT)
      .overrideTypes<AlertRow[]>(),
    inboxCounts(),
  ]);

  return {
    items: mergeInbox(
      conversations.map((row) => ({
        ...row,
        kind: "conversation" as const,
        at: row.lastMessageAt ?? new Date(0).toISOString(),
      })),
      (alerts.data ?? [])
        .filter((row) => !isDeliveryOnlyAlert(row.type))
        .map((row) => ({
          kind: "alert" as const,
          id: row.id,
          at: row.created_at,
          type: row.type,
          title: row.title,
          body: row.body,
          href: row.data?.href ?? "/dashboard",
          unread: row.read_at === null,
        }))
    ),
    counts,
  };
}

/** Both numbers, from the one function that decides what unread means. */
export async function inboxCounts(): Promise<InboxCounts> {
  const { data } = await supabase.rpc("inbox_unread_counts");
  const row = (data as { message_count: number; alert_count: number }[] | null)?.[0];
  return {
    messages: Number(row?.message_count ?? 0),
    alerts: Number(row?.alert_count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Marks one alert read. Never throws: a row that stays bold because a write
 * lost the network is a smaller problem than a screen that throws while
 * someone is trying to read it.
 */
export async function markAlertRead(notificationId: number): Promise<void> {
  try {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId)
      .is("read_at", null);
  } catch {
    // Best effort.
  }
}

/**
 * "Mark all as read" — both streams, one call.
 *
 * Returns whether it landed, because this one IS worth telling a member
 * about: they pressed a button expecting a number to go to zero, and a
 * silently failed clear leaves them pressing it again.
 */
/**
 * Deletes one alert, for good.
 *
 * A real delete, not a hidden flag — 0084 added the DELETE policy that makes
 * it possible, own rows only. There is no undo, which is why this is one row
 * on a deliberate two-step gesture and "Mark all read" stays the bulk
 * action.
 *
 * No `.eq("user_id")`: the policy is the filter, and adding a second one here
 * would only create somewhere for the two to disagree.
 *
 * Conversations have no equivalent and must not — see hideConversation() in
 * messages.ts.
 */
export async function deleteAlert(notificationId: number): Promise<boolean> {
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", notificationId);
  return !error;
}

export async function markInboxRead(): Promise<boolean> {
  const { error } = await supabase.rpc("mark_inbox_read");
  return !error;
}
