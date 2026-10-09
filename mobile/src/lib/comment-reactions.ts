/**
 * Emoji on comments (0111) — long-press a comment to react.
 *
 * A reaction is a comment like with an emoji (post_comment_likes.emoji), one
 * per member per comment; a like from before 0111, or a tap on "Like", is a
 * heart. The database allows exactly this list (post_comment_likes_emoji_ok),
 * so keep the two in step. Pure, so it's tested.
 */

export const COMMENT_EMOJI = ["❤️", "👍", "😂", "😮", "👏", "🔥", "⛳"] as const;
export type CommentEmoji = (typeof COMMENT_EMOJI)[number];

/** What a plain "Like" is, and what every like before emoji reads as. */
export const HEART: CommentEmoji = "❤️";

export function isCommentEmoji(value: unknown): value is CommentEmoji {
  return typeof value === "string" && (COMMENT_EMOJI as readonly string[]).includes(value);
}

export type EmojiCounts = Partial<Record<CommentEmoji, number>>;

/** post_comments.emoji_counts as read, unknown keys dropped; a database
 *  without 0111 (no counts) credits every like to the heart. */
export function normaliseEmojiCounts(raw: unknown, likeCount: number): EmojiCounts {
  const out: EmojiCounts = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isCommentEmoji(k) && typeof v === "number" && v > 0) out[k] = Math.floor(v);
    }
  }
  if (Object.keys(out).length === 0 && likeCount > 0) out[HEART] = likeCount;
  return out;
}

/** The counts after a member's reaction changes from `from` to `to` (either null). */
export function applyCommentReaction(counts: EmojiCounts, from: CommentEmoji | null, to: CommentEmoji | null): EmojiCounts {
  const out: EmojiCounts = { ...counts };
  if (from) {
    const n = (out[from] ?? 0) - 1;
    if (n > 0) out[from] = n;
    else delete out[from];
  }
  if (to) out[to] = (out[to] ?? 0) + 1;
  return out;
}

/** The most-used emoji first (ties in list order), at most `max`. */
export function topEmoji(counts: EmojiCounts, max = 3): CommentEmoji[] {
  return COMMENT_EMOJI.filter((e) => (counts[e] ?? 0) > 0)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || COMMENT_EMOJI.indexOf(a) - COMMENT_EMOJI.indexOf(b))
    .slice(0, max);
}
