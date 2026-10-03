/**
 * Downscales a photo in the browser before it is uploaded.
 *
 * WHY THIS EXISTS. Every photo upload on the website goes through a Server
 * Action or a Route Handler, and both have a ceiling well below what a phone
 * camera produces: a Server Action refuses any request body over its
 * `bodySizeLimit` (Next's default is 1MB), and Vercel refuses any function
 * request over 4.5MB. A modern phone photo is 3–8MB. Before this, a
 * full-size photo picked on the "List an item" page never reached
 * uploadListingImage() at all — the action threw before it ran, and the
 * tile sat on "Uploading…" forever.
 *
 * The server still re-encodes and strips metadata with sharp whatever
 * arrives (src/lib/images/upload.ts). Re-drawing on a canvas here also drops
 * EXIF, but that is a side effect, not the safeguard: a request does not
 * have to come from this page.
 *
 * Browser-only (canvas, createImageBitmap). Never throws: anything it
 * cannot decode — HEIC on most desktop browsers, a corrupt file — comes back
 * unchanged, and the server answers for it with a message the member can
 * act on.
 */

export type ShrinkOptions = {
  /** Longest edge, in pixels. Defaults to 2000, which matches what the
   *  server stores for listing and feed photos, so nothing is lost. */
  maxEdge?: number;
  /** JPEG quality, 0–1. */
  quality?: number;
  /** A file already this small and within maxEdge is sent as it is. */
  keepBelowBytes?: number;
};

export async function shrinkForUpload(file: File, options: ShrinkOptions = {}): Promise<File> {
  const { maxEdge = 2000, quality = 0.86, keepBelowBytes = 900 * 1024 } = options;

  if (typeof window === "undefined" || !file.type.startsWith("image/") || file.type === "image/gif") {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    // from-image applies the EXIF orientation, so a portrait photo is not
    // drawn on its side once the orientation tag is gone.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= keepBelowBytes) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;

    // JPEG has no transparency; a transparent PNG would otherwise come out
    // with a black background.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]*$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}

/** The message to show when an upload request itself failed — the action
 *  threw rather than returning an error, which in practice means the
 *  request never reached the server's own checks (too large, or offline). */
export const UPLOAD_FAILED_MESSAGE = "Couldn't upload that photo — check your connection, or try a smaller photo.";
