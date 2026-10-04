import { describe, expect, it } from "vitest";
import {
  interleaveFeed,
  threadComments,
  likeSummary,
  parseFeedScope,
  parseVisibility,
  relativeTime,
  validateComment,
  validatePostDraft,
  MAX_POST_BODY,
  MAX_POST_PHOTOS,
} from "./feed";

describe("validatePostDraft", () => {
  const base = { body: "", visibility: "members" as const, clubId: null, photoCount: 0 };

  it("refuses a post with neither words nor photos", () => {
    expect(validatePostDraft(base)).toMatch(/Add a photo/);
    expect(validatePostDraft({ ...base, body: "   \n " })).toMatch(/Add a photo/);
  });

  it("accepts golf details on their own", () => {
    expect(validatePostDraft({ ...base, hasDetails: true })).toBeNull();
  });

  it("accepts photos with no caption, and a caption with no photos", () => {
    expect(validatePostDraft({ ...base, photoCount: 1 })).toBeNull();
    expect(validatePostDraft({ ...base, body: "Birdie on 18" })).toBeNull();
  });

  it("caps the caption and the photo count", () => {
    expect(validatePostDraft({ ...base, body: "x".repeat(MAX_POST_BODY + 1) })).toMatch(/under/);
    expect(validatePostDraft({ ...base, photoCount: MAX_POST_PHOTOS + 1 })).toMatch(/up to 6/);
    expect(validatePostDraft({ ...base, photoCount: MAX_POST_PHOTOS })).toBeNull();
  });

  it("refuses a nonsense course id", () => {
    expect(validatePostDraft({ ...base, body: "x", clubId: -3 })).toMatch(/course/);
    expect(validatePostDraft({ ...base, body: "x", clubId: 1.5 })).toMatch(/course/);
    expect(validatePostDraft({ ...base, body: "x", clubId: 12 })).toBeNull();
  });
});

describe("validateComment", () => {
  it("needs words, and not too many", () => {
    expect(validateComment("  ")).not.toBeNull();
    expect(validateComment("Shot!")).toBeNull();
    expect(validateComment("x".repeat(1001))).toMatch(/under/);
  });
});

describe("parsers", () => {
  it("default the feed scope to all, and accept only the two audiences", () => {
    expect(parseFeedScope(undefined)).toBe("all");
    expect(parseFeedScope("connections")).toBe("connections");
    expect(parseFeedScope("everyone-ever")).toBe("all");
    expect(parseVisibility("members")).toBe("members");
    expect(parseVisibility("connections")).toBe("connections");
    // Spelled `public` it is refused — see 0088's header on why the value is
    // `members`.
    expect(parseVisibility("public")).toBeNull();
    expect(parseVisibility(3)).toBeNull();
  });
});

describe("interleaveFeed", () => {
  const p = (id: number, createdAt: string) => ({ id, createdAt });

  it("merges newest first, posts ahead of listings on a tie", () => {
    const merged = interleaveFeed(
      [p(1, "2026-10-02T10:00:00Z"), p(2, "2026-10-01T10:00:00Z")],
      [p(9, "2026-10-01T10:00:00Z"), p(8, "2026-10-02T12:00:00Z")],
      false
    );
    expect(merged.map((m) => `${m.kind}:${m.item.id}`)).toEqual(["listing:8", "post:1", "post:2", "listing:9"]);
  });

  it("on a full page, drops listings older than the oldest post so the next page can show them", () => {
    const merged = interleaveFeed(
      [p(1, "2026-10-02T10:00:00Z"), p(2, "2026-10-01T10:00:00Z")],
      [p(9, "2026-09-20T10:00:00Z")],
      true
    );
    expect(merged.map((m) => m.kind)).toEqual(["post", "post"]);
  });

  it("on the last page, keeps every listing", () => {
    const merged = interleaveFeed([p(1, "2026-10-02T10:00:00Z")], [p(9, "2026-09-20T10:00:00Z")], false);
    expect(merged.map((m) => m.kind)).toEqual(["post", "listing"]);
  });

  it("with no posts at all, still shows listings", () => {
    expect(interleaveFeed([], [p(9, "2026-09-20T10:00:00Z")], false)).toHaveLength(1);
  });
});

describe("likeSummary", () => {
  it("reads naturally", () => {
    expect(likeSummary(0, null, false)).toBeNull();
    expect(likeSummary(1, null, true)).toBe("You liked this");
    expect(likeSummary(2, "Aoife", true)).toBe("You and 1 other");
    expect(likeSummary(4, "Aoife", false)).toBe("Liked by Aoife and 3 others");
    expect(likeSummary(1, "Aoife", false)).toBe("Liked by Aoife");
    expect(likeSummary(3, null, false)).toBe("3 likes");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  it("is short", () => {
    expect(relativeTime("2026-10-02T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-10-02T11:55:00Z", now)).toBe("5m");
    expect(relativeTime("2026-10-02T09:00:00Z", now)).toBe("3h");
    expect(relativeTime("2026-09-30T12:00:00Z", now)).toBe("2d");
    expect(relativeTime("2026-09-01T12:00:00Z", now)).toMatch(/Sept? 1|1 Sept?/);
  });
});

describe("threadComments", () => {
  const c = (id: number, parentId: number | null, createdAt: string) => ({ id, parentId, createdAt });

  it("puts each reply under its comment, oldest first, and keeps top-level comments in time order", () => {
    const out = threadComments([
      c(1, null, "2026-10-03T10:00:00Z"),
      c(2, null, "2026-10-03T10:05:00Z"),
      c(3, 1, "2026-10-03T10:10:00Z"),
      c(4, 1, "2026-10-03T10:07:00Z"),
      c(5, 2, "2026-10-03T10:20:00Z"),
    ]);
    expect(out.map((x) => [x.id, x.depth])).toEqual([
      [1, 0],
      [4, 1],
      [3, 1],
      [2, 0],
      [5, 1],
    ]);
  });

  it("shows a reply whose parent isn't loaded as a comment of its own, not nowhere", () => {
    const out = threadComments([c(7, 99, "2026-10-03T10:00:00Z"), c(8, null, "2026-10-03T09:00:00Z")]);
    expect(out.map((x) => [x.id, x.depth])).toEqual([
      [8, 0],
      [7, 0],
    ]);
  });
});
