import { describe, expect, it } from "vitest";

import { parseReview, REVIEW_TAGS } from "./course-reviews";
import { REVIEW_TAG_OPTIONS } from "@/app/courses/[country]/[slug]/review-constants";

describe("parseReview", () => {
  const base = { rating: 4, body: "", tags: [] as string[], playedMonth: "" };

  it("accepts a bare rating", () => {
    expect(parseReview(base)).toEqual({ ok: true, value: { rating: 4, body: null, tags: [], played_month: null } });
  });

  it("refuses ratings outside 1–5", () => {
    expect(parseReview({ ...base, rating: 0 }).ok).toBe(false);
    expect(parseReview({ ...base, rating: 6 }).ok).toBe(false);
  });

  it("drops unknown tags and duplicates", () => {
    const r = parseReview({ ...base, tags: ["greens", "greens", "nonsense"] });
    expect(r.ok && r.value.tags).toEqual(["greens"]);
  });

  it("turns a month into the first of that month and refuses the future", () => {
    const r = parseReview({ ...base, playedMonth: "2025-07" });
    expect(r.ok && r.value.played_month).toBe("2025-07-01");
    expect(parseReview({ ...base, playedMonth: "2999-01" }).ok).toBe(false);
    expect(parseReview({ ...base, playedMonth: "2025-13" }).ok).toBe(false);
  });

  it("refuses an over-long comment", () => {
    expect(parseReview({ ...base, body: "x".repeat(1001) }).ok).toBe(false);
  });
});

describe("tag lists", () => {
  it("the client form offers exactly the tags the server accepts", () => {
    expect(REVIEW_TAG_OPTIONS.map((t) => t.code)).toEqual([...REVIEW_TAGS]);
  });
});
