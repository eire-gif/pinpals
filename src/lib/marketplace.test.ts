import { describe, expect, it } from "vitest";
import { summarizeRatings, computeResponseRate } from "./marketplace";

describe("summarizeRatings", () => {
  it("returns null when there are no reviews yet, not a zero average", () => {
    expect(summarizeRatings([])).toBeNull();
  });

  it("averages ratings to one decimal place", () => {
    expect(summarizeRatings([5, 4, 5])).toEqual({ average: 4.7, count: 3 });
  });

  it("counts a single review correctly", () => {
    expect(summarizeRatings([3])).toEqual({ average: 3, count: 1 });
  });
});

describe("computeResponseRate", () => {
  it("returns null when the seller has never received an offer", () => {
    expect(computeResponseRate(0, 0)).toBeNull();
  });

  it("computes a rounded percentage", () => {
    expect(computeResponseRate(3, 1)).toBe(33);
  });

  it("is 100 when every offer got a response", () => {
    expect(computeResponseRate(4, 4)).toBe(100);
  });

  it("is 0 when no offer has ever been responded to", () => {
    expect(computeResponseRate(5, 0)).toBe(0);
  });
});
