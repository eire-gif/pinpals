import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ImageProcessingError,
  POST_IMAGE_MAX_DIMENSION,
  attachPendingPostImages,
  parsePendingPostImagePath,
  uploadPendingPostImage,
} from "./upload";

// Feed photos (0088): staged one request at a time under pending/<member>/,
// then moved under the post's id. The staging path is the authorization
// check for the move, so it is tested as one.

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const UUID = "33333333-3333-4333-8333-333333333333";

async function photo(width: number, height: number, withGps = false): Promise<File> {
  let pipeline = sharp({ create: { width, height, channels: 3, background: { r: 30, g: 110, b: 50 } } }).jpeg();
  if (withGps) {
    pipeline = pipeline.withExif({ IFD0: { Make: "Pinpals test camera" }, IFD3: { GPSLatitudeRef: "N" } });
  }
  const buffer = await pipeline.toBuffer();
  return new File([new Uint8Array(buffer)], "round.jpg", { type: "image/jpeg" });
}

function storageMock() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const move = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const client = { storage: { from: vi.fn(() => ({ upload, move, remove })) } } as unknown as SupabaseClient;
  return { client, upload, move, remove };
}

describe("parsePendingPostImagePath", () => {
  it("accepts the member's own staged photo and reads its dimensions", () => {
    expect(parsePendingPostImagePath(ME, `pending/${ME}/${UUID}_1600x1200.jpg`)).toEqual({
      fileName: `${UUID}_1600x1200.jpg`,
      extension: "jpg",
      width: 1600,
      height: 1200,
    });
  });

  it("refuses somebody else's staged photo", () => {
    expect(parsePendingPostImagePath(ME, `pending/${THEM}/${UUID}_1600x1200.jpg`)).toBeNull();
  });

  it("refuses a photo already on a post, and anything that tries to climb out of the folder", () => {
    expect(parsePendingPostImagePath(ME, `42/${UUID}.jpg`)).toBeNull();
    expect(parsePendingPostImagePath(ME, `pending/${ME}/../${THEM}/${UUID}_10x10.jpg`)).toBeNull();
    expect(parsePendingPostImagePath(ME, `pending/${ME}/sub/${UUID}_10x10.jpg`)).toBeNull();
    expect(parsePendingPostImagePath(ME, `pending/${ME}/${UUID}_0x10.jpg`)).toBeNull();
    expect(parsePendingPostImagePath(ME, `pending/${ME}/${UUID}_10x10.gif`)).toBeNull();
  });
});

describe("uploadPendingPostImage", () => {
  it("re-encodes, caps the size, strips metadata and stages under the member's folder", async () => {
    const { client, upload } = storageMock();
    const staged = await uploadPendingPostImage(client, ME, await photo(3000, 1500, true));

    expect(staged.width).toBe(POST_IMAGE_MAX_DIMENSION);
    expect(staged.height).toBe(1000);
    expect(parsePendingPostImagePath(ME, staged.path)).not.toBeNull();

    const [path, bytes] = upload.mock.calls[0] as [string, Buffer];
    expect(path).toBe(staged.path);
    const meta = await sharp(bytes).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("refuses a file that is not an image", async () => {
    const { client } = storageMock();
    const fake = new File([new Uint8Array([1, 2, 3, 4])], "x.jpg", { type: "image/jpeg" });
    await expect(uploadPendingPostImage(client, ME, fake)).rejects.toThrow(ImageProcessingError);
  });
});

describe("attachPendingPostImages", () => {
  it("moves each staged photo under the post's id, in order", async () => {
    const { client, move } = storageMock();
    const out = await attachPendingPostImages(client, ME, 7, [
      `pending/${ME}/${UUID}_100x50.jpg`,
      `pending/${ME}/${UUID.replace(/3/g, "4")}_60x80.png`,
    ]);
    expect(out.map((o) => [o.width, o.height])).toEqual([
      [100, 50],
      [60, 80],
    ]);
    expect(out.every((o) => o.path.startsWith("7/"))).toBe(true);
    expect(move).toHaveBeenCalledTimes(2);
  });

  it("moves nothing when any path is not the member's own", async () => {
    const { client, move } = storageMock();
    await expect(
      attachPendingPostImages(client, ME, 7, [`pending/${ME}/${UUID}_10x10.jpg`, `pending/${THEM}/${UUID}_10x10.jpg`])
    ).rejects.toThrow(ImageProcessingError);
    expect(move).not.toHaveBeenCalled();
  });

  it("takes back what it moved when a later move fails", async () => {
    const { client, move, remove } = storageMock();
    move.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "not found" } });
    await expect(
      attachPendingPostImages(client, ME, 7, [`pending/${ME}/${UUID}_10x10.jpg`, `pending/${ME}/${UUID.replace(/3/g, "5")}_10x10.jpg`])
    ).rejects.toThrow(ImageProcessingError);
    expect(remove).toHaveBeenCalledTimes(1);
    expect((remove.mock.calls[0][0] as string[])[0]).toMatch(/^7\//);
  });
});
