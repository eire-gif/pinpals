import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { deletePost, statusForFeedFailure, updatePost } from "@/lib/feed-operations";

/**
 * PATCH  /api/app/posts/[id]   { body?, visibility?, club_id? }
 * DELETE /api/app/posts/[id]
 *
 * The author changes or removes their own post. Deleting is a route rather
 * than a direct delete from the app because the photos have to come out of
 * a private bucket the member's client cannot write to.
 */
type Params = { params: Promise<{ id: string }> };

function failure(result: { reason: Parameters<typeof statusForFeedFailure>[0]; message: string }) {
  return Response.json({ error: result.message, reason: result.reason }, { status: statusForFeedFailure(result.reason) });
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const postId = asId((await params).id);
  if (postId === null) return badRequest("Post id must be a positive integer.");

  const input = await readJson<{ body?: unknown; visibility?: unknown; club_id?: unknown }>(request);
  if (!input) return badRequest("Expected JSON.");

  const result = await updatePost({
    supabase: auth.supabase,
    userId: auth.user.id,
    postId,
    body: typeof input.body === "string" ? input.body : undefined,
    visibility: input.visibility,
    clubId: "club_id" in input ? input.club_id : undefined,
  });
  return result.ok ? Response.json(result.value) : failure(result);
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const postId = asId((await params).id);
  if (postId === null) return badRequest("Post id must be a positive integer.");

  const result = await deletePost({ supabase: auth.supabase, userId: auth.user.id, postId });
  return result.ok ? Response.json({ ok: true }) : failure(result);
}
