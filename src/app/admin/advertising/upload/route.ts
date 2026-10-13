import { requireStaff } from "@/lib/admin/authorization";
import { recordAdminAction } from "@/lib/admin/audit";
import { ADVERTISING_EDIT_ROLES } from "@/lib/admin/advertising";
import { CREATIVE_SLOTS, type CreativeSlot } from "@/lib/advertising";
import { processAdCreative } from "@/lib/images/ad-creative";
import { ImageProcessingError } from "@/lib/images/upload";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /admin/advertising/upload (0139) — one advert image.
 *
 * Multipart: `file`, and `slot` (takeover | banner | feed | logo), which
 * decides the shape the image must be. Staff who may edit advertising only.
 * The image is validated, re-encoded with sharp (metadata stripped, see
 * src/lib/images/ad-creative.ts) and stored in the public ad-creatives
 * bucket under a random name; the response carries its public URL for the
 * campaign form to save. The bucket takes no writes from anyone else.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, staff } = await requireStaff({ roles: ADVERTISING_EDIT_ROLES });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a file upload." }, { status: 400 });
  }
  const slot = String(form.get("slot") ?? "") as CreativeSlot;
  if (!CREATIVE_SLOTS.includes(slot)) return Response.json({ error: "Unknown image slot." }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose an image." }, { status: 400 });

  try {
    const image = await processAdCreative(file, slot);
    const path = `${slot}/${crypto.randomUUID()}.${image.extension}`;
    const admin = createAdminClient();
    const { error } = await admin.storage.from("ad-creatives").upload(path, image.buffer, {
      contentType: image.contentType,
      upsert: false,
      cacheControl: "31536000",
    });
    if (error) throw new ImageProcessingError(`Couldn't store that image: ${error.message}`);
    const url = admin.storage.from("ad-creatives").getPublicUrl(path).data.publicUrl;
    await recordAdminAction({
      actor: { id: user.id, role: staff.role },
      action: "ad_creative.uploaded",
      targetType: "ad_campaign",
      metadata: { slot, path, width: image.width, height: image.height, bytes: image.buffer.length },
    });
    return Response.json({ url, width: image.width, height: image.height });
  } catch (err) {
    const message = err instanceof ImageProcessingError ? err.message : "Couldn't upload that image — try a different file.";
    return Response.json({ error: message }, { status: 422 });
  }
}
