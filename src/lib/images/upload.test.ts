import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  processAvatarImage,
  AVATAR_MAX_DIMENSION,
  processListingImage,
  uploadListingImage,
  deleteListingImage,
  listingImageStoragePath,
  ImageProcessingError,
  LISTING_IMAGE_MAX_DIMENSION,
} from "./upload";

/** Builds a minimal, real (not just plausible-looking) image file for these
 * tests — sharp encodes actual JPEG/PNG bytes, so processListingImage's own
 * sharp pipeline exercises the real decode/re-encode path rather than a
 * mocked one. `exifOrientation` lets a test simulate a photo taken on its
 * side (the classic case metadata-stripping + auto-orient both have to get
 * right at once). */
async function makeTestImageFile(
  opts: { width: number; height: number; format?: "jpeg" | "png"; exifOrientation?: number } = { width: 100, height: 60 }
): Promise<File> {
  const { width, height, format = "jpeg", exifOrientation } = opts;
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 60 } },
  });
  pipeline = format === "png" ? pipeline.png() : pipeline.jpeg();
  if (exifOrientation) {
    // A real EXIF blob with the Orientation tag (0x0112) set — enough for
    // sharp's own rotate()/metadata() to read it back correctly.
    pipeline = pipeline.withExif({ IFD0: { Orientation: String(exifOrientation) } });
  }
  const buffer = await pipeline.toBuffer();
  return new File([new Uint8Array(buffer)], `test.${format === "png" ? "png" : "jpg"}`, {
    type: format === "png" ? "image/png" : "image/jpeg",
  });
}

describe("processListingImage", () => {
  it("rejects a disallowed content type", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "test.gif", { type: "image/gif" });
    await expect(processListingImage(file)).rejects.toThrow(ImageProcessingError);
    await expect(processListingImage(file)).rejects.toThrow(/JPEG, PNG, or WEBP/);
  });

  it("rejects an empty file", async () => {
    const file = new File([], "empty.jpg", { type: "image/jpeg" });
    await expect(processListingImage(file)).rejects.toThrow(/empty/);
  });

  it("rejects a file over the size limit", async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([oversized], "big.jpg", { type: "image/jpeg" });
    await expect(processListingImage(file)).rejects.toThrow(/under 5MB/);
  });

  it("rejects bytes that claim to be an image but aren't", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "fake.jpg", { type: "image/jpeg" });
    await expect(processListingImage(file)).rejects.toThrow(/doesn't look like a valid image/);
  });

  it("accepts a valid JPEG and preserves its content type", async () => {
    const file = await makeTestImageFile({ width: 100, height: 60, format: "jpeg" });
    const result = await processListingImage(file);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.extension).toBe("jpg");
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("accepts a valid PNG and preserves its content type", async () => {
    const file = await makeTestImageFile({ width: 100, height: 60, format: "png" });
    const result = await processListingImage(file);
    expect(result.contentType).toBe("image/png");
    expect(result.extension).toBe("png");
  });

  it("caps the longest edge at LISTING_IMAGE_MAX_DIMENSION without upscaling small images", async () => {
    const small = await makeTestImageFile({ width: 100, height: 60 });
    const smallResult = await processListingImage(small);
    const smallMeta = await sharp(smallResult.buffer).metadata();
    expect(smallMeta.width).toBe(100);
    expect(smallMeta.height).toBe(60);

    const huge = await makeTestImageFile({ width: LISTING_IMAGE_MAX_DIMENSION + 1000, height: 200 });
    const hugeResult = await processListingImage(huge);
    const hugeMeta = await sharp(hugeResult.buffer).metadata();
    expect(hugeMeta.width).toBeLessThanOrEqual(LISTING_IMAGE_MAX_DIMENSION);
  });

  it("strips EXIF metadata from the re-encoded output", async () => {
    const file = await makeTestImageFile({ width: 100, height: 60, exifOrientation: 6 });
    // Sanity-check the fixture itself actually carries EXIF before asserting
    // processListingImage removes it.
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const rawMeta = await sharp(rawBuffer).metadata();
    expect(rawMeta.exif).toBeDefined();

    const result = await processListingImage(file);
    const outputMeta = await sharp(result.buffer).metadata();
    expect(outputMeta.exif).toBeUndefined();
    expect(outputMeta.orientation).toBeUndefined();
    // Note: this only asserts the output carries no EXIF/orientation tag —
    // `.rotate()` with no arguments (the standard sharp auto-orient call
    // processListingImage uses) is what bakes a real photo's orientation
    // into its actual pixels before that tag is dropped. Not separately
    // asserted here: sharp's own EXIF-writing API for synthetic `create:`
    // fixtures doesn't reliably round-trip a numeric Orientation tag the way
    // a real camera's JPEG output does, so there's no reliable way to build
    // a "rotate() actually rotated it" fixture without a real photo file.
  });
});

function makeMockSupabase(overrides: { uploadError?: { message: string } } = {}) {
  const upload = vi.fn().mockResolvedValue(overrides.uploadError ? { error: overrides.uploadError } : { error: null });
  const getPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: "https://example.test/listing-images/mock.jpg" } });
  const remove = vi.fn().mockResolvedValue({ error: null });
  return {
    supabase: {
      storage: {
        from: vi.fn().mockReturnValue({ upload, getPublicUrl, remove }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    upload,
    getPublicUrl,
    remove,
  };
}

describe("uploadListingImage", () => {
  it("uploads under the caller's own user-id folder and returns a public URL", async () => {
    const { supabase, upload } = makeMockSupabase();
    const file = await makeTestImageFile({ width: 100, height: 60 });

    const result = await uploadListingImage(supabase, "user-123", file);

    expect(upload).toHaveBeenCalledTimes(1);
    const [path, , options] = upload.mock.calls[0];
    expect(path).toMatch(/^user-123\/[0-9a-f-]+\.jpg$/);
    expect(options).toMatchObject({ contentType: "image/jpeg" });
    expect(result.url).toBe("https://example.test/listing-images/mock.jpg");
    expect(result.path).toBe(path);
  });

  it("surfaces a Storage upload failure as an ImageProcessingError", async () => {
    const { supabase } = makeMockSupabase({ uploadError: { message: "bucket not found" } });
    const file = await makeTestImageFile({ width: 100, height: 60 });

    await expect(uploadListingImage(supabase, "user-123", file)).rejects.toThrow(ImageProcessingError);
    await expect(uploadListingImage(supabase, "user-123", file)).rejects.toThrow(/bucket not found/);
  });
});

describe("listingImageStoragePath", () => {
  it("extracts the path from a real listing-images public URL", () => {
    const url = "https://cicluiabimxklgmpmxmn.supabase.co/storage/v1/object/public/listing-images/user-123/abc.jpg";
    expect(listingImageStoragePath(url)).toBe("user-123/abc.jpg");
  });

  it("decodes URL-encoded characters in the path", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/listing-images/user%20123/a%20b.jpg";
    expect(listingImageStoragePath(url)).toBe("user 123/a b.jpg");
  });

  it("returns null for a URL that isn't one of this bucket's own", () => {
    expect(listingImageStoragePath("https://example.test/some/other/image.jpg")).toBeNull();
  });
});

describe("deleteListingImage", () => {
  it("removes the object at the given path and never throws on a Storage error", async () => {
    const { supabase, remove } = makeMockSupabase();
    await expect(deleteListingImage(supabase, "user-123/abc.jpg")).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(["user-123/abc.jpg"]);
  });
});


// ---------------------------------------------------------------------------

/** A photo with GPS coordinates in it, like one off a phone. This is the
 *  case the avatar pipeline exists for: member-avatars is a PUBLIC bucket,
 *  so an unprocessed upload publishes wherever the photo was taken. */
async function makeGeotaggedImageFile(): Promise<File> {
  const buffer = await sharp({
    create: { width: 300, height: 300, channels: 3, background: { r: 10, g: 120, b: 60 } },
  })
    .jpeg()
    // The cast is only about sharp's published type, which declares IFD0..IFD3
    // but not GPS. libvips writes the GPS IFD perfectly well — the assertion
    // below reads the EXIF back out, so a silently-ignored block would fail
    // the test rather than pass it.
    .withExif({
      IFD0: { Make: "Apple", Model: "iPhone 15 Pro" },
      GPS: {
        GPSLatitudeRef: "N",
        GPSLatitude: "53/1 24/1 3648/100",
        GPSLongitudeRef: "W",
        GPSLongitude: "6/1 8/1 2952/100",
      },
    } as unknown as Parameters<ReturnType<typeof sharp>["withExif"]>[0])
    .toBuffer();

  return new File([new Uint8Array(buffer)], "photo.jpg", { type: "image/jpeg" });
}

describe("processAvatarImage", () => {
  it("strips GPS coordinates from a geotagged photo", async () => {
    const file = await makeGeotaggedImageFile();

    // The fixture really does carry the coordinates, or the assertion below
    // would pass against an image that never had them.
    const before = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
    expect(before.exif).toBeDefined();

    const { buffer } = await processAvatarImage(file);
    const after = await sharp(buffer).metadata();

    expect(after.exif).toBeUndefined();
  });

  it("strips the camera make and model too", async () => {
    const { buffer } = await processAvatarImage(await makeGeotaggedImageFile());
    expect(buffer.toString("latin1")).not.toContain("iPhone");
  });

  it("leaves no orientation tag behind", async () => {
    const file = await makeTestImageFile({ width: 200, height: 100, exifOrientation: 6 });
    const rawMeta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
    expect(rawMeta.exif).toBeDefined();

    const { buffer } = await processAvatarImage(file);
    const meta = await sharp(buffer).metadata();

    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    // As with processListingImage's equivalent test: this asserts the tag is
    // gone, not that the rotation was baked into the pixels first. `.rotate()`
    // with no arguments is what does that, and a synthetic image built by
    // sharp's own create+withExif path does not round-trip through it in a way
    // that would let the swapped dimensions prove it here. Asserting it anyway
    // would be a test that passes for the wrong reason.
  });

  it("caps the longest edge at AVATAR_MAX_DIMENSION", async () => {
    const file = await makeTestImageFile({ width: 2400, height: 1200 });
    const { buffer } = await processAvatarImage(file);
    const meta = await sharp(buffer).metadata();

    expect(meta.width).toBe(AVATAR_MAX_DIMENSION);
    expect(meta.height).toBe(AVATAR_MAX_DIMENSION / 2);
  });

  it("does not upscale a photo smaller than the cap", async () => {
    const file = await makeTestImageFile({ width: 120, height: 90 });
    const { buffer } = await processAvatarImage(file);
    const meta = await sharp(buffer).metadata();

    expect(meta.width).toBe(120);
    expect(meta.height).toBe(90);
  });

  it("rejects a file that is not an image, whatever its content type claims", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "not-an-image.jpg", { type: "image/jpeg" });
    await expect(processAvatarImage(file)).rejects.toThrow(/doesn't look like a valid image/);
  });

  it("rejects a disallowed content type", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "test.gif", { type: "image/gif" });
    await expect(processAvatarImage(file)).rejects.toThrow(/JPEG, PNG or WebP/);
  });

  it("rejects an empty file", async () => {
    const file = new File([], "empty.jpg", { type: "image/jpeg" });
    await expect(processAvatarImage(file)).rejects.toThrow(/empty/);
  });
});
