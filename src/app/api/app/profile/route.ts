import { authenticateAppRequest, unauthenticated, badRequest } from "@/lib/app-api";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { applyProfileUpdate } from "@/lib/profile-update";

/**
 * POST /api/app/profile
 *
 * Saves the member's profile from the app. Multipart, with the same field
 * names the website's own form submits, and an optional `avatar` file part.
 *
 * WHY THIS IS A ROUTE AND NOT A CLIENT WRITE. Two reasons, and the second is
 * the important one.
 *
 * The rules are not simple. A home club has to exist in the directory and be
 * in the country claimed; a county has to belong to that country; a handicap
 * has to be a real index; a date of birth has to resolve to an age band. All
 * of that lives in applyProfileUpdate(), shared with the Server Action, so
 * the app and the site cannot come to different conclusions about the same
 * form.
 *
 * THE PHOTO IS THE REAL REASON. `member-avatars` is a public bucket, and a
 * photo chosen from a phone's camera roll carries EXIF, and EXIF carries the
 * GPS coordinates of wherever it was taken. Uploading straight from the
 * device would publish a member's home address to anyone who opened the
 * image URL. Every photo this app stores goes through sharp on the server —
 * the same rule listing photos have followed since that pipeline was
 * written, and the same reason the app must never talk to Storage directly.
 */

const PROFILE_SAVE_MAX = 30;
const PROFILE_SAVE_WINDOW_SECONDS = 3600;

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  // An avatar upload is the one expensive part — decoding and re-encoding an
  // image is real CPU, so this is bounded per member.
  const rateLimit = await checkRateLimit({
    action: "app-profile-save",
    identifier: auth.user.id,
    maxHits: PROFILE_SAVE_MAX,
    windowSeconds: PROFILE_SAVE_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: rateLimitMessage(rateLimit.retryAfterSeconds), reason: "rate_limited" },
      { status: 429 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest("Expected a multipart form body.");
  }

  const result = await applyProfileUpdate(auth.supabase, auth.user.id, formData);

  // 422 rather than 400: the body parsed fine, a rule refused it. The
  // message is written to be shown to the member as-is.
  if (result.error) {
    return Response.json({ error: result.error }, { status: 422 });
  }

  return Response.json({ ok: true }, { status: 200 });
}
