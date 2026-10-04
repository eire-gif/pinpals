import { authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { createPost, statusForFeedFailure } from "@/lib/feed-operations";

/**
 * POST /api/app/posts   { body, visibility, club_id, photo_paths, kind?, details?, video? }
 *
 * `video` (0102) is { path, duration_ms?, width?, height? }: the path from
 * POST /api/app/posts/videos, after the phone has uploaded to it.
 *
 * `kind` and `details` (0095) are a round, hole or shot and its golf facts —
 * shapes in src/lib/post-details.ts. Absent means a general post, so older
 * app builds keep working unchanged.
 *
 * A new post from the app. `photo_paths` are what /api/app/posts/photos
 * handed back, one request per photo beforehand — a request to a Vercel
 * function cannot carry six phone photos at once.
 *
 * WHY THIS IS A ROUTE. The row could be written straight from the app
 * (0088's INSERT policy would allow it), but the photos could not: the
 * bucket is private and only the service role writes it. Doing both here, in
 * createPost(), is also what makes a post with photos all-or-nothing.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const input = await readJson<{
    body?: unknown;
    visibility?: unknown;
    club_id?: unknown;
    photo_paths?: unknown;
    kind?: unknown;
    details?: unknown;
    video?: unknown;
  }>(request);
  if (!input) return badRequest("Expected JSON.");

  const result = await createPost({
    supabase: auth.supabase,
    userId: auth.user.id,
    body: typeof input.body === "string" ? input.body : "",
    visibility: input.visibility,
    clubId: input.club_id,
    photoPaths: input.photo_paths ?? [],
    kind: input.kind,
    details: input.details,
    video: input.video,
  });

  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForFeedFailure(result.reason) });
  }
  return Response.json(result.value, { status: 201 });
}
