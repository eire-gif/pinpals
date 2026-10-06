import { describe, expect, it } from "vitest";

import { monthLabel, rateableCourses, reviewerName, toRate } from "./course-rating-rules";

const clubs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

describe("rateableCourses", () => {
  it("puts unrated courses first, keeping the given order within each group", () => {
    const out = rateableCourses(clubs, new Map([[2, 5], [3, 0]]));
    expect(out.map((c) => [c.club.id, c.rating])).toEqual([
      [1, null],
      [3, null],
      [4, null],
      [2, 5],
    ]);
  });
});

describe("toRate", () => {
  it("returns only unrated courses, up to the limit", () => {
    expect(toRate(clubs, new Map([[1, 4]]), 2).map((c) => c.id)).toEqual([2, 3]);
  });
  it("is empty when everything is rated", () => {
    expect(toRate([{ id: 9 }], new Map([[9, 3]]), 3)).toEqual([]);
  });
});

describe("reviewerName", () => {
  it("signs with first name and initial", () => {
    expect(reviewerName("Declan", "murphy")).toBe("Declan M.");
  });
  it("copes with missing parts", () => {
    expect(reviewerName("Aoife", null)).toBe("Aoife");
    expect(reviewerName(null, null)).toBe("A PinPals member");
  });
});

describe("monthLabel", () => {
  it("formats a played month", () => {
    expect(monthLabel("2026-09-01")).toBe("Sep 2026");
    expect(monthLabel("2026-10-04T12:00:00Z")).toBe("Oct 2026");
  });
  it("returns null for nothing or nonsense", () => {
    expect(monthLabel(null)).toBeNull();
    expect(monthLabel("soon")).toBeNull();
  });
});
