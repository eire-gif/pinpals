import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { MAX_POST_PHOTOS, parseVisibility, validateComment, validatePostDraft, type PostVisibility } from "@/lib/feed";
import { cleanDetails, detailsProblem, isPostKind, type PostKind } from "@/lib/post-details";
import { DEFAULT_REACTION, REACTION_INFO, isReaction, normaliseCounts, type ReactionCounts, type ReactionKey } from "@/lib/reactions";
import {
  ImageProcessingError,
  attachPendingPostImages,
  deletePostImages,
  parsePendingPostImagePath,
  uploadPendingPostImage,
} from "@/lib/images/upload";
import { buildDedupeKey } from "@/lib/notifications";
import { notifyUser } from "@/lib/notifications-server";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every write to the feed, once, for both callers: the website's Server
 * Actions (src/app/feed/actions.ts) and the app's /api/app/posts routes.
 * The same shape as tee-times-operations.ts and sendMessageTo(), for the
 * same reason — a notification follows several of these writes, and the
 * notification is scheduled INSIDE the operation, not by the caller. A
 * caller that had to remember would eventually forget.
 *
 * `supabase` is always the MEMBER's own client, and every row write goes
 * through it, so 0088's policies are what actually decide whether the write
 * is allowed. The admin client is used for exactly three things the member's
 * client cannot do: putting photos into the private bucket (no insert
 * policy, by design), recording the photo rows that point at them, and
 * writing notifications.
 *
 * The pre-checks below duplicate some of what the policies enforce. They
 * stay because "You can't comment on that post" is worth more to a member
 * than "new row violates row-level security policy". The policy remains the
 * thing that actually enforces it.
 */

export type FeedFailure = "invalid" | "rate_limited" | "not_found" | "forbidden" | "failed";

export type FeedResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: FeedFailure; message: string };

const fail = (reason: FeedFailure, message: string): FeedResult<never> => ({ ok: false, reason, message });

/** HTTP status for each way a feed write can decline — for the app routes. */
export function statusForFeedFailure(reason: FeedFailure): number {
  switch (reason) {
    case "invalid":
      return 422;
    case "rate_limited":
      return 429;
    case "not_found":
      return 404;
    case "forbidden":
      return 403;
    case "failed":
      return 500;
  }
}

// Ceilings a real golfer never meets and a script hits at once. Posting is
// a few times a week; liking is many times a session; commenting sits
// between.
const POST_MAX = 20;
const POST_WINDOW_SECONDS = 60 * 60;
const LIKE_MAX = 300;
const LIKE_WINDOW_SECONDS = 60 * 60;
const COMMENT_MAX = 40;
const COMMENT_WINDOW_SECONDS = 10 * 60;

async function limited(action: string, userId: string, max: number, windowSeconds: number) {
  const result = await checkRateLimit({ action, identifier: userId, maxHits: max, windowSeconds });
  return result.allowed ? null : fail("rate_limited", rateLimitMessage(result.retryAfterSeconds));
}

async function memberName(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", userId)
    .maybeSingle<{ first_name: string | null; last_name: string | null }>();
  return [data?.first_name, data?.last_name].filter(Boolean).join(" ") || "A member";
}

/** Normalises a club id from a form or JSON body: blank means "no course". */
export function parseClubId(raw: unknown): number | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : "invalid";
}

// ===========================================================================
// Posts
// ===========================================================================

// ===========================================================================
// Photos, ahead of the post
// ===========================================================================

/**
 * Stages one photo for a post the member is still writing. One request per
 * photo because a Vercel function cannot accept more than 4.5MB in one go —
 * see uploadPendingPostImage().
 */
export async function stagePostPhoto(input: {
  userId: string;
  file: File;
}): Promise<FeedResult<{ path: string; width: number; height: number }>> {
  // Counted against the same ceiling as posting, at six photos a post.
  const refused = await limited("stage-post-photo", input.userId, POST_MAX * MAX_POST_PHOTOS, POST_WINDOW_SECONDS);
  if (refused) return refused;

  try {
    const staged = await uploadPendingPostImage(createAdminClient(), input.userId, input.file);
    return { ok: true, value: staged };
  } catch (err) {
    if (err instanceof ImageProcessingError) return fail("invalid", err.message);
    return fail("failed", "Couldn't upload that photo — please try again.");
  }
}

/** A photo removed from the composer before posting. Only ever the
 *  member's own staged photo — anything else is refused as not found. */
export async function discardStagedPostPhoto(input: { userId: string; path: string }): Promise<FeedResult<null>> {
  if (!parsePendingPostImagePath(input.userId, input.path)) return fail("not_found", "That photo has already gone.");
  await deletePostImages(createAdminClient(), [input.path]);
  return { ok: true, value: null };
}

// ===========================================================================
// Posts
// ===========================================================================

export async function createPost(input: {
  supabase: SupabaseClient;
  userId: string;
  body: string;
  visibility: unknown;
  clubId: unknown;
  /** Staging paths from stagePostPhoto(), in the order to show them. */
  photoPaths: unknown;
  /** 0095. Omitted by the website's own composer, which posts general
   *  posts only; the app sends a kind and its details. */
  kind?: unknown;
  details?: unknown;
}): Promise<FeedResult<{ id: number }>> {
  const { supabase, userId } = input;

  const photoPaths = Array.isArray(input.photoPaths)
    ? input.photoPaths.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  if (Array.isArray(input.photoPaths) && photoPaths.length !== input.photoPaths.length) {
    return fail("invalid", "One of those photos couldn't be found — please add it again.");
  }
  if (new Set(photoPaths).size !== photoPaths.length) {
    return fail("invalid", "The same photo was added twice.");
  }

  const visibility = parseVisibility(input.visibility);
  if (!visibility) return fail("invalid", "Choose who can see this post.");

  const clubId = parseClubId(input.clubId);
  if (clubId === "invalid") return fail("invalid", "That course couldn't be found — try choosing it again.");

  let kind: PostKind = "general";
  if (input.kind !== undefined && input.kind !== null) {
    if (!isPostKind(input.kind)) return fail("invalid", "That kind of post isn't recognised — please update the app.");
    kind = input.kind;
  }
  // Blanks dropped before checking, the same as the app does, so an unused
  // field sent as "" can't fail a post. The database check
  // (post_details_valid, 0095) applies the same rules again.
  const rawDetails = input.details ?? null;
  const details =
    kind === "general"
      ? rawDetails
      : rawDetails !== null && typeof rawDetails === "object" && !Array.isArray(rawDetails)
        ? cleanDetails(rawDetails as Record<string, unknown>)
        : rawDetails;
  const detailsIssue = detailsProblem(kind, details);
  if (detailsIssue) return fail("invalid", detailsIssue);

  const problem = validatePostDraft({
    body: input.body,
    visibility,
    clubId,
    photoCount: photoPaths.length,
    hasDetails: kind !== "general",
  });
  if (problem) return fail("invalid", problem);

  // Refuse a stranger's staging path before anything is written, rather
  // than after a post exists that would then have to be taken back out.
  if (photoPaths.some((p) => parsePendingPostImagePath(userId, p) === null)) {
    return fail("invalid", "One of those photos couldn't be found — please add it again.");
  }

  const refused = await limited("create-post", userId, POST_MAX, POST_WINDOW_SECONDS);
  if (refused) return refused;

  if (clubId !== null) {
    const { data: club } = await supabase.from("clubs").select("id").eq("id", clubId).maybeSingle();
    if (!club) return fail("invalid", "That course couldn't be found — try choosing it again.");
  }

  // The row first, through the member's own client: the INSERT policy is
  // what guarantees author_id is the caller. The photos are then moved under
  // the id it returns, which is the moment they become visible to anyone.
  const { data: post, error } = await supabase
    .from("posts")
    .insert({ author_id: userId, body: input.body.trim(), visibility, club_id: clubId, kind, details })
    .select("id")
    .single<{ id: number }>();

  if (error || !post) return fail("failed", "Couldn't post that just now — please try again.");

  if (photoPaths.length === 0) return { ok: true, value: { id: post.id } };

  const admin = createAdminClient();
  let attached: { path: string; width: number; height: number }[] = [];

  try {
    attached = await attachPendingPostImages(admin, userId, post.id, photoPaths);

    const { error: rowsError } = await admin.from("post_images").insert(
      attached.map((img, position) => ({
        post_id: post.id,
        path: img.path,
        position,
        width: img.width,
        height: img.height,
      }))
    );
    if (rowsError) throw new Error(rowsError.message);
  } catch (err) {
    // All or nothing. A post that went up with three of its five photos is
    // not the post the member wrote, and they would have no way to tell
    // which two were lost. Take it back out and say so.
    await deletePostImages(admin, attached.map((a) => a.path));
    await supabase.from("posts").delete().eq("id", post.id);
    if (err instanceof ImageProcessingError) return fail("invalid", err.message);
    return fail("failed", "Couldn't attach your photos — please try again.");
  }

  return { ok: true, value: { id: post.id } };
}

export async function updatePost(input: {
  supabase: SupabaseClient;
  userId: string;
  postId: number;
  body?: string;
  visibility?: unknown;
  clubId?: unknown;
}): Promise<FeedResult<{ id: number }>> {
  const { supabase, userId, postId } = input;

  const { data: current } = await supabase
    .from("posts")
    .select("id, author_id, body, visibility, club_id, post_images ( id )")
    .eq("id", postId)
    .maybeSingle<{
      id: number;
      author_id: string;
      body: string;
      visibility: PostVisibility;
      club_id: number | null;
      post_images: { id: number }[];
    }>();

  if (!current) return fail("not_found", "That post no longer exists.");
  if (current.author_id !== userId) return fail("forbidden", "You can only edit your own posts.");

  const changes: { body?: string; visibility?: PostVisibility; club_id?: number | null } = {};

  if (input.visibility !== undefined) {
    const visibility = parseVisibility(input.visibility);
    if (!visibility) return fail("invalid", "Choose who can see this post.");
    changes.visibility = visibility;
  }
  if (input.clubId !== undefined) {
    const clubId = parseClubId(input.clubId);
    if (clubId === "invalid") return fail("invalid", "That course couldn't be found — try choosing it again.");
    changes.club_id = clubId;
  }
  if (input.body !== undefined) changes.body = input.body.trim();

  const problem = validatePostDraft({
    body: changes.body ?? current.body,
    visibility: changes.visibility ?? current.visibility,
    clubId: changes.club_id === undefined ? current.club_id : changes.club_id,
    photoCount: current.post_images.length,
  });
  if (problem) return fail("invalid", problem);

  if (Object.keys(changes).length === 0) return { ok: true, value: { id: postId } };

  const { data, error } = await supabase.from("posts").update(changes).eq("id", postId).select("id");
  if (error) return fail("failed", "Couldn't save that change — please try again.");
  if (!data || data.length === 0) return fail("not_found", "That post no longer exists.");
  return { ok: true, value: { id: postId } };
}

export async function deletePost(input: {
  supabase: SupabaseClient;
  userId: string;
  postId: number;
}): Promise<FeedResult<null>> {
  const { supabase, userId, postId } = input;

  // Read the photo paths first: once the row has gone, so have the
  // post_images rows (cascade), and with them the only record of which
  // Storage objects to remove.
  const { data: current } = await supabase
    .from("posts")
    .select("id, author_id, post_images ( path )")
    .eq("id", postId)
    .maybeSingle<{ id: number; author_id: string; post_images: { path: string }[] }>();

  if (!current) return fail("not_found", "That post no longer exists.");
  if (current.author_id !== userId) return fail("forbidden", "You can only delete your own posts.");

  const { data, error } = await supabase.from("posts").delete().eq("id", postId).select("id");
  if (error) return fail("failed", "Couldn't delete that post — please try again.");
  if (!data || data.length === 0) return fail("not_found", "That post no longer exists.");

  await deletePostImages(createAdminClient(), current.post_images.map((img) => img.path));
  return { ok: true, value: null };
}

// ===========================================================================
// Likes
// ===========================================================================

/**
 * Likes or unlikes a post, returning the post's like count afterwards.
 *
 * A like notifies the post's author IN-APP ONLY: notify_user() is called
 * directly rather than through notifyUser(), which would also send email and
 * push. A phone that buzzes every time somebody taps a heart is a phone
 * whose owner turns notifications off for the whole app — and with them the
 * comment, the message and the tee-time offer they actually needed. The
 * dedupe key is per liker per post, so like-unlike-like cannot make the
 * bell count climb.
 */
/**
 * Likes and reactions (0096). A reaction is a like with a flavour: `like`
 * says whether the member has reacted at all, `reaction` which one. An older
 * app sends no reaction and gets the default, Great Shot; reacting again
 * with a different one changes it in place (one row per member per post).
 *
 * Returns the server's numbers, which the app puts over its optimistic
 * guess: the total, the breakdown, and what the member's reaction now is.
 */
export async function setPostLike(input: {
  supabase: SupabaseClient;
  userId: string;
  postId: number;
  like: boolean;
  reaction?: unknown;
}): Promise<
  FeedResult<{ liked: boolean; likeCount: number; reaction: ReactionKey | null; reactionCounts: ReactionCounts }>
> {
  const { supabase, userId, postId, like } = input;
  if (input.reaction !== undefined && input.reaction !== null && !isReaction(input.reaction)) {
    return fail("invalid", "That reaction isn't recognised — please update the app.");
  }
  const reaction: ReactionKey = isReaction(input.reaction) ? input.reaction : DEFAULT_REACTION;
  const explicit = isReaction(input.reaction);

  const refused = await limited("like-post", userId, LIKE_MAX, LIKE_WINDOW_SECONDS);
  if (refused) return refused;

  const { data: post } = await supabase
    .from("posts")
    .select("id, author_id")
    .eq("id", postId)
    .maybeSingle<{ id: number; author_id: string }>();
  if (!post) return fail("not_found", "That post is no longer available.");

  let newlyLiked = false;
  if (like) {
    const { error } = await supabase.from("post_likes").insert({ post_id: postId, user_id: userId, reaction });
    // 23505: already reacted. With a reaction named, that's a change of
    // reaction — update the one row. Without one (an older app's "like"),
    // the member's intent is already true: a success, not an error. A double
    // tap on a slow connection lands here too.
    if (error && error.code !== "23505") return fail("failed", "Couldn't save that — please try again.");
    if (error && explicit) {
      const { error: changeError } = await supabase
        .from("post_likes")
        .update({ reaction })
        .eq("post_id", postId)
        .eq("user_id", userId);
      if (changeError) return fail("failed", "Couldn't save that — please try again.");
    }
    newlyLiked = !error;
  } else {
    const { error } = await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", userId);
    if (error) return fail("failed", "Couldn't save that — please try again.");
  }

  const [{ data: after }, { data: mine }] = await Promise.all([
    supabase
      .from("posts")
      .select("like_count, reaction_counts")
      .eq("id", postId)
      .maybeSingle<{ like_count: number; reaction_counts: unknown }>(),
    supabase
      .from("post_likes")
      .select("reaction")
      .eq("post_id", postId)
      .eq("user_id", userId)
      .maybeSingle<{ reaction: string }>(),
  ]);

  if (newlyLiked && post.author_id !== userId) {
    const name = await memberName(supabase, userId);
    const admin = createAdminClient();
    // Best-effort, like every notification: a failure here must never undo
    // the like the member can already see.
    const { error } = await admin.rpc("notify_user", {
      p_user_id: post.author_id,
      p_type: "post_liked",
      // Still type "post_liked": alert routing, preferences and dedupe all
      // key on it, and a reaction is a like. Only the words name it.
      p_title: `${name} reacted ${REACTION_INFO[reaction].label} to your post`,
      p_body: "Tap to see it.",
      p_data: { href: `/feed/${postId}`, post_id: postId },
      p_dedupe_key: buildDedupeKey(["post_liked", postId, userId]),
    });
    if (error) console.error("[feed] like notification failed:", error.message);
  }

  const likeCount = after?.like_count ?? 0;
  return {
    ok: true,
    value: {
      liked: mine !== null,
      likeCount,
      reaction: mine && isReaction(mine.reaction) ? mine.reaction : null,
      reactionCounts: normaliseCounts(after?.reaction_counts, likeCount),
    },
  };
}

// ===========================================================================
// Comments
// ===========================================================================

export async function addComment(input: {
  supabase: SupabaseClient;
  userId: string;
  postId: number;
  body: string;
  /** Replying to this comment (0092). The database files a reply to a
   *  reply under its top-level comment, and refuses a parent the replier
   *  could not see. */
  parentId?: number | null;
  /** Members named with @ (0097). Sent as the app found them; the database
   *  keeps only those the commenter may name and who can see the post
   *  (clean_post_comment_mentions), and only those are notified. */
  mentions?: unknown;
}): Promise<FeedResult<{ id: number; mentions: string[] }>> {
  const { supabase, userId, postId } = input;
  const parentId = input.parentId ?? null;
  const mentions = parseMentions(input.mentions);
  if (mentions === null) return fail("invalid", "Those mentions couldn't be read — please try again.");
  const body = input.body.trim();

  const problem = validateComment(body);
  if (problem) return fail("invalid", problem);

  const refused = await limited("post-comment", userId, COMMENT_MAX, COMMENT_WINDOW_SECONDS);
  if (refused) return refused;

  const { data: post } = await supabase
    .from("posts")
    .select("id, author_id")
    .eq("id", postId)
    .maybeSingle<{ id: number; author_id: string }>();
  if (!post) return fail("not_found", "That post is no longer available.");

  // Who is being answered — read under the replier's own RLS, so a comment
  // they cannot see is "not there" here as well as in the trigger.
  let answered: { author_id: string } | null = null;
  if (parentId !== null) {
    const { data: parent } = await supabase
      .from("post_comments")
      .select("author_id")
      .eq("id", parentId)
      .eq("post_id", postId)
      .maybeSingle<{ author_id: string }>();
    if (!parent) return fail("not_found", "That comment is no longer available to reply to.");
    answered = parent;
  }

  const { data: comment, error } = await supabase
    .from("post_comments")
    .insert({ post_id: postId, author_id: userId, body, parent_id: parentId, ...(mentions.length ? { mentions } : {}) })
    .select("id, mentions")
    .single<{ id: number; mentions: string[] | null }>();

  if (error || !comment) {
    if (error?.message.includes("no longer available")) {
      return fail("not_found", "That comment is no longer available to reply to.");
    }
    return fail("failed", "Couldn't post your comment — please try again.");
  }

  // The person answered hears about it — "replied to your comment" — unless
  // they are answering themselves. If they also wrote the post, that one
  // notification covers both; nobody needs two buzzes for one comment.
  if (answered && answered.author_id !== userId) {
    const name = await memberName(supabase, userId);
    const snippet = body.length > 120 ? `${body.slice(0, 117)}…` : body;
    await notifyUser(createAdminClient(), {
      userId: answered.author_id,
      type: "post_comment_replied",
      title: `${name} replied to your comment`,
      body: snippet,
      href: `/feed/${postId}`,
      data: { post_id: postId, comment_id: comment.id, parent_id: parentId },
      dedupeKey: buildDedupeKey(["post_comment_replied", comment.id]),
      emailBody: `${name} replied to your comment on PinPals.`,
    });
  }

  if (post.author_id !== userId && post.author_id !== answered?.author_id) {
    const name = await memberName(supabase, userId);
    const snippet = body.length > 120 ? `${body.slice(0, 117)}…` : body;
    await notifyUser(createAdminClient(), {
      userId: post.author_id,
      type: "post_commented",
      title: `${name} commented on your post`,
      body: snippet,
      href: `/feed/${postId}`,
      data: { post_id: postId, comment_id: comment.id },
      dedupeKey: buildDedupeKey(["post_commented", comment.id]),
      // The comment itself is another member's words. It is shown in-app,
      // behind the recipient's own session; it is not put in an email or on
      // a lock screen — see notifyUser()'s emailBody note.
      emailBody: `${name} commented on your post on PinPals.`,
    });
  }

  // Everyone the database kept in `mentions`, less anyone who has just been
  // told about this comment another way — one buzz per comment per person.
  const alreadyTold = new Set([userId, post.author_id, answered?.author_id].filter(Boolean));
  const mentioned = (comment.mentions ?? []).filter((id) => !alreadyTold.has(id));
  if (mentioned.length > 0) {
    const name = await memberName(supabase, userId);
    const snippet = body.length > 120 ? `${body.slice(0, 117)}…` : body;
    const admin = createAdminClient();
    for (const id of mentioned) {
      await notifyUser(admin, {
        userId: id,
        type: "post_comment_mentioned",
        title: `${name} mentioned you in a comment`,
        body: snippet,
        href: `/feed/${postId}`,
        data: { post_id: postId, comment_id: comment.id },
        dedupeKey: buildDedupeKey(["post_comment_mentioned", comment.id, id]),
        emailBody: `${name} mentioned you in a comment on PinPals.`,
      });
    }
  }

  return { ok: true, value: { id: comment.id, mentions: comment.mentions ?? [] } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Up to ten member ids, or null for anything that isn't a list of ids.
 *  Absent is an empty list. */
export function parseMentions(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 10) return null;
  if (!raw.every((id) => typeof id === "string" && UUID.test(id))) return null;
  return [...new Set(raw as string[])];
}

/**
 * Changes the body of the member's own comment (0097). The UPDATE policy is
 * the rule — the author, a comment not hidden by a moderator — and the
 * database stamps edited_at, which the app shows as "Edited". Mentions
 * aren't re-read and nobody is notified: an edit is a correction, not a
 * second comment.
 */
export async function editComment(input: {
  supabase: SupabaseClient;
  userId: string;
  commentId: number;
  body: string;
}): Promise<FeedResult<{ id: number; editedAt: string | null }>> {
  const body = input.body.trim();
  const problem = validateComment(body);
  if (problem) return fail("invalid", problem);

  const refused = await limited("edit-comment", input.userId, COMMENT_MAX, COMMENT_WINDOW_SECONDS);
  if (refused) return refused;

  const { data, error } = await input.supabase
    .from("post_comments")
    .update({ body })
    .eq("id", input.commentId)
    .eq("author_id", input.userId)
    .select("id, edited_at")
    .maybeSingle<{ id: number; edited_at: string | null }>();
  if (error) return fail("failed", "Couldn't save your edit — please try again.");
  if (!data) return fail("not_found", "That comment can't be edited any more.");
  return { ok: true, value: { id: data.id, editedAt: data.edited_at } };
}

export async function deleteComment(input: {
  supabase: SupabaseClient;
  commentId: number;
}): Promise<FeedResult<null>> {
  // The DELETE policy is the whole rule — your own comment, or any comment
  // on your own post — so there is nothing to pre-check that it would not
  // already say. Zero rows back means "not yours or not there", and both
  // read the same to the member.
  const { data, error } = await input.supabase
    .from("post_comments")
    .delete()
    .eq("id", input.commentId)
    .select("id");
  if (error) return fail("failed", "Couldn't delete that comment — please try again.");
  if (!data || data.length === 0) return fail("not_found", "That comment has already gone.");
  return { ok: true, value: null };
}

// ===========================================================================
// Reporting
// ===========================================================================

const REPORT_MAX = 10;
const REPORT_WINDOW_SECONDS = 60 * 60;

/**
 * Files a report against a post or a comment into the existing moderation
 * queue (0016). The member must be able to SEE what they are reporting —
 * checked through their own client — so a report cannot be used to probe
 * for posts that are hidden from them.
 */
export async function reportFeedContent(input: {
  supabase: SupabaseClient;
  userId: string;
  target: "post" | "post_comment";
  targetId: number;
  category: string;
  description: string;
}): Promise<FeedResult<null>> {
  const { supabase, userId, target, targetId } = input;
  const allowed = ["spam", "harassment", "inappropriate_content", "scam_fraud", "other"];
  if (!allowed.includes(input.category)) return fail("invalid", "Please choose a reason.");
  if (input.description.length > 4000) return fail("invalid", "Please keep the description under 4000 characters.");

  const refused = await limited("report-feed", userId, REPORT_MAX, REPORT_WINDOW_SECONDS);
  if (refused) return refused;

  const { data: visible } = await supabase
    .from(target === "post" ? "posts" : "post_comments")
    .select("id")
    .eq("id", targetId)
    .maybeSingle();
  if (!visible) return fail("not_found", "That is no longer available.");

  const { error } = await createAdminClient().from("reports").insert({
    reporter_id: userId,
    target_type: target,
    target_id: String(targetId),
    category: input.category,
    description: input.description.trim() || null,
  });
  if (error) return fail("failed", "Couldn't file that report — please try again.");
  return { ok: true, value: null };
}
