// The feed's vocabulary and rules, with no Supabase and no Next.js in them —
// shared by the Server Actions, the /api/app/posts routes and the pages, and
// unit-tested in feed.test.ts. The mobile app mirrors the constants in
// mobile/src/lib/feed.ts; the database (0088) is what actually enforces the
// limits, and these exist so a member is told what is wrong before a check
// constraint is.

export const POST_VISIBILITIES = ["members", "connections"] as const;
export type PostVisibility = (typeof POST_VISIBILITIES)[number];

export const POST_VISIBILITY_LABELS: Record<PostVisibility, string> = {
  members: "All PinPals members",
  connections: "My connections only",
};

/** Short labels for a chip on a post card. */
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

/** Matches post_images.position's check (0 to 5). */
export const MAX_POST_PHOTOS = 6;
export const MAX_POST_BODY = 2000;
export const MAX_COMMENT_BODY = 1000;
export const FEED_PAGE_SIZE = 20;
/** Marketplace listings mixed into one page of the "All PinPals" feed. Few,
 *  on purpose: the feed is about golf with people, and a page that was half
 *  adverts would read as a classifieds site with some photos in it. */
export const FEED_LISTINGS_PER_PAGE = 3;

export function parseFeedScope(raw: string | null | undefined): FeedScope {
  return raw === "connections" ? "connections" : "all";
}

export function parseVisibility(raw: unknown): PostVisibility | null {
  return typeof raw === "string" && (POST_VISIBILITIES as readonly string[]).includes(raw)
    ? (raw as PostVisibility)
    : null;
}

export type PostDraft = {
  body: string;
  visibility: PostVisibility;
  clubId: number | null;
  photoCount: number;
  /** A round, hole or shot post (0095) carries golf details, which are
   *  enough on their own — a score with no caption is a post. */
  hasDetails?: boolean;
};

/** Null when the draft is fine; otherwise a sentence a member can act on. */
export function validatePostDraft(draft: PostDraft): string | null {
  const body = draft.body.trim();
  if (body.length === 0 && draft.photoCount === 0 && !draft.hasDetails) {
    return "Add a photo or write something to post.";
  }
  if (draft.body.length > MAX_POST_BODY) {
    return `Please keep your post under ${MAX_POST_BODY.toLocaleString("en-IE")} characters.`;
  }
  if (draft.photoCount > MAX_POST_PHOTOS) {
    return `You can add up to ${MAX_POST_PHOTOS} photos to a post.`;
  }
  if (draft.clubId !== null && (!Number.isInteger(draft.clubId) || draft.clubId <= 0)) {
    return "That course couldn't be found — try choosing it again.";
  }
  return null;
}

export function validateComment(body: string): string | null {
  if (body.trim().length === 0) return "Write something first.";
  if (body.length > MAX_COMMENT_BODY) {
    return `Please keep comments under ${MAX_COMMENT_BODY.toLocaleString("en-IE")} characters.`;
  }
  return null;
}

/**
 * Interleaves a page of posts with the marketplace listings created in the
 * same stretch of time, newest first.
 *
 * Listings are only allowed in if they are no older than the oldest post on
 * a FULL page. Without that bound a quiet week of posts would let a page
 * pull in listings from months back, and the next page — starting from the
 * last post — would show them again. When the page is not full, it is the
 * last page, and every remaining listing in the window belongs on it.
 */
export function interleaveFeed<P extends { createdAt: string }, L extends { createdAt: string }>(
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
  // ISO-8601 timestamps from Postgres sort correctly as strings, and the
  // sort is stable, so equal timestamps keep posts ahead of listings.
  merged.sort((a, b) => (a.item.createdAt < b.item.createdAt ? 1 : a.item.createdAt > b.item.createdAt ? -1 : 0));
  return merged;
}

/** "Liked by Aoife and 3 others", or null for nobody. */
export function likeSummary(count: number, firstName: string | null, likedByMe: boolean): string | null {
  if (count <= 0) return null;
  if (likedByMe) {
    if (count === 1) return "You liked this";
    return `You and ${count - 1} ${count - 1 === 1 ? "other" : "others"}`;
  }
  if (firstName) {
    if (count === 1) return `Liked by ${firstName}`;
    return `Liked by ${firstName} and ${count - 1} ${count - 1 === 1 ? "other" : "others"}`;
  }
  return `${count} ${count === 1 ? "like" : "likes"}`;
}

/** "just now", "5m", "3h", "2d", then a date. Short because it sits beside
 *  a name on a card, as on every feed people already use. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return then.toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * Comments in thread order: each top-level comment, oldest first, followed
 * by its replies, oldest first (0092 — one level of replies).
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
