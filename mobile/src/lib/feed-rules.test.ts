import { describe, expect, it } from "vitest";
import { FEED_SCOPES, FEED_SCOPE_LABELS, ago, commentLine, draftProblem, golfChips, handicapLabel, previewComments, interleave, likeLine, photoHeight, threadComments } from "./feed-rules";

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

describe("handicapLabel", () => {
  it("shows an index to one decimal, and whole numbers without one", () => {
    expect(handicapLabel(12.4)).toBe("HCP 12.4");
    expect(handicapLabel(18)).toBe("HCP 18");
    expect(handicapLabel(0)).toBe("HCP 0");
    expect(handicapLabel(54)).toBe("HCP 54");
  });

  it("shows a plus handicap (stored negative) with a plus sign", () => {
    expect(handicapLabel(-1.2)).toBe("HCP +1.2");
    expect(handicapLabel(-3)).toBe("HCP +3");
  });
});

describe("golfChips", () => {
  it("is empty without golf details", () => {
    expect(golfChips(null)).toEqual([]);
    expect(golfChips({})).toEqual([]);
  });

  it("orders a hole the way a golfer says it", () => {
    expect(golfChips({ hole: 7, par: 3, yards: 162, club: " 7 Iron ", result: "Ace" })).toEqual([
      "Hole 7",
      "Par 3",
      "162 yds",
      "7 Iron",
      "Ace",
    ]);
  });

  it("writes a round score against par", () => {
    expect(golfChips({ roundScore: 78, toPar: 6 })).toEqual(["78 (+6)"]);
    expect(golfChips({ roundScore: 70, toPar: -2 })).toEqual(["70 (-2)"]);
    expect(golfChips({ roundScore: 72, toPar: 0 })).toEqual(["72 (E)"]);
    expect(golfChips({ roundScore: 81 })).toEqual(["81"]);
  });
});

describe("previewComments", () => {
  const c = (id: number, at: string) => ({ id, createdAt: at });
  it("keeps the latest two, oldest first", () => {
    const list = [c(3, "2026-10-01T10:03:00Z"), c(1, "2026-10-01T10:01:00Z"), c(2, "2026-10-01T10:02:00Z")];
    expect(previewComments(list).map((x) => x.id)).toEqual([2, 3]);
  });
  it("shows what there is when there are fewer", () => {
    expect(previewComments([c(1, "2026-10-01T10:01:00Z")]).map((x) => x.id)).toEqual([1]);
    expect(previewComments([])).toEqual([]);
  });
});

describe("feed tabs", () => {
  it("are For You then Following, over the unchanged scope values", () => {
    expect(FEED_SCOPES.map((s) => FEED_SCOPE_LABELS[s])).toEqual(["For You", "Following"]);
    expect([...FEED_SCOPES]).toEqual(["all", "connections"]);
  });
});
