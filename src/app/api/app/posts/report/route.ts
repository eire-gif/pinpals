import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { reportFeedContent, statusForFeedFailure } from "@/lib/feed-operations";

/**
 * POST /api/app/posts/report   { target: "post" | "post_comment", target_id, category, description? }
 *
 * Into the same moderation queue as every other report. The reporter must
 * be able to see what they report — see reportFeedContent().
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const input = await readJson<{ target?: unknown; target_id?: unknown; category?: unknown; description?: unknown }>(request);
  if (!input) return badRequest("Expected JSON.");

  const target = input.target === "post" || input.target === "post_comment" ? input.target : null;
  const targetId = asId(input.target_id);
  if (!target || targetId === null) return badRequest("Expected a post or comment to report.");

  const result = await reportFeedContent({
    supabase: auth.supabase,
    userId: auth.user.id,
    target,
    targetId,
    category: typeof input.category === "string" ? input.category : "",
    description: typeof input.description === "string" ? input.description : "",
  });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForFeedFailure(result.reason) });
  }
  return Response.json({ ok: true }, { status: 201 });
}
