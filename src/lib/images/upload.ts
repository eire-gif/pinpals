import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE_BYTES } from "@/lib/marketplace";

/**
 * Server-only listing-photo pipeline: validate -> re-encode (strip
 * metadata, cap dimensions) -> upload to the "listing-images" Storage
 * bucket. Used by the create/edit listing Server Actions
 * (src/app/marketplace/new/actions.ts, src/app/marketplace/[id]/edit/actions.ts)
 * — every listing photo goes through here, never a raw
 * `supabase.storage.from(...).upload()` of the original file, so there's
 * exactly one place metadata-stripping can be forgotten rather than one per
 * call site.
 *
 * The "responsive variants" half of the task spec is handled by next/image
 * at render time (see next.config.ts's images.remotePatterns addition,
 * this same task) rather than by pre-generating multiple stored sizes here
 * — this module still caps the stored image at LISTING_IMAGE_MAX_DIMENSION
 * so an original multi-megapixel phone photo doesn't sit in Storage (and
 * get repeatedly re-fetched/re-optimised) at full size for no reason.
 */

export class ImageProcessingError extends Error {}

/** Longest edge, in pixels, a stored listing photo is capped to — large
 * enough that next/image's own responsive downscaling still has real detail
 * to work with, small enough that a 12MP phone photo doesn't get stored (and
 * billed, and repeatedly transferred) at its original size for no visual
 * benefit at the sizes this app ever displays a listing photo. Downscale
 * only — see resize()'s withoutEnlargement below, a smaller source image is
 * never upscaled. */
export const LISTING_IMAGE_MAX_DIMENSION = 2000;

const EXTENSION_BY_TYPE: Record<(typeof ALLOWED_IMAGE_TYPES)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function isAllowedImageType(type: string): type is (typeof ALLOWED_IMAGE_TYPES)[number] {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

export type ProcessedImage = {
  buffer: Buffer;
  contentType: (typeof ALLOWED_IMAGE_TYPES)[number];
  extension: string;
};

/**
 * Validates a single uploaded photo and re-encodes it: auto-orients from
 * the EXIF orientation tag (baking the correct rotation into the actual
 * pixels), caps the longest edge at LISTING_IMAGE_MAX_DIMENSION, and
 * re-encodes in its original format. Metadata stripping isn't a separate
 * step — sharp only carries EXIF/IPTC/XMP (camera model, GPS coordinates,
 * capture timestamp, ...) through to the output when `.withMetadata()` is
 * explicitly called, which this never does, so every re-encoded output is
 * metadata-free by construction, not by a step that could be skipped.
 *
 * Throws ImageProcessingError (safe to show its .message directly to the
 * seller) for anything the seller can fix by picking a different file;
 * never throws sharp's own raw error text.
 */
export async function processListingImage(file: File): Promise<ProcessedImage> {
  if (file.size === 0) {
    throw new ImageProcessingError("That file is empty.");
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new ImageProcessingError(`Photos must be under ${Math.round(MAX_IMAGE_SIZE_BYTES / (1024 * 1024))}MB.`);
  }
  if (!isAllowedImageType(file.type)) {
    throw new ImageProcessingError("Photos must be JPEG, PNG, or WEBP.");
  }

  const input = Buffer.from(await file.arrayBuffer());

  let pipeline: ReturnType<typeof sharp>;
  try {
    // failOn: "truncated" rejects a partially-downloaded/corrupt file
    // outright rather than silently encoding whatever bytes did decode.
    pipeline = sharp(input, { failOn: "truncated" });
    // Forces sharp to actually decode the header now, inside this try —
    // the file's declared Content-Type (file.type, checked above) is
    // client-supplied and not proof the bytes are really an image.
    await pipeline.metadata();
  } catch {
    throw new ImageProcessingError("That file doesn't look like a valid image.");
  }

  pipeline = sharp(input, { failOn: "truncated" })
    .rotate()
    .resize({
      width: LISTING_IMAGE_MAX_DIMENSION,
      height: LISTING_IMAGE_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });

  const contentType = file.type;
  if (contentType === "image/png") {
    pipeline = pipeline.png({ quality: 85, compressionLevel: 8 });
  } else if (contentType === "image/webp") {
    pipeline = pipeline.webp({ quality: 85 });
  } else {
    pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
  }

  let buffer: Buffer;
  try {
    buffer = await pipeline.toBuffer();
  } catch {
    throw new ImageProcessingError("Couldn't process that photo — try a different file.");
  }

  return { buffer, contentType, extension: EXTENSION_BY_TYPE[contentType] };
}

/**
 * Processes and uploads one listing photo, returning its public URL and
 * Storage path. Path convention (`${userId}/${uuid}.${ext}`) matches what
 * storage.objects' ownership policies key on (0003_marketplace.sql) — the
 * first path segment has to be the uploader's own auth.uid() or the upload
 * is rejected by RLS regardless of what this function does.
 *
 * `userId` is taken as a parameter rather than re-derived from `supabase`
 * here so this stays usable with either the request-scoped client (an
 * ordinary create/edit) or, in principle, the admin client — the caller is
 * always the one that already knows, and has already authorized, which
 * user's folder this upload belongs in.
 */
export async function uploadListingImage(
  supabase: SupabaseClient,
  userId: string,
  file: File
): Promise<{ url: string; path: string }> {
  const { buffer, contentType, extension } = await processListingImage(file);
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from("listing-images")
    .upload(path, buffer, { contentType, upsert: false });

  if (error) {
    throw new ImageProcessingError(`Couldn't upload photo: ${error.message}`);
  }

  const { data } = supabase.storage.from("listing-images").getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/** Recovers a "listing-images" Storage object path from its public URL
 * (".../storage/v1/object/public/listing-images/<path>"). listing_images
 * (0036) only stores image_url, never the raw Storage path, so the edit
 * flow needs this to clean up Storage when a previously-attached photo is
 * removed from a listing. Returns null for anything that doesn't look like
 * one of this bucket's own public URLs — never guessed at or partially
 * matched, since a wrong guess here means deleteListingImage() could be
 * pointed at an unrelated path. */
export function listingImageStoragePath(publicUrl: string): string | null {
  const marker = "/storage/v1/object/public/listing-images/";
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;
  return decodeURIComponent(publicUrl.slice(index + marker.length));
}

/** Removes a previously-uploaded listing photo — used by the edit flow's
 * "retry/replace/remove image" actions and by a failed multi-image upload's
 * own cleanup (don't leave an orphaned Storage object behind when a later
 * image in the same batch fails and the whole submission is abandoned).
 * `path` is the Storage object path (uploadListingImage()'s return value),
 * not a public URL. */
export async function deleteListingImage(supabase: SupabaseClient, path: string): Promise<void> {
  // Best-effort: an orphaned Storage object is a cleanup nicety, never
  // something worth failing the caller's own (usually more important)
  // action over.
  await supabase.storage.from("listing-images").remove([path]);
}
