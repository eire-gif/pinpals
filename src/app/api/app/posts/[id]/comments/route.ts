import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { addComment, statusForFeedFailure } from "@/lib/feed-operations";

/**
 * POST /api/app/posts/[id]/comments   { body }  → { id }
 *
 * A route because the post's author is notified — see addComment().
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const postId = asId((await params).id);
  if (postId === null) return badRequest("Post id must be a positive integer.");

  const input = await readJson<{ body?: unknown }>(request);
  if (!input || typeof input.body !== "string") return badRequest("Expected { body }.");

  const result = await addComment({ supabase: auth.supabase, userId: auth.user.id, postId, body: input.body });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForFeedFailure(result.reason) });
  }
  return Response.json(result.value, { status: 201 });
}
