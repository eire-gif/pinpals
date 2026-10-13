import "server-only";
import sharp, { type OutputInfo } from "sharp";
import { ALLOWED_IMAGE_TYPES } from "@/lib/marketplace";
import { CREATIVE_SPECS, MAX_CREATIVE_BYTES, checkCreativeDimensions, type CreativeSlot } from "@/lib/advertising";
import { ImageProcessingError, type ProcessedImage } from "./upload";

/**
 * Advert creatives (0139), the same pipeline as listing photos
 * (processListingImage in ./upload.ts): validate the file, decode it with
 * sharp (the declared type is the browser's word, not proof), check its
 * shape for the slot, then re-encode — auto-oriented, metadata stripped by
 * construction (sharp never carries EXIF/IPTC/XMP through without
 * .withMetadata(), which this never calls). The longest edge is capped so a
 * 6000 px export doesn't sit in a public bucket; the shape is kept exactly.
 */

const MAX_EDGE = 2400;

const EXTENSION: Record<(typeof ALLOWED_IMAGE_TYPES)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function processAdCreative(file: File, slot: CreativeSlot): Promise<ProcessedImage & { width: number; height: number }> {
  if (file.size === 0) throw new ImageProcessingError("That file is empty.");
  if (file.size > MAX_CREATIVE_BYTES) throw new ImageProcessingError("Advert images must be 2 MB or smaller.");
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new ImageProcessingError("Advert images must be JPEG, PNG or WEBP.");
  }
  const contentType = file.type as (typeof ALLOWED_IMAGE_TYPES)[number];
  const input = Buffer.from(await file.arrayBuffer());

  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(input, { failOn: "truncated" }).metadata();
    // EXIF orientations 5–8 are rotated a quarter turn: the picture as seen is the other way round.
    const turned = (meta.orientation ?? 1) >= 5;
    width = (turned ? meta.height : meta.width) ?? 0;
    height = (turned ? meta.width : meta.height) ?? 0;
  } catch {
    throw new ImageProcessingError("That file doesn't look like a valid image.");
  }

  const problem = checkCreativeDimensions(slot, width, height);
  if (problem) throw new ImageProcessingError(problem);

  let pipeline = sharp(input, { failOn: "truncated" })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true });
  if (contentType === "image/png") pipeline = pipeline.png({ compressionLevel: 9, palette: false });
  else if (contentType === "image/webp") pipeline = pipeline.webp({ quality: 88 });
  else pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true });

  let buffer: Buffer;
  let out: OutputInfo;
  try {
    ({ data: buffer, info: out } = await pipeline.toBuffer({ resolveWithObject: true }));
  } catch {
    throw new ImageProcessingError("Couldn't process that image — try a different file.");
  }
  if (buffer.length > MAX_CREATIVE_BYTES) {
    throw new ImageProcessingError(`That image is over 2 MB once processed. Try a JPEG at ${CREATIVE_SPECS[slot].recommended}.`);
  }
  return { buffer, contentType, extension: EXTENSION[contentType], width: out.width, height: out.height };
}
