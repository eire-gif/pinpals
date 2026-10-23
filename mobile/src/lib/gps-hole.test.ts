import { describe, expect, it } from "vitest";

import { destination, type LatLng } from "./hole-geo";
import { gpsNextHole, holeSpots, mergeSpots, TEE_RADIUS_M, type HoleSpots } from "./gps-hole";

const g1: LatLng = { lat: 53.43, lng: -6.12 };
const tee2 = destination(g1, 90, 40); // 40 m from the 1st green
const green2 = destination(tee2, 0, 350);
const spots = new Map<number, HoleSpots>([
  [1, { tees: [destination(g1, 180, 380)], green: g1 }],
  [2, { tees: [tee2], green: green2 }],
  [3, { tees: [destination(green2, 90, 30)], green: null }],
]);
const order = [1, 2, 3];
const at = (p: LatLng, accuracyM: number | null = 5) => ({ ...p, accuracyM });

describe("gpsNextHole", () => {
  it("moves on when the hole is scored and you're on the next tee", () => {
    expect(gpsNextHole({ showing: 1, order, scored: () => true, spots, fix: at(tee2) })).toBe(2);
  });
  it("stays while the hole isn't scored", () => {
    expect(gpsNextHole({ showing: 1, order, scored: () => false, spots, fix: at(tee2) })).toBeNull();
  });
  it("stays on the green you've just played, even near the next tee", () => {
    expect(gpsNextHole({ showing: 1, order, scored: () => true, spots, fix: at(destination(g1, 270, 10)) })).toBeNull();
  });
  it("needs a usable fix", () => {
    expect(gpsNextHole({ showing: 1, order, scored: () => true, spots, fix: at(tee2, 80) })).toBeNull();
    expect(gpsNextHole({ showing: 1, order, scored: () => true, spots, fix: null })).toBeNull();
  });
  it("moves on heading for the tee, well off the green", () => {
    const off = destination(tee2, 0, TEE_RADIUS_M + 30);
    expect(gpsNextHole({ showing: 1, order, scored: () => true, spots, fix: at(off) })).toBe(2);
  });
  it("never moves on twice from the same hole, or past the last", () => {
    expect(gpsNextHole({ showing: 1, order, scored: () => true, spots, fix: at(tee2), movedOnFrom: new Set([1]) })).toBeNull();
    expect(gpsNextHole({ showing: 3, order, scored: () => true, spots, fix: at(tee2) })).toBeNull();
  });
  it("follows a shotgun order", () => {
    expect(gpsNextHole({ showing: 1, order: [3, 1, 2], scored: () => true, spots, fix: at(tee2) })).toBe(2);
  });
  it("only ever goes to the next hole, not one further on", () => {
    const onThree = spots.get(3)!.tees[0];
    expect(gpsNextHole({ showing: 1, order, scored: () => true, spots, fix: at(onThree) })).toBeNull();
  });
});

describe("holeSpots / mergeSpots", () => {
  it("reads tees and green, golfapi first", () => {
    const pts = [
      { hole: 1, kind: "tee_back" as const, lat: 1, lng: 1, label: null },
      { hole: 1, kind: "green_centre" as const, lat: 2, lng: 2, label: null },
    ];
    const a = holeSpots(pts, [1, 2]);
    expect(a.get(1)?.tees).toHaveLength(1);
    expect(a.has(2)).toBe(false);
    const b = new Map([[2, { tees: [{ lat: 3, lng: 3 }], green: null }]]);
    expect([...mergeSpots(a, b).keys()].sort()).toEqual([1, 2]);
  });
});

import { ordinal, stripMark } from "./gps-hole";
describe("ordinal / stripMark", () => {
  it("names tees", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 18].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "18th"]);
  });
  it("marks birdies and eagles, gross", () => {
    expect(stripMark(3, 4)).toBe("birdie");
    expect(stripMark(3, 5)).toBe("eagle");
    expect(stripMark(1, 4)).toBe("eagle");
    expect(stripMark(4, 4)).toBe("scored");
    expect(stripMark(null, 4)).toBe("scored");
  });
});
