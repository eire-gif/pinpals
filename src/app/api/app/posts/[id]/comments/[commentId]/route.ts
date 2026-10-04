import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { deleteComment, editComment, statusForFeedFailure } from "@/lib/feed-operations";

/**
 * PATCH /api/app/posts/[id]/comments/[commentId]   { body }  → { id, editedAt }
 *
 * Edits your own comment (0097). The database is the rule — author only,
 * not a hidden comment — and marks it edited.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const commentId = asId((await params).commentId);
  if (commentId === null) return badRequest("Comment id must be a positive integer.");

  const input = await readJson<{ body?: unknown }>(request);
  if (!input || typeof input.body !== "string") return badRequest("Expected { body }.");

  const result = await editComment({ supabase: auth.supabase, userId: auth.user.id, commentId, body: input.body });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForFeedFailure(result.reason) });
  }
  return Response.json(result.value);
}

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
