import { describe, expect, it } from "vitest";
import {
  DEFAULT_RADIUS_KM,
  RADIUS_OPTIONS,
  formatDistance,
  parseCoords,
  parseRadiusKm,
  roundCoord,
} from "./geo";

describe("roundCoord", () => {
  it("rounds to two decimal places", () => {
    expect(roundCoord(53.349805)).toBe(53.35);
    expect(roundCoord(-6.260247)).toBe(-6.26);
  });

  it("strips enough precision to hide an address", () => {
    // Two positions ~200m apart must round to the same point. This is the
    // whole privacy claim of the feature: what reaches the URL is a
    // neighbourhood, not a doorstep.
    expect(roundCoord(53.3512)).toBe(roundCoord(53.3488));
  });

  it("keeps enough precision to be useful at a 30km radius", () => {
    // ~1.1km apart in latitude must still be distinguishable.
    expect(roundCoord(53.35)).not.toBe(roundCoord(53.36));
  });
});

describe("parseCoords", () => {
  it("reads a valid pair", () => {
    expect(parseCoords("53.35", "-6.26")).toEqual({ lat: 53.35, lng: -6.26 });
  });

  it("returns null when either half is missing", () => {
    expect(parseCoords("53.35", undefined)).toBeNull();
    expect(parseCoords(undefined, "-6.26")).toBeNull();
    expect(parseCoords(undefined, undefined)).toBeNull();
    expect(parseCoords("", "")).toBeNull();
  });

  it("rejects anything that isn't a finite number", () => {
    // A URL is user-editable; none of these should reach the database.
    expect(parseCoords("banana", "-6.26")).toBeNull();
    expect(parseCoords("53.35", "NaN")).toBeNull();
    expect(parseCoords("Infinity", "0")).toBeNull();
  });

  it("rejects coordinates outside the real world", () => {
    expect(parseCoords("999", "0")).toBeNull();
    expect(parseCoords("-91", "0")).toBeNull();
    expect(parseCoords("0", "181")).toBeNull();
    expect(parseCoords("0", "-181")).toBeNull();
  });

  it("accepts the exact edges", () => {
    expect(parseCoords("90", "180")).toEqual({ lat: 90, lng: 180 });
    expect(parseCoords("-90", "-180")).toEqual({ lat: -90, lng: -180 });
    expect(parseCoords("0", "0")).toEqual({ lat: 0, lng: 0 });
  });
});

describe("parseRadiusKm", () => {
  it("accepts the offered radii", () => {
    for (const option of RADIUS_OPTIONS) {
      expect(parseRadiusKm(String(option))).toBe(option);
    }
  });

  it("falls back to the default for anything else", () => {
    expect(parseRadiusKm(undefined)).toBe(DEFAULT_RADIUS_KM);
    expect(parseRadiusKm("")).toBe(DEFAULT_RADIUS_KM);
    expect(parseRadiusKm("banana")).toBe(DEFAULT_RADIUS_KM);
    expect(parseRadiusKm("999999")).toBe(DEFAULT_RADIUS_KM);
    expect(parseRadiusKm("-30")).toBe(DEFAULT_RADIUS_KM);
  });
});

describe("formatDistance", () => {
  it("doesn't claim precision the rounded coordinate can't support", () => {
    expect(formatDistance(0.4)).toBe("Less than 1 km away");
    expect(formatDistance(0)).toBe("Less than 1 km away");
    expect(formatDistance(24.3)).toBe("24 km away");
  });

  it("keeps one decimal in the range where it means something", () => {
    expect(formatDistance(4.25)).toBe("4.3 km away");
    expect(formatDistance(9.9)).toBe("9.9 km away");
  });

  it("returns nothing for a nonsense distance rather than rendering NaN", () => {
    expect(formatDistance(Number.NaN)).toBe("");
    expect(formatDistance(-5)).toBe("");
  });
});
