/**
 * The feed's rules, for the app — no React, no supabase, no expo-router, so
 * it runs in the website's vitest (feed-rules.test.ts).
 *
 * Mirrors src/lib/feed.ts on the website. The app cannot import from the
 * site (two packages, two toolchains), so the handful of constants are
 * repeated here and the database (0088) is what actually enforces them;
 * these exist so a member is told what is wrong before a check constraint
 * is.
 */

export const POST_VISIBILITIES = ["members", "connections"] as const;
export type PostVisibility = (typeof POST_VISIBILITIES)[number];

export const POST_VISIBILITY_LABELS: Record<PostVisibility, string> = {
  members: "All PinPals members",
  connections: "My connections only",
};

export const POST_VISIBILITY_SHORT: Record<PostVisibility, string> = {
  members: "Everyone",
  connections: "Connections",
};

export const FEED_SCOPES = ["all", "connections"] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];

export const FEED_SCOPE_LABELS: Record<FeedScope, string> = {
  all: "All PinPals",
  connections: "My connections",
};

export const MAX_POST_PHOTOS = 6;
export const MAX_POST_BODY = 2000;
export const MAX_COMMENT_BODY = 1000;
/** Smaller than the website's page: a phone scrolls, and the first screen
 *  should arrive fast on one bar of signal. */
export const FEED_PAGE_SIZE = 15;
export const FEED_LISTINGS_PER_PAGE = 3;

/** Null when the draft is fine; otherwise a sentence a member can act on. */
export function draftProblem(body: string, photoCount: number): string | null {
  if (body.trim().length === 0 && photoCount === 0) return "Add a photo or write something to post.";
  if (body.length > MAX_POST_BODY) return `Please keep your post under ${MAX_POST_BODY} characters.`;
  if (photoCount > MAX_POST_PHOTOS) return `You can add up to ${MAX_POST_PHOTOS} photos to a post.`;
  return null;
}

/**
 * Interleaves posts with the marketplace listings from the same stretch of
 * time. Identical rule to the website's interleaveFeed(): on a full page,
 * listings older than the oldest post wait for the next page, so none is
 * shown twice and none is pulled in from months back.
 */
export function interleave<P extends { createdAt: string }, L extends { createdAt: string }>(
  posts: P[],
  listings: L[],
  pageIsFull: boolean
): ({ kind: "post"; item: P } | { kind: "listing"; item: L })[] {
  const floor = pageIsFull && posts.length > 0 ? posts[posts.length - 1].createdAt : null;
  const inWindow = floor === null ? listings : listings.filter((l) => l.createdAt >= floor);
  const merged: ({ kind: "post"; item: P } | { kind: "listing"; item: L })[] = [
    ...posts.map((item) => ({ kind: "post" as const, item })),
    ...inWindow.map((item) => ({ kind: "listing" as const, item })),
  ];
  merged.sort((a, b) => (a.item.createdAt < b.item.createdAt ? 1 : a.item.createdAt > b.item.createdAt ? -1 : 0));
  return merged;
}

export function likeLine(count: number, likedByMe: boolean): string | null {
  if (count <= 0) return null;
  if (likedByMe) return count === 1 ? "You liked this" : `You and ${count - 1} ${count - 1 === 1 ? "other" : "others"}`;
  return `${count} ${count === 1 ? "like" : "likes"}`;
}

export function commentLine(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? "comment" : "comments"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "just now", "5m", "3h", "2d", then "14 Sep" (and the year if not this
 *  one). Written out rather than toLocaleDateString(): Hermes ships
 *  without full Intl data on some builds, and a date that renders as
 *  "9/14/2026" on one phone and "14 Sep" on another is a bug report. */
export function ago(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const date = `${then.getDate()} ${MONTHS[then.getMonth()]}`;
  return then.getFullYear() === now.getFullYear() ? date : `${date} ${then.getFullYear()}`;
}

/** "HCP 12.4"; "HCP +1.2" for a plus handicap, which profiles store as a
 *  negative index (profile-update.ts allows -10 to 54); whole numbers
 *  without the ".0". Shown on a post only when the member shares it. */
export function handicapLabel(handicap: number): string {
  const index = Math.abs(handicap);
  const figure = Number.isInteger(index) ? index.toFixed(0) : index.toFixed(1);
  return handicap < 0 ? `HCP +${figure}` : `HCP ${figure}`;
}

/**
 * The golf facts a post can carry: one hole (a shot, an ace, a birdie) or a
 * whole round. Every field optional — a "Share a hole" post may know the
 * hole and the club but not the yardage.
 */
export type PostGolfDetails = {
  hole?: number | null;
  par?: number | null;
  yards?: number | null;
  club?: string | null;
  /** "Ace", "Eagle", "Birdie"… or a score on the hole as written. */
  result?: string | null;
  /** Gross round score, and its relation to par. */
  roundScore?: number | null;
  toPar?: number | null;
};

/** The chips under a post's media, in reading order: "Hole 7", "Par 3",
 *  "162 yds", "7 Iron", "Ace", "78 (+6)". Empty when there is nothing. */
export function golfChips(golf: PostGolfDetails | null | undefined): string[] {
  if (!golf) return [];
  const chips: string[] = [];
  if (golf.hole) chips.push(`Hole ${golf.hole}`);
  if (golf.par) chips.push(`Par ${golf.par}`);
  if (golf.yards) chips.push(`${golf.yards} yds`);
  if (golf.club?.trim()) chips.push(golf.club.trim());
  if (golf.result?.trim()) chips.push(golf.result.trim());
  if (golf.roundScore) {
    const rel =
      golf.toPar === null || golf.toPar === undefined ? "" : golf.toPar === 0 ? " (E)" : ` (${golf.toPar > 0 ? "+" : ""}${golf.toPar})`;
    chips.push(`${golf.roundScore}${rel}`);
  }
  return chips;
}

/** Comments for a feed card's preview: the latest `max`, oldest first, flat.
 *  The feed never shows a thread — replies show as plain rows here, and the
 *  full thread lives on the post screen. Hidden comments (visible only to
 *  their author) count like any other. */
export function previewComments<T extends { id: number; createdAt: string }>(comments: T[], max = 2): T[] {
  const byTime = [...comments].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id - b.id : a.createdAt < b.createdAt ? -1 : 1
  );
  return byTime.slice(-max);
}

/** Height for media shown at `width`, kept between 4:5 portrait and 16:9
 *  landscape so one tall photo cannot fill the whole screen. 4:5 is the feed
 *  preview's limit; the full photo opens when tapped. */
export function photoHeight(width: number, photo: { width: number | null; height: number | null }): number {
  const ratio = photo.width && photo.height ? photo.width / photo.height : 4 / 3;
  const clamped = Math.min(Math.max(ratio, 0.8), 16 / 9);
  return Math.round(width / clamped);
}

/**
 * Comments in thread order: each top-level comment, oldest first, followed
 * by its replies, oldest first (0092 — one level of replies). Kept identical to threadComments() in src/lib/feed.ts on the site.
 *
 * A reply whose parent is not in the list — not loaded in a preview, or
 * invisible to this viewer because of a block — is shown as a top-level
 * comment at its own time rather than dropped. `depth` is what a screen
 * indents by.
 */
export function threadComments<T extends { id: number; parentId: number | null; createdAt: string }>(
  comments: T[]
): (T & { depth: 0 | 1 })[] {
  const byTime = [...comments].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id - b.id : a.createdAt < b.createdAt ? -1 : 1
  );
  const present = new Set(byTime.map((c) => c.id));
  const replies = new Map<number, T[]>();
  const roots: T[] = [];
  for (const c of byTime) {
    if (c.parentId !== null && present.has(c.parentId)) {
      const list = replies.get(c.parentId) ?? [];
      list.push(c);
      replies.set(c.parentId, list);
    } else {
      roots.push(c);
    }
  }
  const out: (T & { depth: 0 | 1 })[] = [];
  for (const root of roots) {
    out.push({ ...root, depth: 0 });
    for (const reply of replies.get(root.id) ?? []) out.push({ ...reply, depth: 1 });
  }
  return out;
}
