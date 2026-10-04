import { describe, expect, it } from "vitest";
import { MAX_POST_VIDEO_MS, isPostVideoType, parsePendingPostVideoPath, readPostVideoInput } from "./videos";

const me = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const staged = `pending/${me}/3f2a8c1e-9b7d-4c6a-8e5f-1a2b3c4d5e6f.mp4`;

describe("post videos", () => {
  it("only MP4 and QuickTime", () => {
    expect(isPostVideoType("video/mp4")).toBe(true);
    expect(isPostVideoType("video/quicktime")).toBe(true);
    expect(isPostVideoType("video/webm")).toBe(false);
    expect(isPostVideoType("image/jpeg")).toBe(false);
  });

  it("a staged path must be the member's own, exactly", () => {
    expect(parsePendingPostVideoPath(me, staged)).toEqual({ fileName: staged.split("/").pop(), extension: "mp4" });
    expect(parsePendingPostVideoPath(other, staged)).toBeNull();
    expect(parsePendingPostVideoPath(me, `12/abc.mp4`)).toBeNull();
    expect(parsePendingPostVideoPath(me, `pending/${me}/../${other}/x.mp4`)).toBeNull();
    expect(parsePendingPostVideoPath(me, `pending/${me}/3f2a8c1e-9b7d-4c6a-8e5f-1a2b3c4d5e6f.exe`)).toBeNull();
    expect(parsePendingPostVideoPath(me, 42)).toBeNull();
  });

  it("reads the create-post video field: absent, wrong, too long, or fine", () => {
    expect(readPostVideoInput(me, undefined)).toBeNull();
    expect(readPostVideoInput(me, null)).toBeNull();
    expect(readPostVideoInput(me, "x")).toMatch(/couldn't be read/);
    expect(readPostVideoInput(me, { path: staged.replace(me, other) })).toMatch(/couldn't be found/);
    expect(readPostVideoInput(me, { path: staged, duration_ms: MAX_POST_VIDEO_MS + 1 })).toMatch(/30 seconds/);
    expect(readPostVideoInput(me, { path: staged, duration_ms: -5 })).toMatch(/couldn't be read/);
    expect(readPostVideoInput(me, { path: staged, duration_ms: 24_400.6, width: 720, height: 1280 })).toEqual({
      path: staged,
      durationMs: 24_401,
      width: 720,
      height: 1280,
    });
    expect(readPostVideoInput(me, { path: staged, width: -1, height: "x" })).toEqual({ path: staged, durationMs: null, width: null, height: null });
  });
});
