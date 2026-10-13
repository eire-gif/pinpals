import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { processAdCreative } from "./ad-creative";

async function image(width: number, height: number, withExif = false): Promise<File> {
  let p = sharp({ create: { width, height, channels: 3, background: { r: 12, g: 32, b: 56 } } }).jpeg();
  if (withExif) p = p.withExif({ IFD0: { Make: "PinPalsCam", Artist: "Someone" } });
  const buf = await p.toBuffer();
  return new File([new Uint8Array(buf)], "ad.jpg", { type: "image/jpeg" });
}

describe("processAdCreative", () => {
  it("accepts the right shape and strips metadata", async () => {
    const out = await processAdCreative(await image(1200, 300, true), "banner");
    expect(out).toMatchObject({ width: 1200, height: 300, contentType: "image/jpeg", extension: "jpg" });
    const meta = await sharp(out.buffer).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("rejects the wrong shape or size", async () => {
    await expect(processAdCreative(await image(1080, 1080), "takeover")).rejects.toThrow(/9:16/);
    await expect(processAdCreative(await image(100, 100), "logo")).rejects.toThrow(/at least 200/);
  });

  it("rejects files that aren't images, or are too big", async () => {
    await expect(processAdCreative(new File([new Uint8Array([1, 2, 3])], "x.jpg", { type: "image/jpeg" }), "feed")).rejects.toThrow(/valid image/);
    await expect(processAdCreative(new File([new Uint8Array(3 * 1024 * 1024)], "x.jpg", { type: "image/jpeg" }), "feed")).rejects.toThrow(/2 MB/);
    await expect(processAdCreative(new File([new Uint8Array([1])], "x.gif", { type: "image/gif" }), "feed")).rejects.toThrow(/JPEG, PNG or WEBP/);
  });
});
