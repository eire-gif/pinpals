import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { addComment, statusForFeedFailure } from "@/lib/feed-operations";

/**
 * POST /api/app/posts/[id]/comments   { body, parent_id?, mentions? }  → { id, mentions }
 *
 * `mentions` (0097) are member ids named with @; the database keeps only
 * the ones the commenter may name, and returns that list.
 *
 * A route because the post's author — and, for a reply, the person
 * answered — is notified. See addComment().
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const postId = asId((await params).id);
  if (postId === null) return badRequest("Post id must be a positive integer.");

  const input = await readJson<{ body?: unknown; parent_id?: unknown; mentions?: unknown }>(request);
  if (!input || typeof input.body !== "string") return badRequest("Expected { body }.");
  const parentId = input.parent_id == null ? null : asId(input.parent_id);
  if (input.parent_id != null && parentId === null) return badRequest("parent_id must be a positive integer.");

  const result = await addComment({
    supabase: auth.supabase,
    userId: auth.user.id,
    postId,
    body: input.body,
    parentId,
    mentions: input.mentions,
  });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForFeedFailure(result.reason) });
  }
  return Response.json(result.value, { status: 201 });
}
