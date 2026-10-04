import { asBoolean, asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { setPostLike, statusForFeedFailure } from "@/lib/feed-operations";

/**
 * POST /api/app/posts/[id]/like   { liked: boolean, reaction? }
 *   → { liked, likeCount, reaction, reactionCounts }
 *
 * `reaction` (0096) is one of src/lib/reactions.ts; omitted means the
 * default, Great Shot, which is what an older app's like records. Liking
 * again with a different reaction changes it.
 *
 * Idempotent in both directions: liking an already-liked post and unliking
 * an unliked one both succeed, so a double tap on one bar of signal cannot
 * produce an error. A route rather than a direct insert because the author
 * is told — see setPostLike().
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const postId = asId((await params).id);
  if (postId === null) return badRequest("Post id must be a positive integer.");

  const input = await readJson<{ liked?: unknown; reaction?: unknown }>(request);
  const liked = asBoolean(input?.liked);
  if (liked === null) return badRequest("Expected { liked: boolean }.");

  const result = await setPostLike({
    supabase: auth.supabase,
    userId: auth.user.id,
    postId,
    like: liked,
    reaction: input?.reaction,
  });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForFeedFailure(result.reason) });
  }
  return Response.json(result.value);
}
