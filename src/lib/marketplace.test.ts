import { describe, expect, it } from "vitest";
import {
  summarizeRatings,
  computeResponseRate,
  eurToCents,
  centsToEur,
  isAuctionSaleType,
  auctionWindowError,
  MIN_AUCTION_DURATION_HOURS,
  MAX_AUCTION_DURATION_DAYS,
} from "./marketplace";

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

describe("eurToCents / centsToEur", () => {
  it("converts a whole euro amount", () => {
    expect(eurToCents(120)).toBe(12000);
    expect(centsToEur(12000)).toBe(120);
  });

  it("rounds a fractional-cent result rather than truncating", () => {
    // 19.995 * 100 = 1999.4999999999998 in floating point — must still land
    // on the nearest cent, not silently drop a cent.
    expect(eurToCents(19.995)).toBe(2000);
  });

  it("round-trips a decimal euro amount through cents", () => {
    expect(centsToEur(eurToCents(45.5))).toBe(45.5);
  });
});

describe("isAuctionSaleType", () => {
  it("is true for both auction sale types", () => {
    expect(isAuctionSaleType("auction")).toBe(true);
    expect(isAuctionSaleType("auction_with_buy_now")).toBe(true);
  });

  it("is false for fixed-price sale types", () => {
    expect(isAuctionSaleType("fixed_price")).toBe(false);
    expect(isAuctionSaleType("offers_allowed")).toBe(false);
  });
});

describe("auctionWindowError", () => {
  const hours = (n: number) => n * 60 * 60 * 1000;

  it("accepts a window within the allowed range", () => {
    const starts = new Date("2026-10-01T10:00:00Z");
    const ends = new Date(starts.getTime() + hours(48));
    expect(auctionWindowError(starts, ends)).toBeNull();
  });

  it("rejects a window shorter than the minimum duration", () => {
    const starts = new Date("2026-10-01T10:00:00Z");
    const ends = new Date(starts.getTime() + hours(MIN_AUCTION_DURATION_HOURS) - 1000);
    expect(auctionWindowError(starts, ends)).toMatch(/at least/);
  });

  it("rejects a window longer than the maximum duration", () => {
    const starts = new Date("2026-10-01T10:00:00Z");
    const ends = new Date(starts.getTime() + hours(MAX_AUCTION_DURATION_DAYS * 24) + 1000);
    expect(auctionWindowError(starts, ends)).toMatch(/at most/);
  });

  it("rejects an end time before the start time", () => {
    const starts = new Date("2026-10-01T10:00:00Z");
    const ends = new Date(starts.getTime() - hours(1));
    expect(auctionWindowError(starts, ends)).toMatch(/at least/);
  });

  it("rejects an invalid date", () => {
    expect(auctionWindowError(new Date("not-a-date"), new Date())).toMatch(/valid/);
  });
});
