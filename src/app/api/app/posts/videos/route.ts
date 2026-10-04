import { authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_POST_VIDEO_BYTES, createPostVideoUpload, discardPendingPostVideo, isPostVideoType } from "@/lib/videos";

/**
 * POST   /api/app/posts/videos   { content_type, size? }  → { path, token, signed_url }
 * DELETE /api/app/posts/videos   { path }
 *
 * A signed upload URL for one post video (0102). The phone uploads the file
 * straight to the private `post-videos` bucket with it: the file is tens of
 * megabytes, far more than a Vercel function takes in a request body. The
 * path is the member's own staging folder, which nobody can read; posting
 * (POST /api/app/posts with `video`) moves it under the post.
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const input = await readJson<{ content_type?: unknown; size?: unknown }>(request);
  if (!input) return badRequest("Expected { content_type }.");
  if (!isPostVideoType(input.content_type)) {
    return Response.json({ error: "Videos need to be MP4 or MOV.", reason: "invalid" }, { status: 400 });
  }
  if (typeof input.size === "number" && input.size > MAX_POST_VIDEO_BYTES) {
    return Response.json({ error: "That video is too large — keep it under 30 seconds.", reason: "invalid" }, { status: 400 });
  }

  // Shares the posting ceiling's spirit: a few videos an hour is plenty.
  const limit = await checkRateLimit({ action: "post-video", identifier: auth.user.id, maxHits: 20, windowSeconds: 3600 });
  if (!limit.allowed) {
    return Response.json({ error: rateLimitMessage(limit.retryAfterSeconds), reason: "rate_limited" }, { status: 429 });
  }

  const upload = await createPostVideoUpload(createAdminClient(), auth.user.id, input.content_type);
  if (!upload) return Response.json({ error: "Couldn't start the upload — please try again.", reason: "failed" }, { status: 502 });
  return Response.json({ path: upload.path, token: upload.token, signed_url: upload.signedUrl }, { status: 201 });
}

export async function DELETE(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const input = await readJson<{ path?: unknown }>(request);
  if (!input) return badRequest("Expected { path }.");
  const ok = await discardPendingPostVideo(createAdminClient(), auth.user.id, input.path);
  return Response.json({ ok });
}
