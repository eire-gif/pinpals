import Ionicons from "@expo/vector-icons/Ionicons";

import { listInbox, type InboxRow } from "./messages";
import { settledReason, todayInDublin, type InterestNow } from "./request-settled";
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
  /** Set on tee-time alerts about one request — lets the row offer the
   *  answer in place (View request / Decline, Confirm / Can't make it). */
  interestId: number | null;
  /** Why that answer is no longer wanted ("You confirmed your place",
   *  "This round was cancelled"), read from the request as it stands now.
   *  Null while it is still waiting on you — or when its state couldn't be
   *  read, in which case the buttons stay and the server has the last word. */
  settled: string | null;
};

/**
 * A single message that matched a search, shown as its own row.
 *
 * Only ever appears while there is a query. The inbox proper lists threads,
 * not messages — but "where did he say the price" is a question about a
 * message, and answering it with the thread it happens to be in leaves the
 * member to scroll for it themselves.
 */
export type InboxMessageHit = {
  kind: "message";
  id: number;
  at: string;
  conversationId: number;
  /** Taken from the loaded inbox row where we have one. A hit in a thread
   *  below the 50-row cap has nothing to look up, and says so rather than
   *  guessing. */
  otherName: string | null;
  otherAvatarUrl: string | null;
  otherAvatarColor: string | null;
  body: string;
  mine: boolean;
};

export type InboxItem = InboxConversation | InboxAlert;

/** What a list row can be. Message hits are search-only, so they are kept
 *  out of InboxItem — nothing that merges, counts or swipes should ever
 *  have to consider them. */
export type InboxRowItem = InboxItem | InboxMessageHit;

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
  // "Chat" for member-to-member conversations (Oct 2026): it says people
  // talking, where "Messages" read as anything the app sends you.
  messages: "Chat",
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

/**
 * Unread, for either kind of row.
 *
 * A conversation is unread when it has messages you haven't got to; an alert
 * is unread until you open it. Two different mechanisms — a moving cursor
 * and a one-off flag — which is exactly why this is written down once rather
 * than re-derived at each call site.
 *
 * Note this is NOT the same question inbox_unread_counts() answers. That
 * function is the badge and excludes archived threads and delivery-only
 * alerts; this is a row in front of you, and a row you can see should match
 * what the filter says about it.
 */
export function isUnread(item: InboxItem): boolean {
  return item.kind === "conversation" ? item.unreadCount > 0 : item.unread;
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/** Case- and accent-insensitive: "o'neill" should find "O'Neill", and
 *  "dun laoghaire" should find "Dún Laoghaire". NFD then strip the combining
 *  marks — the same normalisation a member would expect from any search box
 *  and none of them would think to ask for. */
const fold = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Does this row match what was typed?
 *
 * Every word must appear somewhere in the row, not the phrase as typed —
 * "declined offer" finds an alert titled "Offer declined". That is what
 * people mean by searching, and it costs one extra split.
 *
 * A conversation is matched on who it is with and what it is about, because
 * that is all a conversation row shows. Its MESSAGES are searched separately
 * and on the server — see searchMessages() below — since the inbox never
 * loaded their text.
 */
export function matchesQuery(item: InboxRowItem, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const haystack = fold(
    item.kind === "conversation"
      ? [item.otherName, item.listingTitle].filter(Boolean).join(" ")
      : item.kind === "alert"
        ? [item.title, item.body].filter(Boolean).join(" ")
        : [item.otherName, item.body].filter(Boolean).join(" ")
  );

  return words.every((word) => haystack.includes(word));
}

type MessageHitRow = {
  id: number;
  conversation_id: number;
  sender_id: string;
  body: string;
  created_at: string;
};

/**
 * Messages whose text matches, from the server.
 *
 * search_my_messages() (0086) is SECURITY INVOKER, so `messages`' own
 * participant-only SELECT policy decides what can match — this cannot reach
 * a message the caller could not already have read one at a time. Hidden
 * messages are excluded there, not here: a moderated message reads as "This
 * message was removed" in the thread, and finding it by its text would undo
 * that.
 *
 * `known` supplies the names. The RPC returns messages, and a message on its
 * own cannot say who it is with; the inbox rows already loaded can, for every
 * thread inside the 50-row cap. Older threads return a null name and the row
 * says "A conversation" rather than inventing one.
 *
 * Never throws. Search failing should leave the list it was narrowing, not
 * replace the screen with an error.
 */
export async function searchMessages(
  query: string,
  userId: string,
  known: InboxConversation[]
): Promise<InboxMessageHit[]> {
  if (query.trim().length < 2) return [];

  const names = new Map(known.map((row) => [row.id, row]));

  try {
    const { data } = await supabase.rpc("search_my_messages", { p_query: query });
    return ((data as MessageHitRow[] | null) ?? []).map((row) => {
      const thread = names.get(row.conversation_id);
      return {
        kind: "message" as const,
        id: row.id,
        at: row.created_at,
        conversationId: row.conversation_id,
        otherName: thread?.otherName ?? null,
        otherAvatarUrl: thread?.otherAvatarUrl ?? null,
        otherAvatarColor: thread?.otherAvatarColor ?? null,
        body: row.body,
        mine: row.sender_id === userId,
      };
    });
  } catch {
    return [];
  }
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

export { alertLook, dayBucket, DAY_BUCKET_LABELS, type AlertLook, type DayBucket } from "./inbox-look";

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
  data: { href?: string; interestId?: number } | null;
  read_at: string | null;
  created_at: string;
};

export type LoadedInbox = { items: InboxItem[]; counts: InboxCounts };

/** The two alerts that carry an answer on the row. */
const ANSWERABLE = new Set(["tee_time_place_offered", "tee_time_interest_received"]);

/** The current state of every request an answerable alert points at — one
 *  read. RLS lets a member see their own requests and those on rounds they
 *  host, which is exactly who gets these alerts. */
async function interestsNow(ids: number[]): Promise<Map<number, InterestNow> | null> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("tee_time_interests")
    .select("id, status, tee_time_invites (status, play_date)")
    .in("id", ids)
    .overrideTypes<InterestNow[]>();
  if (error) return null;
  return new Map((data ?? []).map((r) => [r.id, r]));
}

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

  const alertRows = (alerts.data ?? []).filter((row) => !isDeliveryOnlyAlert(row.type));
  const askIds = [
    ...new Set(
      alertRows
        .filter((r) => ANSWERABLE.has(r.type) && typeof r.data?.interestId === "number")
        .map((r) => r.data!.interestId!)
    ),
  ];
  // Null when the read failed: keep the buttons rather than hide a real ask.
  const now = await interestsNow(askIds).catch(() => null);
  const today = todayInDublin();

  return {
    items: mergeInbox(
      conversations.map((row) => ({
        ...row,
        kind: "conversation" as const,
        at: row.lastMessageAt ?? new Date(0).toISOString(),
      })),
      alertRows.map((row) => {
        const interestId = typeof row.data?.interestId === "number" ? row.data.interestId : null;
        return {
          kind: "alert" as const,
          id: row.id,
          at: row.created_at,
          type: row.type,
          title: row.title,
          body: row.body,
          href: row.data?.href ?? "/dashboard",
          unread: row.read_at === null,
          interestId,
          settled:
            interestId !== null && ANSWERABLE.has(row.type) && now
              ? settledReason(row.type, now.get(interestId), today)
              : null,
        };
      })
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
