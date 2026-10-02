import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { deleteComment, statusForFeedFailure } from "@/lib/feed-operations";

/**
 * DELETE /api/app/posts/[id]/comments/[commentId]
 *
 * Your own comment, or any comment on your own post — 0088's DELETE policy
 * is the whole rule. Kept as a route, though nothing is notified, so that
 * every feed write the app makes goes the same way and none of them need
 * an exception explained in mobile/src/lib/feed.ts.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const commentId = asId((await params).commentId);
  if (commentId === null) return badRequest("Comment id must be a positive integer.");

  const result = await deleteComment({ supabase: auth.supabase, commentId });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForFeedFailure(result.reason) });
  }
  return Response.json({ ok: true });
}
