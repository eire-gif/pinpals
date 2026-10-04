import * as ImagePicker from "expo-image-picker";

import { HAS_IMAGE_MANIPULATOR } from "./native-capabilities";

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
 * From the build after 1.0.0 (5), the phone resizes each photo to 2000px on
 * its longest side before upload (expo-image-manipulator, see
 * preparePhotoForUpload). On those builds the picker hands over the
 * original (quality 1) so the photo is only compressed once; older builds
 * keep picking at 0.5.
 */
export const PHOTO_QUALITY = HAS_IMAGE_MANIPULATOR ? 1 : 0.5;

export const PHOTO_PICKER_OPTIONS = {
  mediaTypes: ["images"],
  quality: PHOTO_QUALITY,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
} satisfies ImagePicker.ImagePickerOptions;

/** Just under Vercel's request-body ceiling (4.5 MB), with room for the
 *  multipart envelope. */
export const MAX_UPLOAD_BYTES = 4_300_000;

/** A member-facing reason a picked photo won't upload, or null if it should.
 *  With on-phone resizing every photo becomes a small JPEG, so nothing is
 *  refused. */
export function photoProblem(asset: { fileSize?: number | null; mimeType?: string | null }): string | null {
  if (HAS_IMAGE_MANIPULATOR) return null;
  if (asset.fileSize && asset.fileSize > MAX_UPLOAD_BYTES) {
    return "That photo is too large to send — try a screenshot of it, or a different photo.";
  }
  if (asset.mimeType && !/^image\/(jpeg|png|webp)$/.test(asset.mimeType)) {
    return "That photo's format isn't supported — try a different photo.";
  }
  return null;
}

/** The longest side every server path downscales to anyway. */
const MAX_EDGE = 2000;

export type UploadablePhoto = { uri: string; name: string; type: string };

/**
 * The photo to send: on builds with expo-image-manipulator, resized so its
 * longest side is at most 2000px and saved as a JPEG at 0.8 (a few hundred
 * KB, and HEIC becomes JPEG). On older builds, the photo as picked. A
 * resize that fails sends the original rather than nothing.
 */
export async function preparePhotoForUpload(
  file: UploadablePhoto & { width?: number | null; height?: number | null },
): Promise<UploadablePhoto> {
  if (!HAS_IMAGE_MANIPULATOR) return { uri: file.uri, name: file.name, type: file.type };
  try {
    // Required here, not imported: the module's native half only exists on
    // newer binaries (see native-capabilities.ts).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { manipulateAsync, SaveFormat } = require("expo-image-manipulator") as typeof import("expo-image-manipulator");
    const w = file.width ?? 0;
    const h = file.height ?? 0;
    const resize =
      w > MAX_EDGE || h > MAX_EDGE
        ? [{ resize: w >= h ? { width: MAX_EDGE } : { height: MAX_EDGE } }]
        : w === 0 && h === 0
          ? [{ resize: { width: MAX_EDGE } }]
          : [];
    const out = await manipulateAsync(file.uri, resize, { compress: 0.8, format: SaveFormat.JPEG });
    return { uri: out.uri, name: file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", type: "image/jpeg" };
  } catch {
    return { uri: file.uri, name: file.name, type: file.type };
  }
}
