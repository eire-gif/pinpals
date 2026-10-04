import { asId, authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { reportCourseReview } from "@/lib/course-reviews";

/**
 * POST /api/app/course-reviews/report   { review_id, category, description? }
 *
 * A route rather than a client write because `reports` is not member-
 * writable — every report goes in through the service role, after checking
 * the reporter can actually see what they're reporting.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const input = await readJson<{ review_id?: unknown; category?: unknown; description?: unknown }>(request);
  if (!input) return badRequest("Expected JSON.");

  const reviewId = asId(input.review_id);
  if (reviewId === null) return badRequest("Expected a review to report.");

  const result = await reportCourseReview({
    supabase: auth.supabase,
    userId: auth.user.id,
    reviewId,
    category: typeof input.category === "string" ? input.category : "",
    description: typeof input.description === "string" ? input.description : "",
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: 422 });
  return Response.json({ ok: true }, { status: 201 });
}
