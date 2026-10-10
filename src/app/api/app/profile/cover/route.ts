import { authenticateAppRequest, unauthenticated, badRequest } from "@/lib/app-api";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { MAX_AVATAR_BYTES } from "@/lib/avatar";
import { ImageProcessingError, processMessageImage } from "@/lib/images/upload";

/**
 * POST /api/app/profile/cover (0112)
 *
 * The photograph across the top of a member's profile. Multipart: a `cover`
 * file part, or `remove=on` to go back to the default.
 *
 * Through the server for the avatar's reason (see ../route.ts): the bucket
 * is public, a camera-roll photo carries EXIF, EXIF carries GPS. The image
 * is re-encoded by sharp — 1600 px on the long edge, no metadata — and
 * stored in the member's own folder of member-avatars under a timestamped
 * name (a stable name would be served stale from every cache).
 */

const COVER_SAVE_MAX = 20;
const COVER_SAVE_WINDOW_SECONDS = 3600;

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const rateLimit = await checkRateLimit({
    action: "app-profile-cover",
    identifier: auth.user.id,
    maxHits: COVER_SAVE_MAX,
    windowSeconds: COVER_SAVE_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return Response.json({ error: rateLimitMessage(rateLimit.retryAfterSeconds), reason: "rate_limited" }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest("Expected a multipart form body.");
  }

  let coverUrl: string | null = null;
  const cover = formData.get("cover");
  if (cover instanceof File && cover.size > 0) {
    try {
      const { buffer, contentType, extension } = await processMessageImage(cover);
      if (buffer.length > MAX_AVATAR_BYTES) {
        return Response.json({ error: "That photo is too large even after resizing — try another." }, { status: 422 });
      }
      const path = `${auth.user.id}/cover-${Date.now()}.${extension}`;
      const { error } = await auth.supabase.storage.from("member-avatars").upload(path, buffer, { contentType, upsert: false });
      if (error) throw new ImageProcessingError(`Couldn't upload that photo: ${error.message}`);
      coverUrl = auth.supabase.storage.from("member-avatars").getPublicUrl(path).data.publicUrl;
    } catch (err) {
      return Response.json(
        { error: err instanceof ImageProcessingError ? err.message : "Couldn't upload that photo — please try a different one." },
        { status: 422 }
      );
    }
  } else if (formData.get("remove") !== "on") {
    return badRequest("Choose a photo, or remove the current one.");
  }

  const { error } = await auth.supabase.from("profiles").update({ cover_url: coverUrl }).eq("id", auth.user.id);
  if (error) return Response.json({ error: "Couldn't save that. Please try again." }, { status: 500 });

  return Response.json({ ok: true, coverUrl }, { status: 200 });
}
