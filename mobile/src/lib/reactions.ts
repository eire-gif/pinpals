/**
 * Golf reactions — the one definition (Oct 2026 feed redesign, phase 4).
 *
 * KEPT IDENTICAL in two places, like post-details.ts:
 *
 *   src/lib/reactions.ts          (website)
 *   mobile/src/lib/reactions.ts   (app)
 *
 * src/lib/reactions.test.ts fails if they differ. No imports.
 *
 * A reaction IS a like with a flavour. They live in post_likes (0088), which
 * gained a `reaction` column in 0096_post_reactions.sql; every like recorded
 * before that reads as the default, Great Shot. So posts.like_count is still
 * "how many reacted", an app that only knows likes still works, and a
 * notification for a like is a notification for a reaction.
 *
 * ARTWORK. Each reaction is an Ionicons glyph (MIT) on a disc of PinPals
 * colour — no emoji, nobody else's drawings. Icon names are plain strings
 * so this file needs no icon package; the app casts them.
 */

export const REACTIONS = ["great_shot", "on_fire", "nice_round", "amazing", "unlucky"] as const;
export type ReactionKey = (typeof REACTIONS)[number];

/** What a single tap gives, and what every pre-0096 like counts as. */
export const DEFAULT_REACTION: ReactionKey = "great_shot";

export type ReactionInfo = {
  label: string;
  icon: string;
  /** The disc. Each clears 3:1 against the white icon on it. */
  color: string;
};

export const REACTION_INFO: Record<ReactionKey, ReactionInfo> = {
  great_shot: { label: "Great Shot", icon: "golf", color: "#1f5c2e" },
  on_fire: { label: "On Fire", icon: "flame", color: "#c2410c" },
  nice_round: { label: "Nice Round", icon: "flag", color: "#123058" },
  amazing: { label: "Amazing", icon: "trophy", color: "#a8781a" },
  unlucky: { label: "Unlucky", icon: "rainy", color: "#647082" },
};

export function isReaction(value: unknown): value is ReactionKey {
  return typeof value === "string" && (REACTIONS as readonly string[]).includes(value);
}

/** Counts per reaction, as kept on posts.reaction_counts. Missing = 0. */
export type ReactionCounts = Partial<Record<ReactionKey, number>>;

/** A count read from the database, with anything unknown or negative
 *  dropped, and pre-0096 posts (no breakdown) credited to the default. */
export function normaliseCounts(raw: unknown, total: number): ReactionCounts {
  const out: ReactionCounts = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isReaction(k) && typeof v === "number" && v > 0) out[k] = Math.floor(v);
    }
  }
  const counted = Object.values(out).reduce((a, b) => a + (b ?? 0), 0);
  if (counted === 0 && total > 0) out[DEFAULT_REACTION] = total;
  return out;
}

/** The reactions to show beside the total: most-used first, ties in the
 *  order above, at most `max`. */
export function topReactions(counts: ReactionCounts, max = 3): ReactionKey[] {
  return REACTIONS.filter((r) => (counts[r] ?? 0) > 0)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || REACTIONS.indexOf(a) - REACTIONS.indexOf(b))
    .slice(0, max);
}

/**
 * The counts after the viewer moves from `from` to `to` (either may be
 * null — no reaction). What the app shows before the server answers; the
 * server's numbers replace it when they arrive.
 */
export function applyReaction(
  counts: ReactionCounts,
  total: number,
  from: ReactionKey | null,
  to: ReactionKey | null
): { counts: ReactionCounts; total: number } {
  if (from === to) return { counts, total };
  const next: ReactionCounts = { ...counts };
  if (from) {
    const left = Math.max(0, (next[from] ?? 0) - 1);
    if (left > 0) next[from] = left;
    else delete next[from];
  }
  if (to) next[to] = (next[to] ?? 0) + 1;
  const delta = (to ? 1 : 0) - (from ? 1 : 0);
  return { counts: next, total: Math.max(0, total + delta) };
}
