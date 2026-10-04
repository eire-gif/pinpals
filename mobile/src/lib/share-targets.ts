import { SITE_URL } from "./config";
import type { ShareTarget } from "./feed";
import { conversationWith } from "./members";
import { listInbox, sendMessage } from "./messages";
import { postWebUrl } from "./share-links";
import { supabase } from "./supabase";

/**
 * Sharing a post inside PinPals (phase 6) — by message, through the
 * messaging that already exists rather than a second system. The message is
 * the post's members-only address (/feed/<id>), and the conversation screen
 * draws any such link as a post card (SharedPostCard). The recipient sees
 * the post only if they're allowed to: same RLS as the feed.
 */

/** Recent conversations first (groups included), then connections. */
export async function loadShareTargets(viewerId: string): Promise<ShareTarget[]> {
  const [inbox, connectionIds] = await Promise.all([
    listInbox(viewerId).catch(() => []),
    connectionsOf(viewerId).catch(() => [] as string[]),
  ]);
  const conversations: ShareTarget[] = inbox.slice(0, 12).map((row) => ({
    kind: "conversation",
    conversationId: row.id,
    name: row.otherName,
    avatarUrl: row.otherAvatarUrl,
    avatarColor: row.otherAvatarColor,
    group: row.conversationKind === "group",
  }));

  let members: ShareTarget[] = [];
  if (connectionIds.length) {
    const { data } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, avatar_url, avatar_color")
      .in("id", connectionIds.slice(0, 300))
      .order("first_name")
      .overrideTypes<{ id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null }[]>();
    // A direct conversation already listed is the same person; don't offer
    // them twice. Names are what a direct inbox row knows them by.
    const listed = new Set(conversations.filter((c) => c.kind === "conversation" && !c.group).map((c) => c.name));
    members = (data ?? [])
      .map((p) => ({
        kind: "member" as const,
        memberId: p.id,
        name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "A member",
        avatarUrl: p.avatar_url,
        avatarColor: p.avatar_color,
      }))
      .filter((m) => !listed.has(m.name));
  }
  return [...conversations, ...members];
}

async function connectionsOf(userId: string): Promise<string[]> {
  const [a, b] = await Promise.all([
    supabase.from("connections").select("recipient_id").eq("requester_id", userId).eq("status", "accepted"),
    supabase.from("connections").select("requester_id").eq("recipient_id", userId).eq("status", "accepted"),
  ]);
  return [
    ...((a.data ?? []) as { recipient_id: string }[]).map((r) => r.recipient_id),
    ...((b.data ?? []) as { requester_id: string }[]).map((r) => r.requester_id),
  ];
}

/** Sends the post, with an optional note, to one target. Opens a direct
 *  conversation with a connection first if there isn't one. */
export async function sendPostTo(target: ShareTarget, postId: number, note: string): Promise<void> {
  const conversationId = target.kind === "conversation" ? target.conversationId : await conversationWith(target.memberId);
  const link = postWebUrl(SITE_URL, postId);
  const body = note.trim() ? `${note.trim()}\n${link}` : link;
  await sendMessage(conversationId, body);
}
