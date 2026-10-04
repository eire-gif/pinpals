import {
  deleteFromSite,
  deleteFromSiteWithBody,
  patchSite,
  postFileToSite,
  postToSite,
  type UploadFile,
} from "./api";
import { placeLabel } from "./courses";
import { searchListings, EMPTY_FILTERS, type Card } from "./marketplace";
import { supabase } from "./supabase";
import {
  FEED_LISTINGS_PER_PAGE,
  FEED_PAGE_SIZE,
  interleave,
  threadComments,
  type FeedScope,
  type PostVisibility,
} from "./feed-rules";
import type { HoleDetails, PostKind, RoundDetails, ShotDetails } from "./post-details";
import { isReaction, normaliseCounts, type ReactionCounts, type ReactionKey } from "./reactions";

/**
 * The feed, for the app.
 *
 * READS go straight to Supabase, and 0088's policies decide what comes back
 * — a connections-only post from a stranger is simply absent, as it is on
 * the website. Photos live in a private bucket and are signed here with the
 * member's own session; the storage policy is the same can_view_post() rule,
 * so a photo can only be signed by someone who may see its post.
 *
 * WRITES all go through the website's /api/app/posts routes, without
 * exception. Posting needs the service role (photos into a private bucket);
 * liking and commenting notify the post's author, and notifications live in
 * TypeScript on the server. Deleting a comment notifies nobody and could
 * have been a direct delete, but one rule for every feed write is easier to
 * keep than one rule and an exception.
 *
 * THE ONE EXCEPTION is saving (0094): a private bookmark that notifies
 * nobody, written straight to Supabase exactly as listing favourites are
 * (marketplace.ts setFavourite). Its insert policy is can_view_post(), so the
 * rule that matters is still the database's.
 */

/** An hour, matching the website. */
const PHOTO_URL_TTL_SECONDS = 60 * 60;
const PREVIEW_COMMENTS = 2;

export type FeedAuthor = {
  id: string;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  homeClub: string | null;
  /** Null unless the member chose to show it (handicap_visible) — decided
   *  once, here, so no screen can forget. */
  handicap: number | null;
};

/** Where the post was played. `place` is placeLabel() — "Donabate · Ireland". */
export type FeedClub = { id: number; name: string; place: string | null; ratingAvg: number | null; ratingCount: number };

export type FeedPhoto = { path: string; url: string | null; width: number | null; height: number | null };

export type FeedComment = {
  id: number;
  postId: number;
  author: FeedAuthor;
  body: string;
  createdAt: string;
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
  club: FeedClub | null;
  photos: FeedPhoto[];
  /** How many reacted, all reactions together (posts.like_count). */
  likeCount: number;
  /** The breakdown (0096), e.g. { on_fire: 3, great_shot: 1 }. */
  reactionCounts: ReactionCounts;
  /** The viewer's reaction, or null. likedByMe is just this !== null,
   *  kept so code that only asks "reacted at all?" stays simple. */
  myReaction: ReactionKey | null;
  commentCount: number;
  likedByMe: boolean;
  /** Bookmarked by the viewer (0094). Private — never shown to anyone else. */
  savedByMe: boolean;
  /** What kind of post (0095), and its golf facts — null for a general
   *  post. Shapes and wording in post-details.ts, shared with the website. */
  kind: PostKind;
  details: RoundDetails | HoleDetails | ShotDetails | null;
  isMine: boolean;
  hidden: boolean;
  createdAt: string;
  comments: FeedComment[];
};

export type FeedEntry = { kind: "post"; item: FeedPost } | { kind: "listing"; item: Card };

export type FeedPage = {
  entries: FeedEntry[];
  cursor: string | null;
  noConnections: boolean;
};

type ProfileEmbed = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  avatar_color: string | null;
  home_club: string | null;
  handicap: number | null;
  handicap_visible: boolean | null;
};

type ClubEmbed = {
  id: number;
  name: string;
  slug: string | null;
  country: string | null;
  region: string | null;
  town: string | null;
  rating_avg: number | null;
  rating_count: number | null;
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
  /** Absent when reading a database without 0095 (see selectPosts). */
  kind?: PostKind;
  details?: RoundDetails | HoleDetails | ShotDetails | null;
  reaction_counts?: unknown;
  author: ProfileEmbed | null;
  club: ClubEmbed | null;
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

// posts has two foreign keys to profiles (author_id, hidden_by), so the
// embed has to name one. Started as the same strings as
// src/lib/feed-server.ts; the app now also reads the handicap pair and the
// club's place and rating for the card header (Oct 2026 feed polish). Every
// one of those columns is already readable by signed-in members — the
// member page and the Courses tab read them directly.
const POST_SELECT_LEGACY = `
  id, author_id, body, visibility, like_count, comment_count, hidden_at, created_at,
  author:profiles!posts_author_id_fkey ( id, first_name, last_name, avatar_url, avatar_color, home_club, handicap, handicap_visible ),
  club:clubs ( id, name, slug, country, region, town, rating_avg, rating_count ),
  post_images ( path, position, width, height )
`;

const POST_SELECT = POST_SELECT_LEGACY.replace("created_at,", "created_at, kind, details, reaction_counts,");

/**
 * Runs a posts query with kind/details (0095) and reaction_counts (0096),
 * and once more without them if the database doesn't have those columns yet
 * (Postgres 42703, undefined column) — so an app update that reaches phones
 * before the migrations are applied shows every post as a general one, with
 * its likes as Great Shots, instead of an empty feed. The order is
 * meant to be migration → merge → `eas update`; it slipped once already.
 */
let legacyPosts = false;
async function selectPosts<T>(
  run: (select: string) => PromiseLike<{ data: T | null; error: { code?: string } | null }>
): Promise<{ data: T | null; error: { code?: string } | null }> {
  if (!legacyPosts) {
    const result = await run(POST_SELECT);
    if (result.error?.code !== "42703") return result;
    legacyPosts = true;
  }
  return run(POST_SELECT_LEGACY);
}

const COMMENT_SELECT = `
  id, post_id, author_id, body, hidden_at, created_at, parent_id,
  author:profiles!post_comments_author_id_fkey ( id, first_name, last_name, avatar_url, avatar_color, home_club, handicap, handicap_visible )
`;

const toAuthor = (row: ProfileEmbed | null, fallbackId: string): FeedAuthor =>
  row
    ? {
        id: row.id,
        name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "A member",
        avatarUrl: row.avatar_url,
        avatarColor: row.avatar_color,
        homeClub: row.home_club,
        handicap: row.handicap_visible && row.handicap !== null ? Number(row.handicap) : null,
      }
    : { id: fallbackId, name: "A member", avatarUrl: null, avatarColor: null, homeClub: null, handicap: null };

const toClub = (row: ClubEmbed | null): FeedClub | null => {
  if (!row) return null;
  const place = row.country
    ? placeLabel({
        id: row.id,
        name: row.name,
        slug: row.slug ?? "",
        country: row.country,
        region: row.region,
        town: row.town,
        latitude: null,
        longitude: null,
      })
    : null;
  return {
    id: row.id,
    name: row.name,
    place: place || null,
    ratingAvg: row.rating_avg === null ? null : Number(row.rating_avg),
    ratingCount: row.rating_count ?? 0,
  };
};

const toComment = (row: CommentRow, viewerId: string, postAuthorId: string | null): FeedComment => ({
  id: row.id,
  postId: row.post_id,
  author: toAuthor(row.author, row.author_id),
  body: row.body,
  createdAt: row.created_at,
  hidden: row.hidden_at !== null,
  // The DELETE policy's rule: your own, or any on your own post. The policy
  // enforces it; this only decides whether to offer the button.
  canDelete: row.author_id === viewerId || postAuthorId === viewerId,
  isMine: row.author_id === viewerId,
  parentId: row.parent_id,
  depth: 0,
});

async function signPhotos(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  try {
    const { data } = await supabase.storage.from("post-images").createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
    const urls = new Map<string, string>();
    for (const row of data ?? []) {
      if (row.signedUrl && row.path) urls.set(row.path, row.signedUrl);
    }
    return urls;
  } catch {
    return new Map();
  }
}

async function hydrate(viewerId: string, rows: PostRow[], commentsPerPost: number): Promise<FeedPost[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [likes, saves, comments, urls] = await Promise.all([
    myReactions(viewerId, ids),
    // Before 0094 is applied this errors, and every post simply shows as
    // not saved — the feed must not depend on the newest table.
    supabase.from("post_saves").select("post_id").eq("user_id", viewerId).in("post_id", ids).overrideTypes<{ post_id: number }[]>(),
    commentsPerPost > 0
      ? supabase
          .from("post_comments")
          .select(COMMENT_SELECT)
          .in("post_id", ids)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(Math.min(ids.length * commentsPerPost * 4, 200))
          .overrideTypes<CommentRow[]>()
      : Promise.resolve({ data: [] as CommentRow[] }),
    signPhotos(rows.flatMap((r) => r.post_images.map((img) => img.path))),
  ]);

  const reacted = new Map(likes.map((l) => [l.post_id, l.reaction]));
  const saved = new Set((saves.data ?? []).map((l) => l.post_id));
  const authorOf = new Map(rows.map((r) => [r.id, r.author_id]));
  const byPost = new Map<number, FeedComment[]>();
  for (const row of (comments.data ?? []) as CommentRow[]) {
    const list = byPost.get(row.post_id) ?? [];
    if (list.length >= commentsPerPost) continue;
    list.push(toComment(row, viewerId, authorOf.get(row.post_id) ?? null));
    byPost.set(row.post_id, list);
  }

  // A preview reply needs what it answers: fetch any parent the latest-N cut
  // left out. RLS still decides — an invisible parent doesn't come back and
  // the reply shows on its own. Same as the site's hydratePosts().
  const shown = [...byPost.values()].flat();
  const shownIds = new Set(shown.map((c) => c.id));
  const missing = [
    ...new Set(shown.map((c) => c.parentId).filter((id): id is number => id !== null && !shownIds.has(id))),
  ];
  if (missing.length > 0) {
    const { data: parents } = await supabase
      .from("post_comments")
      .select(COMMENT_SELECT)
      .in("id", missing)
      .overrideTypes<CommentRow[]>();
    for (const row of (parents ?? []) as CommentRow[]) {
      const list = byPost.get(row.post_id) ?? [];
      list.push(toComment(row, viewerId, authorOf.get(row.post_id) ?? null));
      byPost.set(row.post_id, list);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    author: toAuthor(row.author, row.author_id),
    body: row.body,
    visibility: row.visibility,
    club: toClub(row.club),
    photos: [...row.post_images]
      .sort((a, b) => a.position - b.position)
      .map((img) => ({ path: img.path, url: urls.get(img.path) ?? null, width: img.width, height: img.height })),
    likeCount: row.like_count,
    reactionCounts: normaliseCounts(row.reaction_counts, row.like_count),
    myReaction: reacted.get(row.id) ?? null,
    commentCount: row.comment_count,
    likedByMe: reacted.has(row.id),
    savedByMe: saved.has(row.id),
    kind: row.kind ?? "general",
    details: row.details ?? null,
    isMine: row.author_id === viewerId,
    hidden: row.hidden_at !== null,
    createdAt: row.created_at,
    comments: threadComments(byPost.get(row.id) ?? []),
  }));
}

/** The viewer's reactions on these posts. Before 0096 there is no reaction
 *  column: read the likes alone and count each as the default. */
async function myReactions(viewerId: string, ids: number[]): Promise<{ post_id: number; reaction: ReactionKey }[]> {
  const withReaction = await supabase
    .from("post_likes")
    .select("post_id, reaction")
    .eq("user_id", viewerId)
    .in("post_id", ids)
    .overrideTypes<{ post_id: number; reaction: string }[]>();
  if (!withReaction.error) {
    return (withReaction.data ?? []).map((l) => ({ post_id: l.post_id, reaction: isReaction(l.reaction) ? l.reaction : "great_shot" }));
  }
  const plain = await supabase
    .from("post_likes")
    .select("post_id")
    .eq("user_id", viewerId)
    .in("post_id", ids)
    .overrideTypes<{ post_id: number }[]>();
  return (plain.data ?? []).map((l) => ({ post_id: l.post_id, reaction: "great_shot" as const }));
}

async function connectedIds(userId: string): Promise<string[]> {
  const [a, b] = await Promise.all([
    supabase
      .from("connections")
      .select("recipient_id")
      .eq("requester_id", userId)
      .eq("status", "accepted")
      .overrideTypes<{ recipient_id: string }[]>(),
    supabase
      .from("connections")
      .select("requester_id")
      .eq("recipient_id", userId)
      .eq("status", "accepted")
      .overrideTypes<{ requester_id: string }[]>(),
  ]);
  return [...(a.data ?? []).map((r) => r.recipient_id), ...(b.data ?? []).map((r) => r.requester_id)];
}

/**
 * One page of the feed, newest first. For You ("all") mixes in a few new
 * marketplace listings from the same stretch of time, through the same
 * search function the Marketplace tab uses; Following ("connections") is
 * people only — your connections and you.
 */
export async function loadFeed(viewerId: string, scope: FeedScope, before: string | null): Promise<FeedPage> {
  let authors: string[] | null = null;
  if (scope === "connections") {
    const connected = await connectedIds(viewerId);
    if (connected.length === 0) return { entries: [], cursor: null, noConnections: true };
    authors = [viewerId, ...connected];
  }

  const postsQuery = (select: string) => {
    let query = supabase
      .from("posts")
      .select(select)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(FEED_PAGE_SIZE + 1);
    if (authors) query = query.in("author_id", authors);
    if (before) query = query.lt("created_at", before);
    return query.overrideTypes<PostRow[]>();
  };

  const listingsPromise =
    scope === "all"
      ? searchListings(
          { ...EMPTY_FILTERS, sort: "newest" },
          // id 0 makes the keyset strictly "older than `before`" — the
          // function breaks created_at ties on id, and no listing has id 0.
          before ? { createdAt: before, priceCents: null, id: 0 } : null,
          viewerId,
          FEED_LISTINGS_PER_PAGE
        )
          .then((page) => page.cards)
          // The feed is about people. A marketplace hiccup must not empty it.
          .catch(() => [] as Card[])
      : Promise.resolve([] as Card[]);

  const [{ data, error }, listings] = await Promise.all([selectPosts<PostRow[]>(postsQuery), listingsPromise]);
  if (error) throw new Error("Couldn't load the feed. Pull down to try again.");

  const rows = (data ?? []) as PostRow[];
  const hasMore = rows.length > FEED_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;
  const posts = await hydrate(viewerId, page, PREVIEW_COMMENTS);

  return {
    entries: interleave(posts, listings, hasMore),
    cursor: hasMore ? page[page.length - 1].created_at : null,
    noConnections: false,
  };
}

/** A member's posts, newest first — whichever of them the viewer may see. */
export async function loadMemberPosts(
  viewerId: string,
  memberId: string,
  before: string | null
): Promise<{ posts: FeedPost[]; cursor: string | null }> {
  const { data, error } = await selectPosts<PostRow[]>((select) => {
    let query = supabase
      .from("posts")
      .select(select)
      .eq("author_id", memberId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(FEED_PAGE_SIZE + 1);
    if (before) query = query.lt("created_at", before);
    return query.overrideTypes<PostRow[]>();
  });
  if (error) throw new Error("Couldn't load posts. Pull down to try again.");
  const rows = (data ?? []) as PostRow[];
  const hasMore = rows.length > FEED_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;
  return { posts: await hydrate(viewerId, page, PREVIEW_COMMENTS), cursor: hasMore ? page[page.length - 1].created_at : null };
}

/** One post with all its comments. Null for "gone" and "not yours to see"
 *  alike — the two are deliberately indistinguishable. */
export async function loadPost(viewerId: string, postId: number): Promise<FeedPost | null> {
  const { data } = await selectPosts<PostRow>((select) =>
    supabase.from("posts").select(select).eq("id", postId).maybeSingle<PostRow>()
  );
  if (!data) return null;
  const [post] = await hydrate(viewerId, [data], 0);
  const { data: comments } = await supabase
    .from("post_comments")
    .select(COMMENT_SELECT)
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(500)
    .overrideTypes<CommentRow[]>();
  return {
    ...post,
    comments: threadComments(((comments ?? []) as CommentRow[]).map((c) => toComment(c, viewerId, data.author_id))),
  };
}

// ---------------------------------------------------------------------------
// Member page
// ---------------------------------------------------------------------------

export type MemberProfile = {
  id: string;
  name: string;
  firstName: string;
  homeClub: string | null;
  place: string | null;
  handicap: number | null;
  bio: string | null;
  avatarUrl: string | null;
  avatarColor: string | null;
  ageBand: string | null;
  joined: string;
  postCount: number;
  forSale: number;
};

export async function loadMemberProfile(memberId: string): Promise<MemberProfile | null> {
  const [{ data: row }, { data: band }, { count: postCount }, { count: forSale }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, first_name, last_name, home_club, county, country, handicap, handicap_visible, bio, avatar_url, avatar_color, created_at")
      .eq("id", memberId)
      .maybeSingle<{
        id: string;
        first_name: string | null;
        last_name: string | null;
        home_club: string | null;
        county: string | null;
        country: string | null;
        handicap: number | null;
        handicap_visible: boolean | null;
        bio: string | null;
        avatar_url: string | null;
        avatar_color: string | null;
        created_at: string;
      }>(),
    supabase.from("member_age_bands").select("age_band").eq("user_id", memberId).maybeSingle<{ age_band: string }>(),
    supabase.from("posts").select("id", { count: "exact", head: true }).eq("author_id", memberId),
    supabase.from("listings").select("id", { count: "exact", head: true }).eq("seller_id", memberId).eq("status", "active"),
  ]);
  if (!row) return null;

  const joined = new Date(row.created_at);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  return {
    id: row.id,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "A member",
    firstName: row.first_name || "This member",
    homeClub: row.home_club,
    place: [row.county, row.country].filter(Boolean).join(", ") || null,
    // handicap_visible is the member's own choice — honoured here, once.
    handicap: row.handicap_visible ? row.handicap : null,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    avatarColor: row.avatar_color,
    ageBand: band?.age_band ?? null,
    joined: `Joined ${months[joined.getMonth()]} ${joined.getFullYear()}`,
    postCount: postCount ?? 0,
    forSale: forSale ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Writes — all through the website
// ---------------------------------------------------------------------------

export type StagedPhoto = { path: string; width: number; height: number };

/** One photo, ahead of the post. One request each: a Vercel function
 *  cannot take six phone photos in a single body. */
export const stagePhoto = (file: UploadFile): Promise<StagedPhoto> =>
  postFileToSite<StagedPhoto>("/api/app/posts/photos", file);

/** A staged photo removed before posting. Best-effort: an orphan in a
 *  folder nobody can read is nothing a member can do anything about. */
export async function discardPhoto(path: string): Promise<void> {
  try {
    await deleteFromSiteWithBody("/api/app/posts/photos", { path });
  } catch {
    // See above.
  }
}

export const createPost = (input: {
  body: string;
  visibility: PostVisibility;
  clubId: number | null;
  photoPaths: string[];
  /** 0095. Omitted for a general post, so this request is exactly what an
   *  older app sent and an older website accepts. */
  kind?: PostKind;
  details?: RoundDetails | HoleDetails | ShotDetails | null;
}): Promise<{ id: number }> =>
  postToSite<{ id: number }>("/api/app/posts", {
    body: input.body,
    visibility: input.visibility,
    club_id: input.clubId,
    photo_paths: input.photoPaths,
    ...(input.kind && input.kind !== "general" ? { kind: input.kind, details: input.details } : {}),
  });

export type ReactionResult = {
  liked: boolean;
  likeCount: number;
  /** Absent from a pre-0096 website; the caller keeps its own guess then. */
  reaction?: ReactionKey | null;
  reactionCounts?: ReactionCounts;
};

/** Reacts (or un-reacts). `reaction` omitted is the website's default. */
export const setLike = (postId: number, liked: boolean, reaction?: ReactionKey): Promise<ReactionResult> =>
  postToSite(`/api/app/posts/${postId}/like`, reaction ? { liked, reaction } : { liked });

/** A comment on the post, or — with `parentId` — a reply to one comment. */
export const addComment = (postId: number, body: string, parentId: number | null = null): Promise<{ id: number }> =>
  postToSite(`/api/app/posts/${postId}/comments`, parentId === null ? { body } : { body, parent_id: parentId });

export const deleteComment = (postId: number, commentId: number): Promise<{ ok: true }> =>
  deleteFromSite(`/api/app/posts/${postId}/comments/${commentId}`);

/**
 * Saves or unsaves a post for the viewer. Direct to Supabase (see the note
 * at the top). DO NOTHING on a duplicate rather than an upsert: members have
 * no UPDATE on post_saves, and a double tap must not be an error.
 */
export async function setSaved(postId: number, userId: string, saved: boolean): Promise<void> {
  const { error } = saved
    ? await supabase
        .from("post_saves")
        .upsert({ post_id: postId, user_id: userId }, { onConflict: "post_id,user_id", ignoreDuplicates: true })
    : await supabase.from("post_saves").delete().eq("post_id", postId).eq("user_id", userId);
  if (error) throw new Error("Couldn't save that. Please try again.");
}

export const deletePost = (postId: number): Promise<{ ok: true }> => deleteFromSite(`/api/app/posts/${postId}`);

export const changeAudience = (postId: number, visibility: PostVisibility): Promise<{ id: number }> =>
  patchSite(`/api/app/posts/${postId}`, { visibility });

export const report = (
  target: "post" | "post_comment",
  targetId: number,
  category: string
): Promise<{ ok: true }> => postToSite("/api/app/posts/report", { target, target_id: targetId, category });
