import { describe, expect, it } from "vitest";
import { ago, commentLine, draftProblem, interleave, likeLine, photoHeight, threadComments } from "./feed-rules";

describe("draftProblem", () => {
  it("needs a photo or some words", () => {
    expect(draftProblem("  ", 0)).toMatch(/Add a photo/);
    expect(draftProblem("", 1)).toBeNull();
    expect(draftProblem("Par on 18", 0)).toBeNull();
    expect(draftProblem("", 7)).toMatch(/up to 6/);
  });
});

describe("interleave", () => {
  const p = (id: number, createdAt: string) => ({ id, createdAt });
  it("matches the website's rule", () => {
    const posts = [p(1, "2026-10-02T10:00:00Z"), p(2, "2026-10-01T10:00:00Z")];
    const listings = [p(8, "2026-10-02T12:00:00Z"), p(9, "2026-09-01T10:00:00Z")];
    expect(interleave(posts, listings, true).map((e) => `${e.kind}${e.item.id}`)).toEqual(["listing8", "post1", "post2"]);
    expect(interleave(posts, listings, false).map((e) => `${e.kind}${e.item.id}`)).toEqual([
      "listing8",
      "post1",
      "post2",
      "listing9",
    ]);
  });
});

describe("lines", () => {
  it("read naturally", () => {
    expect(likeLine(0, false)).toBeNull();
    expect(likeLine(1, true)).toBe("You liked this");
    expect(likeLine(3, true)).toBe("You and 2 others");
    expect(likeLine(2, false)).toBe("2 likes");
    expect(commentLine(1)).toBe("1 comment");
    expect(commentLine(0)).toBeNull();
  });
});

describe("ago", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  it("is short and never locale-dependent", () => {
    expect(ago("2026-10-02T11:59:50Z", now)).toBe("just now");
    expect(ago("2026-10-02T11:00:00Z", now)).toBe("1h");
    expect(ago("2026-09-30T12:00:00Z", now)).toBe("2d");
    expect(ago("2026-09-14T12:00:00Z", now)).toBe("14 Sep");
    expect(ago("2025-09-14T12:00:00Z", now)).toBe("14 Sep 2025");
  });
});

describe("photoHeight", () => {
  it("clamps very tall and very wide photos", () => {
    expect(photoHeight(400, { width: 1000, height: 3000 })).toBe(500);
    expect(photoHeight(400, { width: 4000, height: 1000 })).toBe(225);
    expect(photoHeight(400, { width: null, height: null })).toBe(300);
  });
});

describe("threadComments", () => {
  const c = (id: number, parentId: number | null, createdAt: string) => ({ id, parentId, createdAt });

  it("puts replies under their comment, oldest first", () => {
    const out = threadComments([
      c(1, null, "2026-10-03T10:00:00Z"),
      c(2, null, "2026-10-03T10:05:00Z"),
      c(3, 1, "2026-10-03T10:10:00Z"),
    ]);
    expect(out.map((x) => [x.id, x.depth])).toEqual([
      [1, 0],
      [3, 1],
      [2, 0],
    ]);
  });

  it("shows a reply without its parent as a comment of its own", () => {
    expect(threadComments([c(7, 99, "2026-10-03T10:00:00Z")])[0].depth).toBe(0);
  });
});
