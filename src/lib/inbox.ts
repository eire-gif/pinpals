/**
 * One inbox, from two tables.
 *
 * A member has never cared that an offer lives in `notifications` and a
 * reply lives in `messages`. Both are "something happened, and I haven't
 * looked at it yet". This module is the part of that merge with no database
 * and no React in it: the shape of a row, how the two streams interleave,
 * and what each filter means. Both the website and the app read from it —
 * the app by mirroring it, the way mobile/src/lib/theme.ts mirrors
 * globals.css.
 *
 * The arithmetic does NOT live here. inbox_unread_counts() in
 * 0083_unified_inbox.sql owns the numbers, precisely so that a badge and the
 * list underneath it cannot disagree about what unread means.
 */

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * A conversation, as the inbox sees it.
 *
 * `unreadCount` rather than a boolean: a thread with nine replies waiting is
 * a different proposition from one with a single "ok", and the row says so.
 */
export type InboxConversation = {
  kind: "conversation";
  /** conversations.id */
  id: number;
  /** last_message_at, falling back to created_at for a thread nobody has
   *  written in yet. */
  at: string;
  otherName: string;
  otherAvatarColor: string | null;
  listingTitle: string | null;
  listingImageUrl: string | null;
  unreadCount: number;
  archived: boolean;
  href: string;
};

/**
 * An alert — one row of `notifications`.
 *
 * Deliberately NOT one per message: `new_message` notifications are written
 * for email and push and are filtered out before they ever reach this type.
 * See the migration for why.
 */
export type InboxAlert = {
  kind: "alert";
  /** notifications.id */
  id: number;
  at: string;
  type: string;
  title: string;
  body: string;
  href: string;
  unread: boolean;
};

export type InboxItem = InboxConversation | InboxAlert;

/** The counts inbox_unread_counts() returns, in the casing TypeScript uses. */
export type InboxCounts = { messages: number; alerts: number };

export const inboxTotal = (counts: InboxCounts): number =>
  counts.messages + counts.alerts;

/**
 * The alert type that exists only to be delivered.
 *
 * Every message writes one so the recipient gets an email and a push, but
 * the conversation is what a member reads. Showing both would mean the same
 * event appearing twice in one list, with two separate unread states that
 * nothing could reconcile.
 */
export const DELIVERY_ONLY_ALERT_TYPES = ["new_message"] as const;

export const isDeliveryOnlyAlert = (type: string): boolean =>
  (DELIVERY_ONLY_ALERT_TYPES as readonly string[]).includes(type);

export const isInboxItemUnread = (item: InboxItem): boolean =>
  item.kind === "conversation" ? item.unreadCount > 0 : item.unread;

// ---------------------------------------------------------------------------
// Interleaving
// ---------------------------------------------------------------------------

/**
 * Newest first, across both streams.
 *
 * Ties are broken deterministically — conversations before alerts, then
 * higher id first — rather than left to the sort's stability, because the
 * two arrays arrive from two queries whose relative order is not guaranteed
 * and a list that reshuffles itself between renders is its own small bug.
 *
 * A conversation and the `new_message` alert it produced would land on the
 * same millisecond; that pair is exactly what isDeliveryOnlyAlert() removes
 * before we get here.
 */
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

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const INBOX_FILTERS = ["all", "messages", "alerts", "archived"] as const;

export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const INBOX_FILTER_LABELS: Record<InboxFilter, string> = {
  all: "All",
  messages: "Messages",
  alerts: "Alerts",
  archived: "Archived",
};

/**
 * "All" means everything a member has not put away — archived threads are
 * reachable, not resident. An archived conversation appearing in the default
 * view would make archiving pointless, and archiving is the only tool anyone
 * has for a thread that is finished but worth keeping.
 */
export function matchesInboxFilter(item: InboxItem, filter: InboxFilter): boolean {
  switch (filter) {
    case "all":
      return item.kind === "alert" || !item.archived;
    case "messages":
      return item.kind === "conversation" && !item.archived;
    case "alerts":
      return item.kind === "alert";
    case "archived":
      return item.kind === "conversation" && item.archived;
  }
}

export const isInboxFilter = (value: string | null | undefined): value is InboxFilter =>
  (INBOX_FILTERS as readonly string[]).includes(value ?? "");

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The stamp on a row: "09:41" today, "Tue" this week, "12 Sep" beyond it.
 *
 * en-IE defaults to the 24-hour clock, which is what Irish members expect
 * and which also sidesteps the am/pm sniffing that broke the app's own
 * dayLabel() once already — so it is spelled out rather than left to the
 * locale, and the format cannot drift between the two surfaces.
 */
export function inboxTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  const elapsed = now.getTime() - then.getTime();

  if (elapsed < MINUTE) return "Just now";

  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();

  if (sameDay) {
    return then.toLocaleTimeString("en-IE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  if (elapsed < 7 * DAY) {
    return then.toLocaleDateString("en-IE", { weekday: "short" });
  }

  return then.toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

// ---------------------------------------------------------------------------
// Alert icons
// ---------------------------------------------------------------------------

/**
 * A coarse family per alert type, so a row can carry a glyph without every
 * surface writing its own 28-case switch.
 *
 * Coarse on purpose: the categories members can silence in their settings
 * (see NOTIFICATION_TYPE_CATEGORY) are the vocabulary they already know, and
 * a finer split here would mean a new icon to choose every time a type is
 * added.
 */
export type AlertFamily = "message" | "offer" | "auction" | "payment" | "review" | "tee-time" | "other";

export function alertFamily(type: string): AlertFamily {
  if (type.startsWith("tee_time_")) return "tee-time";
  if (type.startsWith("offer_") || type === "reservation_expired") return "offer";
  if (type.startsWith("auction_") || type === "outbid") return "auction";
  if (
    type.startsWith("payment_") ||
    type.startsWith("refund_") ||
    type.startsWith("dispute_") ||
    type === "seller_action_required"
  ) {
    return "payment";
  }
  if (type === "review_available") return "review";
  if (type === "new_message") return "message";
  return "other";
}
