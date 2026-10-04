import * as ImagePicker from "expo-image-picker";

/**
 * How every photo leaves the phone — posts, listings, the profile photo and
 * chat photos all pick with these options (tester feedback, 4 Oct 2026:
 * "not all photos loading").
 *
 * WHY. An iPhone 15 Pro shoots 24-megapixel photos; at the old quality of
 * 0.8 one comes out at roughly 4–8 MB. The website refuses photos over 5 MB
 * and Vercel cuts any request body off at about 4.5 MB, so some photos
 * uploaded and some failed with a bare "Retry". Every server path downscales
 * to 2000px and re-encodes anyway, so the extra quality was never seen —
 * 0.5 brings even the largest phone photo comfortably under the limit.
 *
 * "Compatible" asks iOS for a JPEG rather than an HEIC original, which the
 * server would refuse (it takes JPEG, PNG and WebP).
 *
 * The proper fix is resizing on the phone before upload
 * (expo-image-manipulator) — a native module, so it waits for the next
 * TestFlight build. Until then this, plus a clear message when a photo is
 * still too big.
 */
export const PHOTO_QUALITY = 0.5;

export const PHOTO_PICKER_OPTIONS = {
  mediaTypes: ["images"],
  quality: PHOTO_QUALITY,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
} satisfies ImagePicker.ImagePickerOptions;

/** Just under Vercel's request-body ceiling (4.5 MB), with room for the
 *  multipart envelope. */
export const MAX_UPLOAD_BYTES = 4_300_000;

/** A member-facing reason a picked photo won't upload, or null if it should. */
export function photoProblem(asset: { fileSize?: number | null; mimeType?: string | null }): string | null {
  if (asset.fileSize && asset.fileSize > MAX_UPLOAD_BYTES) {
    return "That photo is too large to send — try a screenshot of it, or a different photo.";
  }
  if (asset.mimeType && !/^image\/(jpeg|png|webp)$/.test(asset.mimeType)) {
    return "That photo's format isn't supported — try a different photo.";
  }
  return null;
}
