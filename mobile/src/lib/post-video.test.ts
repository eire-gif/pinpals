import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ postToSite: vi.fn(), deleteFromSiteWithBody: vi.fn() }));
vi.mock("./config", () => ({ SUPABASE_PUBLISHABLE_KEY: "pk" }));
vi.mock("./supabase", () => ({ supabase: { auth: { getSession: vi.fn() } } }));

const { durationLabel, videoContentType, videoProblem, VIDEO_MAX_BYTES } = await import("./post-video");

describe("post videos (app)", () => {
  it("works out the type from the picker, or the file name", () => {
    expect(videoContentType({ uri: "a", mimeType: "video/quicktime" })).toBe("video/quicktime");
    expect(videoContentType({ uri: "file:///x/IMG_0001.MOV" })).toBe("video/quicktime");
    expect(videoContentType({ uri: "file:///x/clip.mp4" })).toBe("video/mp4");
    expect(videoContentType({ uri: "file:///x/clip.webm" })).toBeNull();
  });

  it("refuses over 30 seconds, over 50 MB, or an unknown format", () => {
    expect(videoProblem({ uri: "a.mov", duration: 24_000, fileSize: 12_000_000 })).toBeNull();
    expect(videoProblem({ uri: "a.mov", duration: 30_400 })).toBeNull();
    expect(videoProblem({ uri: "a.mov", duration: 45_000 })).toMatch(/30 seconds/);
    expect(videoProblem({ uri: "a.mov", fileSize: VIDEO_MAX_BYTES + 1 })).toMatch(/too large/);
    expect(videoProblem({ uri: "a.webm" })).toMatch(/format/);
  });

  it("labels durations", () => {
    expect(durationLabel(24_400)).toBe("0:24");
    expect(durationLabel(30_000)).toBe("0:30");
    expect(durationLabel(null)).toBeNull();
  });
});
