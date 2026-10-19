import { supabase } from "@/lib/supabase";
import { asAlertLevel, type ChatAlertLevel, type ChatGroupKind } from "@/lib/group-chat-rules";
import { listMessages, type Message } from "@/lib/messages";

/**
 * Group chats (0181): reads that tie a chat to its Golf Buddies group or
 * trip — the group behind a conversation, the group's events for the chat's
 * cards, the preview on the group's page, and your own alert setting.
 *
 * Everything is read under RLS as the member; nothing here can show a group
 * or an event to someone outside it.
 */

export type ChatGroup = {
  id: number;
  kind: ChatGroupKind;
  name: string;
  memberCount: number;
  startsOn: string | null;
  endsOn: string | null;
  conversationId: number;
};

type GroupRow = {
  id: number;
  kind: ChatGroupKind;
  name: string;
  member_count: number;
  starts_on: string | null;
  ends_on: string | null;
  conversation_id: number;
};

// Never "*": groups.invite_code is withheld by a column grant (0120).
const GROUP_COLUMNS = "id, kind, name, member_count, starts_on, ends_on, conversation_id";

const toGroup = (r: GroupRow): ChatGroup => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  memberCount: r.member_count,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  conversationId: r.conversation_id,
});

/** The group whose chat this is, or null for a chat of its own (a direct
 *  thread, or a group chat someone built by hand). */
export async function groupForConversation(conversationId: number): Promise<ChatGroup | null> {
  const { data } = await supabase
    .from("groups")
    .select(GROUP_COLUMNS)
    .eq("conversation_id", conversationId)
    .is("hidden_at", null)
    .maybeSingle<GroupRow>();
  return data ? toGroup(data) : null;
}

/** The groups behind several chats at once, for the inbox. */
export async function groupsForConversations(conversationIds: number[]): Promise<Map<number, ChatGroup>> {
  const out = new Map<number, ChatGroup>();
  if (conversationIds.length === 0) return out;
  const { data } = await supabase
    .from("groups")
    .select(GROUP_COLUMNS)
    .in("conversation_id", conversationIds)
    .is("hidden_at", null)
    .returns<GroupRow[]>();
  for (const r of data ?? []) out.set(r.conversation_id, toGroup(r));
  return out;
}

/** One of the group's events, as a card in its chat. */
export type GroupEventCard = {
  /** "event-<id>", so it can't clash with a message id in a list. */
  key: string;
  id: number;
  groupId: number;
  title: string;
  /** A day out, or a trip with an itinerary (overnight / abroad). */
  outingKind: "day" | "overnight" | "abroad";
  playsOn: string;
  endsOn: string | null;
  courseName: string | null;
  location: string | null;
  firstTee: string | null;
  entryFeeCents: number | null;
  maxEntries: number | null;
  entryMode: "join" | "request";
  status: "open" | "cancelled";
  created_at: string;
  createdBy: string | null;
  /** Who's in, for the faces on the card. */
  entrants: string[];
  mine: boolean;
};

type EventRow = {
  id: number;
  group_id: number;
  kind: "day" | "overnight" | "abroad" | null;
  title: string;
  plays_on: string;
  ends_on: string | null;
  course_name: string | null;
  location: string | null;
  first_tee: string | null;
  entry_fee_cents: number | null;
  max_entries: number | null;
  entry_mode?: "join" | "request" | null;
  status: "open" | "cancelled";
  created_at: string;
  created_by: string | null;
  entries: { member_id: string }[];
};

const EVENT_COLUMNS =
  "id, group_id, kind, title, plays_on, ends_on, course_name, location, first_tee, entry_fee_cents, max_entries, entry_mode, status, created_at, created_by, entries:society_outing_entries(member_id)";

const toCard = (r: EventRow, userId: string): GroupEventCard => ({
  key: `event-${r.id}`,
  id: r.id,
  groupId: r.group_id,
  title: r.title,
  outingKind: r.kind ?? "day",
  playsOn: r.plays_on,
  endsOn: r.ends_on,
  courseName: r.course_name,
  location: r.location,
  firstTee: r.first_tee,
  entryFeeCents: r.entry_fee_cents,
  maxEntries: r.max_entries,
  entryMode: r.entry_mode ?? "join",
  status: r.status,
  created_at: r.created_at,
  createdBy: r.created_by,
  entrants: r.entries.map((e) => e.member_id),
  mine: r.entries.some((e) => e.member_id === userId),
});

/** The group's most recent events, newest posted first — the chat's cards. */
export async function groupEventCards(groupId: number, userId: string): Promise<GroupEventCard[]> {
  const { data, error } = await supabase
    .from("society_outings")
    .select(EVENT_COLUMNS)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(30)
    .returns<EventRow[]>();
  if (error) return [];
  return (data ?? []).map((r) => toCard(r, userId));
}

/** The next open event in each of these groups (on or after `today`). */
export async function nextEvents(groupIds: number[], today: string, userId: string): Promise<Map<number, GroupEventCard>> {
  const out = new Map<number, GroupEventCard>();
  if (groupIds.length === 0) return out;
  const { data, error } = await supabase
    .from("society_outings")
    .select(EVENT_COLUMNS)
    .in("group_id", groupIds)
    .eq("status", "open")
    .or(`plays_on.gte.${today},ends_on.gte.${today}`)
    .order("plays_on")
    .limit(60)
    .returns<EventRow[]>();
  if (error) return out;
  for (const r of data ?? []) if (!out.has(r.group_id)) out.set(r.group_id, toCard(r, userId));
  return out;
}

/** Your own alert setting for a chat. "Everything" until 0181 is applied. */
export async function myChatAlerts(conversationId: number, userId: string): Promise<ChatAlertLevel> {
  const { data, error } = await supabase
    .from("conversation_members")
    .select("alerts")
    .eq("conversation_id", conversationId)
    .eq("member_id", userId)
    .maybeSingle<{ alerts: string | null }>();
  if (error) return "all";
  return asAlertLevel(data?.alerts);
}

/** Alert levels for several chats at once — the inbox's muted icons. */
export async function myAlertsFor(conversationIds: number[], userId: string): Promise<Map<number, ChatAlertLevel>> {
  const out = new Map<number, ChatAlertLevel>();
  if (conversationIds.length === 0) return out;
  const { data, error } = await supabase
    .from("conversation_members")
    .select("conversation_id, alerts")
    .in("conversation_id", conversationIds)
    .eq("member_id", userId)
    .returns<{ conversation_id: number; alerts: string | null }[]>();
  if (error) return out;
  for (const r of data ?? []) out.set(r.conversation_id, asAlertLevel(r.alerts));
  return out;
}

/** Changes your own row only — RLS and 0087's trigger see to that. */
export async function setMyChatAlerts(conversationId: number, userId: string, level: ChatAlertLevel): Promise<void> {
  const { error } = await supabase
    .from("conversation_members")
    .update({ alerts: level })
    .eq("conversation_id", conversationId)
    .eq("member_id", userId);
  if (error) {
    throw new Error(/alerts/.test(error.message) ? "Chat alerts aren't ready yet — please update the app and try again." : "Couldn't change your alerts.");
  }
}

/** What's been shared in a chat: photos, for the settings screen. */
export async function photoCount(conversationId: number): Promise<number> {
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .not("image_path", "is", null)
    .is("hidden_at", null)
    .is("deleted_at", null);
  return count ?? 0;
}

/** The chat card on a group's page: the latest two messages and your unread count. */
export type ChatPreview = {
  latest: (Message & { senderFirstName: string })[];
  unread: number;
};

export async function chatPreview(conversationId: number): Promise<ChatPreview> {
  const [page, unread, names] = await Promise.all([
    listMessages(conversationId),
    supabase.rpc("conversation_unread_counts"),
    supabase
      .from("conversation_members")
      .select("member_id, profile:profiles(first_name)")
      .eq("conversation_id", conversationId)
      .returns<{ member_id: string; profile: { first_name: string | null } | null }[]>(),
  ]);
  const first = new Map((names.data ?? []).map((r) => [r.member_id, r.profile?.first_name ?? "Someone"] as const));
  const visible = page.messages.filter((m) => !m.hidden_at && !m.deleted_at).slice(0, 2);
  const counts = (unread.data as { conversation_id: number; unread_count: number }[] | null) ?? [];
  return {
    latest: visible.map((m) => ({ ...m, senderFirstName: first.get(m.sender_id) ?? "Someone" })).reverse(),
    unread: Number(counts.find((c) => c.conversation_id === conversationId)?.unread_count ?? 0),
  };
}

/** Your role and office in the group behind a chat — who may plan events. */
export async function myPlaceIn(groupId: number, userId: string): Promise<{ role: "owner" | "admin" | "member"; office: string | null } | null> {
  const { data } = await supabase
    .from("group_members")
    .select("role, office")
    .eq("group_id", groupId)
    .eq("member_id", userId)
    .maybeSingle<{ role: "owner" | "admin" | "member"; office: string | null }>();
  return data ?? null;
}

/** The soonest open event that hasn't finished — the chat's pinned strip. */
export function nextUp(cards: GroupEventCard[], today: string): GroupEventCard | null {
  return (
    cards
      .filter((c) => c.status === "open" && (c.playsOn >= today || (c.endsOn ?? "") >= today))
      .sort((a, b) => a.playsOn.localeCompare(b.playsOn))[0] ?? null
  );
}
