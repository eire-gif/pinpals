import { describe, expect, it } from "vitest";

import { distanceM, holeGeometry } from "./hole-geo";
import { holeLines, osmHolePoints, osmLayoutPoints, outlinesNear, parseOverpass, type OsmFeature } from "./osm-course";

// A made-up hole running due north: tee at TEE, green ~360 m on.
const TEE = { lat: 53.43, lng: -6.12 };
const north = (m: number, eastM = 0) => ({ lat: TEE.lat + m / 110_540, lng: TEE.lng + eastM / (111_320 * Math.cos((TEE.lat * Math.PI) / 180)) });
const square = (centreN: number, half: number, eastM = 0) => [
  north(centreN - half, eastM - half),
  north(centreN - half, eastM + half),
  north(centreN + half, eastM + half),
  north(centreN + half, eastM - half),
  north(centreN - half, eastM - half),
];

const HOLE_1: OsmFeature[] = [
  { kind: "hole", ref: 1, coords: [TEE, north(200), north(360)] },
  { kind: "green", ref: null, coords: square(360, 15) },
  { kind: "bunker", ref: null, coords: square(230, 4, -20) }, // fairway bunker, 20 m left
  { kind: "bunker", ref: null, coords: square(350, 3, 22) }, // greenside, right
  { kind: "bunker", ref: null, coords: square(230, 4, -120) }, // another hole's
  { kind: "water", ref: null, coords: [north(100, 30), north(140, 30), north(140, 90), north(100, 90), north(100, 30)] },
];

describe("parsing Overpass", () => {
  it("keeps golf shapes, holes with their numbers, pins and water", () => {
    const f = parseOverpass({
      elements: [
        { type: "way", tags: { golf: "hole", ref: "7" }, geometry: [{ lat: 53.1, lon: -6.1 }, { lat: 53.2, lon: -6.1 }] },
        { type: "way", tags: { golf: "green" }, geometry: [{ lat: 53.1234567, lon: -6.1 }] },
        { type: "way", tags: { golf: "lateral_water_hazard" }, geometry: [{ lat: 53, lon: -6 }] },
        { type: "way", tags: { golf: "cartpath" }, geometry: [{ lat: 53, lon: -6 }] },
        { type: "node", tags: { golf: "pin" }, lat: 53.3, lon: -6.3 },
        { type: "relation", tags: { natural: "water" }, members: [{ role: "outer", geometry: [{ lat: 53, lon: -6 }] }, { role: "inner", geometry: [{ lat: 52, lon: -6 }] }] },
      ],
    });
    expect(f.map((x) => x.kind)).toEqual(["hole", "green", "water", "pin", "water"]);
    expect(f[0].ref).toBe(7);
    expect(f[1].coords[0].lat).toBe(53.123457);
  });

  it("survives junk", () => {
    expect(parseOverpass(null)).toEqual([]);
    expect(parseOverpass({ elements: "no" })).toEqual([]);
  });
});

describe("a hole's points from OSM", () => {
  const pts = osmHolePoints(HOLE_1, 1, HOLE_1[0].coords);
  const g = holeGeometry(pts, 1);

  it("tee, and the green's front, centre and back along the line of play", () => {
    expect(g.mapped).toBe(true);
    expect(g.tee).toEqual(TEE);
    expect(distanceM(TEE, g.greenCentre!)).toBeCloseTo(360, -1);
    expect(distanceM(TEE, g.greenFront!)).toBeCloseTo(345, -1);
    expect(distanceM(TEE, g.greenBack!)).toBeCloseTo(375, -1);
  });

  it("hazards beside the hole, not on the next one; greenside told apart; water by its near edge", () => {
    expect(g.hazards.map((h) => h.kind).sort()).toEqual(["fairway_bunker", "green_bunker", "water"]);
    const water = g.hazards.find((h) => h.kind === "water")!;
    expect(distanceM(water, north(100, 30))).toBeLessThan(15);
  });

  it("a pin on the green is the centre", () => {
    const pin: OsmFeature = { kind: "pin", ref: null, coords: [north(365, 5)] };
    const withPin = holeGeometry(osmHolePoints([...HOLE_1, pin], 1, HOLE_1[0].coords), 1);
    expect(withPin.greenCentre).toEqual(north(365, 5));
  });

  it("no line, no points", () => {
    expect(osmHolePoints(HOLE_1, 2, undefined)).toEqual([]);
  });
});

describe("choosing the right hole lines", () => {
  it("at a 27-hole club, follows the walk from green to next tee", () => {
    const a1 = [north(0), north(300)];
    const b1 = [north(0, 2000), north(300, 2000)];
    const a2 = [north(320), north(600)];
    const b2 = [north(320, 2000), north(600, 2000)];
    const f: OsmFeature[] = [
      { kind: "hole", ref: 1, coords: b1 },
      { kind: "hole", ref: 1, coords: a1 },
      { kind: "hole", ref: 2, coords: b2 },
      { kind: "hole", ref: 2, coords: a2 },
    ];
    const lines = holeLines(f, TEE);
    expect(lines.get(1)).toEqual(a1);
    expect(lines.get(2)).toEqual(a2);
  });

  it("builds every hole it can", () => {
    expect(new Set(osmLayoutPoints(HOLE_1, TEE).map((p) => p.hole))).toEqual(new Set([1]));
  });
});

describe("outlines near a hole", () => {
  it("leaves out far-away shapes and pins", () => {
    const far: OsmFeature = { kind: "green", ref: null, coords: [north(5000)] };
    const pin: OsmFeature = { kind: "pin", ref: null, coords: [north(360)] };
    const near = outlinesNear([...HOLE_1, far, pin], [TEE, north(360)]);
    expect(near).not.toContain(far);
    expect(near).not.toContain(pin);
    expect(near.length).toBe(HOLE_1.length);
  });
});
