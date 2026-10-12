/**
 * The small decisions behind the chat screen (Oct 2026 redesign), kept out of
 * the component so they can be tested: which colour a name is, who has seen
 * a message, how reactions add up, and how a typed quote reads.
 */
import type { Message, MessageQuote, Reaction, ThreadMember } from "./messages";

/** The six quick reactions on a long-press, golf's own in the middle. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "⛳", "🔥", "👏"] as const;

/** Sender names in a group, one colour each — deep enough to read on white
 *  at 13.5pt (all ≥ 4.5:1). Picked by a stable hash of the member's id, so a
 *  person keeps their colour across threads and launches. */
export const SENDER_COLOURS = [
  "#1f5c2e", // green
  "#1d4f8a", // blue
  "#8a3b12", // rust
  "#6b2f8a", // plum
  "#0f6b6b", // teal
  "#8a5a00", // amber
  "#a02c4a", // raspberry
  "#3d4f1a", // olive
] as const;

export function senderColour(memberId: string): string {
  let h = 0;
  for (let i = 0; i < memberId.length; i++) h = (h * 31 + memberId.charCodeAt(i)) >>> 0;
  return SENDER_COLOURS[h % SENDER_COLOURS.length];
}

/** Everyone but the sender, and whether each has read this message. */
export function readBy(
  message: Pick<Message, "sender_id" | "created_at">,
  members: Pick<ThreadMember, "id" | "name" | "lastReadAt">[]
): { id: string; name: string; seenAt: string | null }[] {
  const sent = Date.parse(message.created_at);
  return members
    .filter((m) => m.id !== message.sender_id)
    .map((m) => ({
      id: m.id,
      name: m.name,
      seenAt: m.lastReadAt && Date.parse(m.lastReadAt) >= sent ? m.lastReadAt : null,
    }));
}

/** ✓ sent, ✓✓ (green) once everyone else has read it. */
export function tickState(
  message: Pick<Message, "sender_id" | "created_at">,
  members: Pick<ThreadMember, "id" | "name" | "lastReadAt">[]
): "sent" | "seen" {
  const others = readBy(message, members);
  return others.length > 0 && others.every((o) => o.seenAt) ? "seen" : "sent";
}

/** Reactions on one message as chips: each emoji once, with its count and
 *  whether one of them is mine. Most-used first, ties by first use. */
export function reactionChips(
  reactions: Reaction[],
  me: string | null
): { emoji: string; count: number; mine: boolean }[] {
  const out: { emoji: string; count: number; mine: boolean }[] = [];
  for (const r of reactions) {
    const chip = out.find((c) => c.emoji === r.emoji);
    if (chip) {
      chip.count += 1;
      chip.mine ||= r.memberId === me;
    } else {
      out.push({ emoji: r.emoji, count: 1, mine: r.memberId === me });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Group a flat list by message id. */
export function reactionsByMessage(reactions: Reaction[]): Map<number, Reaction[]> {
  const out = new Map<number, Reaction[]>();
  for (const r of reactions) {
    const list = out.get(r.messageId);
    if (list) list.push(r);
    else out.set(r.messageId, [r]);
  }
  return out;
}

/** Who and what, for a quote block. `nameOf` resolves a member id. */
export function quoteLines(
  quote: MessageQuote,
  me: string | null,
  nameOf: (id: string) => string | null
): { who: string; text: string } {
  if (quote.deleted) return { who: "Quoted message", text: "This message was deleted" };
  if (quote.removed) return { who: "Quoted message", text: "This message was removed" };
  const who =
    quote.sender_id && quote.sender_id === me
      ? "You"
      : (quote.sender_id ? nameOf(quote.sender_id) : null) ?? "A member";
  const text = quote.body?.trim() || (quote.photo ? "📷 Photo" : "");
  return { who: quote.group ? `${who} · ${quote.group}` : who, text };
}

/** The quote for a reply still being written (before the database has made
 *  the real one) — the same shape, built from the message being answered. */
export function draftQuote(message: Message, group: string | null = null): MessageQuote {
  return {
    sender_id: message.sender_id,
    body: message.body.slice(0, 280),
    photo: Boolean(message.image_path),
    group,
  };
}

/** Whether "Delete for everyone" is still on offer: mine, live, and under
 *  48 hours old — the same rule delete_message_for_everyone() enforces. */
export function canDeleteForEveryone(message: Message, me: string | null, now = Date.now()): boolean {
  return (
    message.sender_id === me &&
    !message.deleted_at &&
    !message.hidden_at &&
    now - Date.parse(message.created_at) < 48 * 3600 * 1000
  );
}

/** "Seán is typing…", "Seán and Aoife are typing…", "3 people are typing…". */
export function typingLine(names: string[]): string | null {
  const first = names.map((n) => n.split(" ")[0] || n);
  if (first.length === 0) return null;
  if (first.length === 1) return `${first[0]} is typing…`;
  if (first.length === 2) return `${first[0]} and ${first[1]} are typing…`;
  return `${first.length} people are typing…`;
}
