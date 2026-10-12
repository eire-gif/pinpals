import { asId, authenticateAppRequest, badRequest, unauthenticated } from "@/lib/app-api";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { MAX_AVATAR_BYTES } from "@/lib/avatar";
import { ImageProcessingError, processAvatarImage, processMessageImage } from "@/lib/images/upload";

/**
 * POST /api/app/groups/[id]/image (0124)
 *
 * A group's cover photo or logo. Multipart: `which` = cover | logo, and an
 * `image` file part, or `remove=on` to go back to the default.
 *
 * Through the server for the profile cover's reason (../../../profile/cover):
 * the bucket is public and a camera-roll photo carries GPS in its EXIF. The
 * image is re-encoded by sharp with no metadata — a cover at 1600 px on the
 * long edge, a logo at 512 — and stored in the uploader's own folder of
 * member-avatars under a timestamped group- name. set_group_image(), called
 * as the member, decides whether they may (society: owner, captain or
 * secretary; crew or trip: owner or admin) and checks the file is theirs.
 *
 * The permission check runs before the upload too, so a member who can't
 * change the group doesn't leave a file behind in Storage.
 */

const SAVE_MAX = 20;
const SAVE_WINDOW_SECONDS = 3600;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();
  const groupId = asId((await params).id);
  if (groupId === null) return badRequest("id must be a positive integer");

  const rateLimit = await checkRateLimit({
    action: "app-group-image",
    identifier: auth.user.id,
    maxHits: SAVE_MAX,
    windowSeconds: SAVE_WINDOW_SECONDS,
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
  const which = formData.get("which");
  if (which !== "cover" && which !== "logo") return badRequest("which must be cover or logo");

  // Who may change it: the same check set_group_image() makes, asked first.
  const { data: member } = await auth.supabase
    .from("group_members")
    .select("role, office, group:groups(kind)")
    .eq("group_id", groupId)
    .eq("member_id", auth.user.id)
    .maybeSingle<{ role: string; office: string | null; group: { kind: string } | null }>();
  const allowed =
    member != null &&
    (member.group?.kind === "society" ? member.role === "owner" || member.office != null : member.role === "owner" || member.role === "admin");
  if (!allowed) {
    const society = member?.group?.kind === "society";
    return Response.json(
      { error: society ? "Only the society's captain or secretary can change its photo and logo." : "Only whoever runs the group can change its photo and logo." },
      { status: 403 }
    );
  }

  let url: string | null = null;
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    try {
      const { buffer, contentType, extension } = which === "logo" ? await processAvatarImage(image) : await processMessageImage(image);
      if (buffer.length > MAX_AVATAR_BYTES) {
        return Response.json({ error: "That photo is too large even after resizing — try another." }, { status: 422 });
      }
      const path = `${auth.user.id}/group-${groupId}-${which}-${Date.now()}.${extension}`;
      const { error } = await auth.supabase.storage.from("member-avatars").upload(path, buffer, { contentType, upsert: false });
      if (error) throw new ImageProcessingError(`Couldn't upload that photo: ${error.message}`);
      url = auth.supabase.storage.from("member-avatars").getPublicUrl(path).data.publicUrl;
    } catch (err) {
      return Response.json(
        { error: err instanceof ImageProcessingError ? err.message : "Couldn't upload that photo — please try a different one." },
        { status: 422 }
      );
    }
  } else if (formData.get("remove") !== "on") {
    return badRequest("Choose a photo, or remove the current one.");
  }

  const { error } = await auth.supabase.rpc("set_group_image", { p_group_id: groupId, p_which: which, p_url: url });
  if (error) return Response.json({ error: error.message || "Couldn't save that. Please try again." }, { status: 422 });

  return Response.json({ ok: true, url }, { status: 200 });
}
