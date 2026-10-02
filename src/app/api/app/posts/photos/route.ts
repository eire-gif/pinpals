import { authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { discardStagedPostPhoto, stagePostPhoto, statusForFeedFailure } from "@/lib/feed-operations";

/**
 * POST   /api/app/posts/photos   multipart `file`  → { path, width, height }
 * DELETE /api/app/posts/photos   { path }
 *
 * Stages one photo for a post that is still being written, through the same
 * sharp pipeline as every other photo in PinPals (EXIF and GPS stripped).
 * The staged photo is readable by nobody until POST /api/app/posts moves it
 * under the new post's id. See uploadPendingPostImage().
 */
export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Expected a multipart form with a photo.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("No photo received.");

  const result = await stagePostPhoto({ userId: auth.user.id, file });
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForFeedFailure(result.reason) });
  }
  return Response.json(result.value, { status: 201 });
}

export async function DELETE(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const input = await readJson<{ path?: unknown }>(request);
  if (!input || typeof input.path !== "string") return badRequest("Expected { path }.");

  const result = await discardStagedPostPhoto({ userId: auth.user.id, path: input.path });
  return Response.json({ ok: result.ok || result.reason === "not_found" });
}
