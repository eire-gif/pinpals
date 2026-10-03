import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FEED_LISTINGS_PER_PAGE,
  FEED_PAGE_SIZE,
  interleaveFeed,
  threadComments,
  type FeedScope,
  type PostVisibility,
} from "@/lib/feed";
import {
  EMPTY_MARKETPLACE_FILTERS,
  fetchMarketplaceListings,
  type MarketplaceListing,
} from "@/lib/marketplace-discovery";

/**
 * Reading the feed, for the website's Server Components.
 *
 * Every query here runs on the MEMBER's own client. 0088's policies decide
 * which posts, photos, likes and comments come back, so nothing in this file
 * re-decides visibility — a connections-only post from a stranger is simply
 * not in the result, exactly as it is not in the app's result. The only
 * filtering done here is the member's own choice of scope.
 *
 * Photos are signed here, in one batched call per page, with the member's
 * client — the storage policy (also can_view_post()) is what lets the
 * signature be issued at all.
 */

/** An hour. Long enough that a member reading slowly never sees a photo
 *  break; short enough that a URL copied out of the page stops working the
 *  same afternoon, which matters for connections-only posts. */
const PHOTO_URL_TTL_SECONDS = 60 * 60;

/** Comments shown under a post in the feed before "View all N comments". */
const PREVIEW_COMMENTS = 2;

export type FeedAuthor = {
  id: string;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  homeClub: string | null;
};

export type FeedPhoto = {
  path: string;
  url: string | null;
  width: number | null;
  height: number | null;
};

export type FeedComment = {
  id: number;
  postId: number;
  author: FeedAuthor;
  body: string;
  createdAt: string;
  /** Hidden by a moderator — only ever true for the viewer's own comment,
   *  since nobody else is sent hidden ones. */
  hidden: boolean;
  canDelete: boolean;
  /** Written by the viewer. Not the same as canDelete: a post's author can
   *  delete anyone's comment on it, but can only block someone else. */
  isMine: boolean;
  /** The top-level comment this one replies to (0092), or null. */
  parentId: number | null;
  /** 1 when shown indented under its parent; set by threadComments(). */
  depth: 0 | 1;
};

export type FeedPost = {
  id: number;
  author: FeedAuthor;
  body: string;
  visibility: PostVisibility;
  club: { id: number; name: string } | null;
  photos: FeedPhoto[];
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  isMine: boolean;
  /** Only ever true for the viewer's own post — see 0088. */
  hidden: boolean;
  createdAt: string;
  comments: FeedComment[];
};

export type FeedListing = MarketplaceListing & { createdAt: string };

export type FeedEntry =
  | { kind: "post"; item: FeedPost }
  | { kind: "listing"; item: FeedListing };

export type FeedPage = {
  entries: FeedEntry[];
  /** Pass back as `before` for the next page; null on the last page. */
  nextCursor: string | null;
  /** True when scope is "connections" and the viewer has none — the page
   *  says so rather than showing an empty feed that looks broken. */
  noConnections: boolean;
};

type ProfileEmbed = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  avatar_color: string | null;
  home_club: string | null;
};

type PostRow = {
  id: number;
  author_id: string;
  body: string;
  visibility: PostVisibility;
  like_count: number;
  comment_count: number;
  hidden_at: string | null;
  created_at: string;
  author: ProfileEmbed | null;
  club: { id: number; name: string } | null;
  post_images: { path: string; position: number; width: number | null; height: number | null }[];
};

type CommentRow = {
  id: number;
  post_id: number;
  author_id: string;
  body: string;
  hidden_at: string | null;
  created_at: string;
  parent_id: number | null;
  author: ProfileEmbed | null;
};

// Two foreign keys from posts to profiles now (author_id and hidden_by), so
// the embed has to name which one — PostgREST refuses an ambiguous embed
// rather than guessing.
const POST_SELECT = `
  id, author_id, body, visibility, like_count, comment_count, hidden_at, created_at,
  author:profiles!posts_author_id_fkey ( id, first_name, last_name, avatar_url, avatar_color, home_club ),
  club:clubs ( id, name ),
  post_images ( path, position, width, height )
`;

const COMMENT_SELECT = `
  id, post_id, author_id, body, hidden_at, created_at, parent_id,
  author:profiles!post_comments_author_id_fkey ( id, first_name, last_name, avatar_url, avatar_color, home_club )
`;

function toAuthor(row: ProfileEmbed | null, fallbackId: string): FeedAuthor {
  if (!row) {
    return { id: fallbackId, name: "A member", avatarUrl: null, avatarColor: null, homeClub: null };
  }
  return {
    id: row.id,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "A member",
    avatarUrl: row.avatar_url,
    avatarColor: row.avatar_color,
    homeClub: row.home_club,
  };
}

/** Ids of everyone the viewer is connected to (accepted only). */
export async function connectedMemberIds(supabase: SupabaseClient, userId: string): Promise<string[]> {
  // Two queries rather than an .or() filter. Harmless on a read, but this
  // codebase's rule is that or-filters are not used to decide who is
  // related to whom (see purgePersonalRows() for why).
  const [asRequester, asRecipient] = await Promise.all([
    supabase
      .from("connections")
      .select("recipient_id")
      .eq("requester_id", userId)
      .eq("status", "accepted")
      .returns<{ recipient_id: string }[]>(),
    supabase
      .from("connections")
      .select("requester_id")
      .eq("recipient_id", userId)
      .eq("status", "accepted")
      .returns<{ requester_id: string }[]>(),
  ]);
  return [
    ...(asRequester.data ?? []).map((r) => r.recipient_id),
    ...(asRecipient.data ?? []).map((r) => r.requester_id),
  ];
}

async function signPhotos(supabase: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  try {
    const { data } = await supabase.storage.from("post-images").createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
    const urls = new Map<string, string>();
    for (const row of data ?? []) {
      if (row.signedUrl && row.path) urls.set(row.path, row.signedUrl);
    }
    return urls;
  } catch {
    // A post whose photo cannot be signed still has a caption, likes and
    // comments worth showing. The card draws an empty frame instead.
    return new Map();
  }
}

/**
 * Turns post rows into FeedPosts: one batched lookup each for the viewer's
 * likes, the preview comments and the photo signatures, whatever the page
 * size. Never a query per post.
 */
async function hydratePosts(
  supabase: SupabaseClient,
  viewerId: string,
  rows: PostRow[],
  commentsPerPost: number
): Promise<FeedPost[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [likes, comments, urls] = await Promise.all([
    supabase
      .from("post_likes")
      .select("post_id")
      .eq("user_id", viewerId)
      .in("post_id", ids)
      .returns<{ post_id: number }[]>(),
    commentsPerPost > 0
      ? supabase
          .from("post_comments")
          .select(COMMENT_SELECT)
          .in("post_id", ids)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          // Generous: enough for the latest two on each of a full page even
          // if a few posts are busy. A post past this simply shows fewer
          // previews and its "View all" link, never a wrong one.
          .limit(Math.min(ids.length * commentsPerPost * 4, 200))
          .returns<CommentRow[]>()
      : Promise.resolve({ data: [] as CommentRow[] }),
    signPhotos(
      supabase,
      rows.flatMap((r) => r.post_images.map((img) => img.path))
    ),
  ]);

  const liked = new Set((likes.data ?? []).map((l) => l.post_id));
  const authorOf = new Map(rows.map((r) => [r.id, r.author_id]));

  const commentsByPost = new Map<number, FeedComment[]>();
  for (const row of comments.data ?? []) {
    const list = commentsByPost.get(row.post_id) ?? [];
    if (list.length >= commentsPerPost) continue;
    list.push(toComment(row, viewerId, authorOf.get(row.post_id) ?? null));
    commentsByPost.set(row.post_id, list);
  }

  // A preview reply makes no sense without what it answers, so fetch any
  // parent the latest-N cut left out (0092). Visibility is still RLS's call:
  // a parent the viewer may not see simply doesn't come back, and the reply
  // shows on its own.
  const shownIds = new Set([...commentsByPost.values()].flat().map((c) => c.id));
  const missingParents = [
    ...new Set(
      [...commentsByPost.values()]
        .flat()
        .map((c) => c.parentId)
        .filter((id): id is number => id !== null && !shownIds.has(id))
    ),
  ];
  if (missingParents.length > 0) {
    const { data: parents } = await supabase
      .from("post_comments")
      .select(COMMENT_SELECT)
      .in("id", missingParents)
      .returns<CommentRow[]>();
    for (const row of parents ?? []) {
      const list = commentsByPost.get(row.post_id) ?? [];
      list.push(toComment(row, viewerId, authorOf.get(row.post_id) ?? null));
      commentsByPost.set(row.post_id, list);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    author: toAuthor(row.author, row.author_id),
    body: row.body,
    visibility: row.visibility,
    club: row.club,
    photos: [...row.post_images]
      .sort((a, b) => a.position - b.position)
      .map((img) => ({ path: img.path, url: urls.get(img.path) ?? null, width: img.width, height: img.height })),
    likeCount: row.like_count,
    commentCount: row.comment_count,
    likedByMe: liked.has(row.id),
    isMine: row.author_id === viewerId,
    hidden: row.hidden_at !== null,
    createdAt: row.created_at,
    // Fetched newest first so the limit keeps the latest; shown oldest
    // first, as a conversation reads.
    comments: threadComments(commentsByPost.get(row.id) ?? []),
  }));
}

function toComment(row: CommentRow, viewerId: string, postAuthorId: string | null): FeedComment {
  return {
    id: row.id,
    postId: row.post_id,
    author: toAuthor(row.author, row.author_id),
    body: row.body,
    createdAt: row.created_at,
    hidden: row.hidden_at !== null,
    // Mirrors the DELETE policy on post_comments: your own, or any on your
    // own post. The policy is what enforces it; this only decides whether
    // to draw the button.
    canDelete: row.author_id === viewerId || postAuthorId === viewerId,
    isMine: row.author_id === viewerId,
    parentId: row.parent_id,
    depth: 0,
  };
}

/**
 * One page of the feed.
 *
 * "All PinPals" is every post the viewer may see, with a few new
 * marketplace listings from the same stretch of time mixed in. "My
 * connections" is posts from the viewer and the people they are connected
 * to, and no listings — that view is about people.
 */
export async function getFeedPage(
  supabase: SupabaseClient,
  viewerId: string,
  options: { scope: FeedScope; before: string | null }
): Promise<FeedPage> {
  let authorIds: string[] | null = null;
  if (options.scope === "connections") {
    const connected = await connectedMemberIds(supabase, viewerId);
    if (connected.length === 0) {
      return { entries: [], nextCursor: null, noConnections: true };
    }
    authorIds = [viewerId, ...connected];
  }

  let query = supabase
    .from("posts")
    .select(POST_SELECT)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(FEED_PAGE_SIZE + 1);

  if (authorIds) query = query.in("author_id", authorIds);
  if (options.before) query = query.lt("created_at", options.before);

  const listingsPromise =
    options.scope === "all"
      ? fetchMarketplaceListings(
          supabase,
          { ...EMPTY_MARKETPLACE_FILTERS, sort: "newest" },
          // id 0 makes the keyset strictly "older than `before`": the
          // function's tie-break is `created_at = cursor and id < cursor_id`,
          // and no listing has an id below 1.
          options.before ? { sort: "newest", createdAt: options.before, priceCents: null, id: 0 } : null,
          viewerId,
          FEED_LISTINGS_PER_PAGE
        ).catch(() => ({ listings: [] as MarketplaceListing[], nextCursor: null }))
      : Promise.resolve({ listings: [] as MarketplaceListing[], nextCursor: null });

  const [{ data, error }, listingResult] = await Promise.all([query.returns<PostRow[]>(), listingsPromise]);
  if (error) throw new Error(`Couldn't load the feed: ${error.message}`);

  const rows = data ?? [];
  const hasMore = rows.length > FEED_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;

  const posts = await hydratePosts(supabase, viewerId, page, PREVIEW_COMMENTS);
  const listings: FeedListing[] = listingResult.listings.map((l) => ({ ...l, createdAt: l.created_at }));

  const entries: FeedEntry[] = interleaveFeed(posts, listings, hasMore);

  return {
    entries,
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
    noConnections: false,
  };
}

/** A member's own page: their posts, newest first. RLS decides which of
 *  them the viewer may see — a stranger sees only the ones posted to all
 *  members. */
export async function getMemberPosts(
  supabase: SupabaseClient,
  viewerId: string,
  memberId: string,
  before: string | null
): Promise<{ posts: FeedPost[]; nextCursor: string | null }> {
  let query = supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("author_id", memberId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(FEED_PAGE_SIZE + 1);
  if (before) query = query.lt("created_at", before);

  const { data, error } = await query.returns<PostRow[]>();
  if (error) throw new Error(`Couldn't load posts: ${error.message}`);

  const rows = data ?? [];
  const hasMore = rows.length > FEED_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;
  return {
    posts: await hydratePosts(supabase, viewerId, page, PREVIEW_COMMENTS),
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
  };
}

/** One post with every comment, for /feed/[id]. Null when it does not
 *  exist or the viewer may not see it — the two are indistinguishable on
 *  purpose. */
export async function getPost(
  supabase: SupabaseClient,
  viewerId: string,
  postId: number
): Promise<FeedPost | null> {
  const { data } = await supabase.from("posts").select(POST_SELECT).eq("id", postId).maybeSingle<PostRow>();
  if (!data) return null;

  const [post] = await hydratePosts(supabase, viewerId, [data], 0);

  const { data: comments } = await supabase
    .from("post_comments")
    .select(COMMENT_SELECT)
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(500)
    .returns<CommentRow[]>();

  return { ...post, comments: threadComments((comments ?? []).map((c) => toComment(c, viewerId, data.author_id))) };
}

/** Counts for a member's page header. */
export async function getMemberPostCount(supabase: SupabaseClient, memberId: string): Promise<number> {
  const { count } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("author_id", memberId);
  return count ?? 0;
}
