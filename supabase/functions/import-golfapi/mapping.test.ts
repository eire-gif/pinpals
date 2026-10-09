import { describe, expect, it } from "vitest";

import { importCost, km, mapClubSearch, mapCoordinates, mapCourse, validCard } from "./mapping";

// Fixtures in golfapi.io's historical shape. NOT a captured live response —
// see the note at the top of mapping.ts. Replace with a real one from the
// first "inspect" run.
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const SI = [7, 1, 15, 11, 3, 13, 17, 5, 9, 8, 2, 16, 12, 4, 14, 18, 6, 10];

const course = {
  apiRequestsLeft: 48,
  courseID: "012141520658891108829",
  courseName: "Championship",
  numHoles: 18,
  parsMen: PARS,
  indexesMen: SI,
  parsWomen: PARS,
  indexesWomen: SI,
  tees: [
    { teeName: "Blue", teeColor: "#0000ff", courseRatingMen: 74.6, slopeMen: 139, courseRatingWomen: null, slopeWomen: null },
    { teeName: "Red", teeColor: "#ff0000", courseRatingMen: 69.1, slopeMen: 124, courseRatingWomen: 74.8, slopeWomen: 137 },
  ],
};

describe("mapCourse", () => {
  it("turns a course into tees with full cards", () => {
    const { course: c, report } = mapCourse(course, 1);
    expect(c?.providerCourseId).toBe("012141520658891108829");
    expect(c?.holes).toBe(18);
    expect(c?.tees.map((t) => t.teeName)).toEqual(["Blue", "Red", "Red (Women)"]);
    const blue = c!.tees[0];
    expect(blue.parTotal).toBe(72);
    expect(blue.courseRating).toBe(74.6);
    expect(blue.slope).toBe(139);
    expect(blue.card?.[1]).toEqual({ hole: 2, par: 4, strokeIndex: 1 });
    expect(report.missing).toEqual([]);
  });

  it("prefixes tees with the course when the club has several", () => {
    const { course: c } = mapCourse(course, 2);
    expect(c?.tees[0].teeName).toBe("Championship · Blue");
  });

  it("takes a name members use, and can put it on the tees", () => {
    const { course: c } = mapCourse(course, 1, { name: "Old Course", prefixTees: true });
    expect(c?.name).toBe("Old Course");
    expect(c?.tees[0].teeName).toBe("Old Course · Blue");
    expect(mapCourse(course, 1, { name: "Old Course" }).course?.tees[0].teeName).toBe("Blue");
  });

  it("keeps the ratings but no card when the provider has no stroke indexes", () => {
    const { course: c, report } = mapCourse({ ...course, indexesMen: undefined, indexesWomen: undefined }, 1);
    expect(c?.tees[0].card).toBeNull();
    expect(c?.tees[0].courseRating).toBe(74.6);
    expect(report.missing.some((m) => m.startsWith("stroke indexes"))).toBe(true);
  });

  it("reads per-hole fields as well as arrays, and drops impossible ratings", () => {
    const flat: Record<string, unknown> = { courseID: 7, courseName: "Links", numHoles: 9, tees: [{ teeName: "White", courseRatingMen: 120, slopeMen: 30 }] };
    PARS.slice(0, 9).forEach((p, i) => (flat[`parMen${i + 1}`] = p));
    [5, 1, 9, 3, 7, 2, 8, 4, 6].forEach((s, i) => (flat[`indexMen${i + 1}`] = s));
    const { course: c } = mapCourse(flat, 1);
    expect(c?.holes).toBe(9);
    expect(c?.tees[0].card).toHaveLength(9);
    expect(c?.tees[0].courseRating).toBeNull();
    expect(c?.tees[0].slope).toBeNull();
  });

  it("refuses something that isn't a course", () => {
    expect(mapCourse(null, 1).course).toBeNull();
    expect(mapCourse({ courseName: "No id" }, 1).course).toBeNull();
  });
});

describe("validCard", () => {
  it("needs every hole, real pars, and each index once", () => {
    expect(validCard(PARS, SI, 18)).toHaveLength(18);
    expect(validCard(PARS, [...SI.slice(0, 17), 1], 18)).toBeNull(); // index 1 twice
    expect(validCard([...PARS.slice(0, 17), 9], SI, 18)).toBeNull(); // par 9
    expect(validCard(PARS.slice(0, 10), SI, 18)).toBeNull();
    expect(validCard(PARS, null, 18)).toBeNull();
  });
});

describe("mapCoordinates", () => {
  const pt = (hole: number, poi: number, location: number, lat: number, sideFW = 2) => ({ hole, poi, location, sideFW, latitude: lat, longitude: -6.12 });

  it("maps greens, tees and hazards; hazards keep reach and carry", () => {
    const { points, report } = mapCoordinates({
      coordinates: [
        pt(1, 12, 2, 53.43),
        pt(1, 11, 2, 53.4302),
        pt(1, 1, 1, 53.4331),
        pt(1, 1, 2, 53.4333),
        pt(1, 1, 3, 53.4335),
        pt(1, 3, 1, 53.432, 1),
        pt(1, 3, 3, 53.4322, 1),
        pt(1, 3, 2, 53.4321, 1), // centre of a bunker that has edges: dropped
        pt(1, 4, 2, 53.4325, 3), // water with only a centre: kept
        pt(1, 10, 2, 53.431), // road: dropped
        pt(1, 99, 2, 53.431), // unknown: dropped and reported
      ],
    });
    expect(points.map((p) => p.kind)).toEqual(["tee_back", "tee_front", "green_front", "green_centre", "green_back", "fairway_bunker", "fairway_bunker", "water"]);
    expect(points.filter((p) => p.kind === "fairway_bunker").map((p) => p.label)).toEqual(["Fairway bunker left · reach", "Fairway bunker left · carry"]);
    expect(points.find((p) => p.kind === "water")?.label).toBe("Water right");
    expect(report.missing).toEqual(["1 points with an unrecognised poi code (kept out)"]);
  });

  it("ignores points that aren't on a hole or on the map", () => {
    const { points } = mapCoordinates({ coordinates: [pt(0, 1, 2, 53.4), pt(19, 1, 2, 53.4), pt(2, 1, 2, 123)] });
    expect(points).toEqual([]);
  });
});

describe("search and costs", () => {
  it("reads club search results", () => {
    const res = mapClubSearch({
      clubs: [{ clubID: "141520658891108829", clubName: "Portmarnock Golf Club", city: "Portmarnock", latitude: 53.43, longitude: -6.12, courses: [{ courseID: "0121", courseName: "Championship", numHoles: 18, hasGPS: 1 }] }],
    });
    expect(res[0].courses[0]).toEqual({ providerCourseId: "0121", name: "Championship", holes: 18, hasGps: true });
  });

  it("measures distance for ranking matches", () => {
    expect(km({ lat: 53.43, lng: -6.12 }, { lat: 53.44, lng: -6.12 })).toBeCloseTo(1.112, 2);
  });

  it("prices a pull at one call per course, two with GPS", () => {
    expect(importCost(3500, true)).toBe(7000);
    expect(importCost(3500, false)).toBe(3500);
  });
});
