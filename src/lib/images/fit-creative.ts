import { CREATIVE_SPECS, MAX_CREATIVE_BYTES, type CreativeSlot } from "@/lib/advertising";

/**
 * Fits an advert image to its slot in the browser, before it is uploaded.
 *
 * WHY THIS EXISTS. Adverts are loaded from an iPhone through the app's Admin
 * (the website's admin in the app's web view). The server's rules are strict
 * on purpose — the exact shape within 1%, at least N px wide, 2 MB at most
 * (src/lib/images/ad-creative.ts) — and almost nothing in a phone's photo
 * library meets them: a camera photo is 3:4 and 3–8 MB, a screenshot is
 * 9:19.5, an image saved from an advertiser's email is whatever it is. So
 * every upload from a phone was refused.
 *
 * Here the admin crops to the slot's shape (CreativeCropper, with the
 * position and zoom they choose), and the result is scaled to the slot's
 * ideal size and encoded under the limit. The server still checks and
 * re-encodes whatever arrives — this is the convenience, not the safeguard.
 *
 * The maths is pure and tested (fit-creative.test.ts); renderCreative() is
 * the browser-only part (canvas).
 */

/** The size each slot is stored at. Matches CREATIVE_SPECS[slot].recommended. */
export const CREATIVE_IDEAL_WIDTH: Record<CreativeSlot, number> = {
  takeover: 1080,
  banner: 1200,
  feed: 1080,
  logo: 400,
};

/** Under the server's 2 MB with room to spare: sharp's re-encode can grow a file a little. */
export const CREATIVE_TARGET_BYTES = Math.floor(MAX_CREATIVE_BYTES * 0.85);

/** Pan (0–1 across the room left to move, 0.5 = centred) and zoom (1 = the largest crop that fits). */
export type CropChoice = { panX: number; panY: number; zoom: number };
export const CENTRED: CropChoice = { panX: 0.5, panY: 0.5, zoom: 1 };
export const MAX_ZOOM = 3;

export type Rect = { sx: number; sy: number; sw: number; sh: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** True when the image is already the slot's shape, within the server's 1%. */
export function hasSlotShape(slot: CreativeSlot, width: number, height: number): boolean {
  const spec = CREATIVE_SPECS[slot];
  if (!(width > 0 && height > 0)) return false;
  const want = spec.ratioW / spec.ratioH;
  return Math.abs(width / height - want) / want <= 0.01;
}

/** The part of the source image (in source pixels) that the crop keeps. */
export function cropRect(slot: CreativeSlot, srcW: number, srcH: number, choice: CropChoice = CENTRED): Rect {
  const spec = CREATIVE_SPECS[slot];
  const ratio = spec.ratioW / spec.ratioH;
  const zoom = clamp(choice.zoom, 1, MAX_ZOOM);
  // The largest rectangle of the slot's shape that fits inside the source.
  let sw = srcW / srcH > ratio ? srcH * ratio : srcW;
  let sh = sw / ratio;
  sw /= zoom;
  sh /= zoom;
  const sx = (srcW - sw) * clamp(choice.panX, 0, 1);
  const sy = (srcH - sh) * clamp(choice.panY, 0, 1);
  return { sx, sy, sw, sh };
}

/**
 * Moves the crop by a drag of (dx, dy) in on-screen pixels, where the crop is
 * shown `displayW` pixels wide. Dragging the picture right shows more of its
 * left side, as with any photo cropper.
 */
export function panBy(
  slot: CreativeSlot,
  srcW: number,
  srcH: number,
  choice: CropChoice,
  dx: number,
  dy: number,
  displayW: number,
): CropChoice {
  const r = cropRect(slot, srcW, srcH, choice);
  const perScreenPx = r.sw / displayW; // source pixels per on-screen pixel
  const roomX = srcW - r.sw;
  const roomY = srcH - r.sh;
  const sx = r.sx - dx * perScreenPx;
  const sy = r.sy - dy * perScreenPx;
  return {
    zoom: choice.zoom,
    panX: roomX > 0 ? clamp(sx / roomX, 0, 1) : 0.5,
    panY: roomY > 0 ? clamp(sy / roomY, 0, 1) : 0.5,
  };
}

/**
 * The output size for a crop: the slot's ideal width, or the crop's own width
 * if that is smaller (never enlarged). An error when the crop is narrower than
 * the slot's minimum — enlarging a small image would only make it blurry.
 */
export function outputSize(slot: CreativeSlot, crop: Rect): { width: number; height: number } | { error: string } {
  const spec = CREATIVE_SPECS[slot];
  const cropW = Math.floor(crop.sw);
  if (cropW < spec.minWidth) {
    return {
      error: `That crop is only ${cropW} px wide. ${spec.label} needs at least ${spec.minWidth} px — zoom out, or use a bigger image (${spec.recommended} is ideal).`,
    };
  }
  const width = Math.min(CREATIVE_IDEAL_WIDTH[slot], cropW);
  const height = Math.round((width * spec.ratioH) / spec.ratioW);
  return { width, height };
}

/** JPEG qualities to try, best first, until the file is small enough. */
export const JPEG_QUALITIES = [0.9, 0.84, 0.78, 0.7, 0.6] as const;

/** Keep PNG only where transparency is likely to matter (a logo, or a PNG source); everything else is JPEG. */
export function preferPng(slot: CreativeSlot, sourceType: string): boolean {
  return slot === "logo" && sourceType === "image/png";
}

// ---------------------------------------------------------------------------
// Browser only
// ---------------------------------------------------------------------------

/** Opens an image file for cropping. Applies the EXIF orientation, so a portrait photo isn't on its side. */
export async function openImage(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Couldn't open that image — try a JPEG or PNG.");
  }
}

/** Draws the crop at its output size and encodes it under the size limit. */
export async function renderCreative(
  bitmap: ImageBitmap,
  slot: CreativeSlot,
  choice: CropChoice,
  source: { name: string; type: string },
): Promise<File> {
  const crop = cropRect(slot, bitmap.width, bitmap.height, choice);
  const size = outputSize(slot, crop);
  if ("error" in size) throw new Error(size.error);

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare that image on this device.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const toBlob = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const base = source.name.replace(/\.[^.]*$/, "") || "advert";

  if (preferPng(slot, source.type)) {
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size.width, size.height);
    const png = await toBlob("image/png");
    if (png && png.size <= CREATIVE_TARGET_BYTES) return new File([png], `${base}.png`, { type: "image/png" });
  }

  // JPEG has no transparency: fill white first so a transparent PNG doesn't come out black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size.width, size.height);
  for (const q of JPEG_QUALITIES) {
    const jpg = await toBlob("image/jpeg", q);
    if (jpg && jpg.size <= CREATIVE_TARGET_BYTES) return new File([jpg], `${base}.jpg`, { type: "image/jpeg" });
  }
  throw new Error("Couldn't get that image under 2 MB — try a simpler image.");
}
