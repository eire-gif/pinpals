"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  reportFeedContent,
  setPostLike,
  updatePost,
} from "@/lib/feed-operations";
import { createClient } from "@/lib/supabase/server";

/**
 * The website's half of the feed's writes. Each one is a thin wrapper over
 * src/lib/feed-operations.ts — the same operations the app's
 * /api/app/posts routes call — so the rate limits, the checks and the
 * notifications are identical however a member got here.
 */

export type FeedActionResult<T = null> = { ok: true; value: T } | { ok: false; error: string };

async function member() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/feed");
  return { supabase, userId: user.id };
}

function refresh(postId?: number) {
  revalidatePath("/feed");
  if (postId) revalidatePath(`/feed/${postId}`);
}

export async function createPostAction(input: {
  body: string;
  visibility: string;
  clubId: number | null;
  photoPaths: string[];
}): Promise<FeedActionResult<{ id: number }>> {
  const { supabase, userId } = await member();
  const result = await createPost({ supabase, userId, ...input });
  if (!result.ok) return { ok: false, error: result.message };
  refresh();
  revalidatePath(`/members/${userId}`);
  return { ok: true, value: result.value };
}

export async function updatePostAction(
  postId: number,
  changes: { body?: string; visibility?: string }
): Promise<FeedActionResult> {
  const { supabase, userId } = await member();
  const result = await updatePost({ supabase, userId, postId, ...changes });
  if (!result.ok) return { ok: false, error: result.message };
  refresh(postId);
  return { ok: true, value: null };
}

export async function deletePostAction(postId: number): Promise<FeedActionResult> {
  const { supabase, userId } = await member();
  const result = await deletePost({ supabase, userId, postId });
  if (!result.ok) return { ok: false, error: result.message };
  refresh();
  revalidatePath(`/members/${userId}`);
  return { ok: true, value: null };
}

/** No revalidate: the card already shows the new state optimistically, and
 *  re-rendering the whole feed for a heart would scroll-jank the page. */
export async function setLikeAction(
  postId: number,
  like: boolean
): Promise<FeedActionResult<{ liked: boolean; likeCount: number }>> {
  const { supabase, userId } = await member();
  const result = await setPostLike({ supabase, userId, postId, like });
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, value: result.value };
}

export async function addCommentAction(postId: number, body: string): Promise<FeedActionResult<{ id: number }>> {
  const { supabase, userId } = await member();
  const result = await addComment({ supabase, userId, postId, body });
  if (!result.ok) return { ok: false, error: result.message };
  refresh(postId);
  return { ok: true, value: result.value };
}

export async function deleteCommentAction(commentId: number, postId: number): Promise<FeedActionResult> {
  const { supabase } = await member();
  const result = await deleteComment({ supabase, commentId });
  if (!result.ok) return { ok: false, error: result.message };
  refresh(postId);
  return { ok: true, value: null };
}

export async function reportAction(input: {
  target: "post" | "post_comment";
  targetId: number;
  category: string;
  description: string;
}): Promise<FeedActionResult> {
  const { supabase, userId } = await member();
  const result = await reportFeedContent({ supabase, userId, ...input });
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, value: null };
}
