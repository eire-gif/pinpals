import { describe, expect, it } from "vitest";

import {
  AIM_DRIVE_M,
  bearingDeg,
  defaultAim,
  distanceM,
  fixIsUsable,
  greenDistancesM,
  hazardsAheadM,
  holeFrame,
  holeGeometry,
  holeLengthM,
  inUnit,
  mappedHoles,
  measuringFrom,
  shotLegs,
  tapDistancesM,
  type LayoutPoint,
} from "./hole-geo";

// A made-up straight par 4 running due north near Portmarnock: tee at the
// bottom, green ~366 m (400 yds) up the map. 0.001° of latitude ≈ 111.2 m.
const TEE = { lat: 53.43, lng: -6.12 };
const north = (m: number) => ({ lat: TEE.lat + m / 111_195, lng: TEE.lng });

const p = (hole: number, kind: LayoutPoint["kind"], at: { lat: number; lng: number }, label: string | null = null): LayoutPoint => ({
  hole,
  kind,
  label,
  ...at,
});

const HOLE_1: LayoutPoint[] = [
  p(1, "tee_back", TEE),
  p(1, "tee_front", north(20)),
  p(1, "green_front", north(352)),
  p(1, "green_centre", north(366)),
  p(1, "green_back", north(380)),
  p(1, "fairway_bunker", north(230), "Left bunker"),
  p(1, "green_bunker", north(345)),
  p(1, "marker_150", north(229)),
];

describe("distances and bearings", () => {
  it("measures a known distance to within a metre", () => {
    expect(distanceM(TEE, north(366))).toBeCloseTo(366, 0);
    expect(distanceM(TEE, TEE)).toBe(0);
  });

  it("turns metres into the member's unit", () => {
    expect(inUnit(366, "yards")).toBe(400);
    expect(inUnit(366.4, "metres")).toBe(366);
  });

  it("knows north from east", () => {
    expect(bearingDeg(TEE, north(100))).toBeCloseTo(0, 3);
    expect(bearingDeg(TEE, { lat: TEE.lat, lng: TEE.lng + 0.01 })).toBeCloseTo(90, 0);
    expect(bearingDeg(north(100), TEE)).toBeCloseTo(180, 3);
  });
});

describe("a hole's geometry", () => {
  it("picks out the tee, the green and the hazards", () => {
    const g = holeGeometry(HOLE_1, 1);
    expect(g.mapped).toBe(true);
    expect(g.tee).toEqual(TEE);
    expect(g.hazards.map((h) => h.kind)).toEqual(["fairway_bunker", "green_bunker", "marker_150"]);
    expect(holeLengthM(g)).toBeCloseTo(366, 0);
  });

  it("puts the centre between front and back when the provider gave neither", () => {
    const g = holeGeometry([p(2, "tee_front", TEE), p(2, "green_front", north(100)), p(2, "green_back", north(120))], 2);
    expect(g.tee).toEqual(TEE); // front tee when there's no back tee
    expect(distanceM(TEE, g.greenCentre!)).toBeCloseTo(110, 0);
  });

  it("a hole with no green isn't mapped, and isn't listed", () => {
    const pts = [...HOLE_1, p(3, "tee_back", TEE)];
    expect(holeGeometry(pts, 3).mapped).toBe(false);
    expect(holeGeometry(pts, 4).mapped).toBe(false);
    expect(mappedHoles(pts)).toEqual([1]);
  });
});

describe("measuring", () => {
  const g = holeGeometry(HOLE_1, 1);

  it("from you when you're on the hole", () => {
    const me = north(200);
    expect(measuringFrom(g, me)).toEqual({ from: "you", point: me });
    const d = greenDistancesM(g, me);
    expect(d.front).toBeCloseTo(152, 0);
    expect(d.centre).toBeCloseTo(166, 0);
    expect(d.back).toBeCloseTo(180, 0);
  });

  it("from the tee when you're nowhere near it", () => {
    expect(measuringFrom(g, { lat: 53.35, lng: -6.26 })).toEqual({ from: "tee", point: TEE });
    expect(measuringFrom(g, null)).toEqual({ from: "tee", point: TEE });
  });

  it("lists only hazards still ahead, nearest first, and leaves out markers", () => {
    const fromTee = hazardsAheadM(g, TEE);
    expect(fromTee.map((h) => h.kind)).toEqual(["fairway_bunker", "green_bunker"]);
    expect(fromTee[0].distance).toBeCloseTo(230, 0);
    // Past the fairway bunker: only the green-side one is left.
    expect(hazardsAheadM(g, north(260)).map((h) => h.kind)).toEqual(["green_bunker"]);
  });

  it("measures to a tapped point and on from it to the green", () => {
    const t = tapDistancesM(g, TEE, north(250));
    expect(t.toTap).toBeCloseTo(250, 0);
    expect(t.tapToGreen).toBeCloseTo(116, 0);
  });
});

describe("shots", () => {
  const g = holeGeometry(HOLE_1, 1);

  it("a shot's length is to where the next was played from; the last is open", () => {
    const legs = shotLegs(
      [
        { shotNo: 2, ...north(240), accuracyM: 5 },
        { shotNo: 1, ...TEE, accuracyM: 4 },
        { shotNo: 3, ...north(350), accuracyM: 6 },
      ],
      g
    );
    expect(legs.map((l) => l.shotNo)).toEqual([1, 2, 3]);
    expect(legs[0].distance).toBeCloseTo(240, 0);
    expect(legs[1].distance).toBeCloseTo(110, 0);
    expect(legs[2].distance).toBeNull();
    expect(legs[2].to).toBeNull();
    expect(legs[0].remaining).toBeCloseTo(366, 0);
    expect(legs[2].remaining).toBeCloseTo(16, 0);
  });

  it("works with no hole geometry: lengths yes, remaining no", () => {
    const legs = shotLegs([{ shotNo: 1, ...TEE, accuracyM: null }, { shotNo: 2, ...north(100), accuracyM: null }], null);
    expect(legs[0].distance).toBeCloseTo(100, 0);
    expect(legs[0].remaining).toBeNull();
  });

  it("won't mark a shot on a poor fix", () => {
    expect(fixIsUsable(8)).toBe(true);
    expect(fixIsUsable(30)).toBe(true);
    expect(fixIsUsable(65)).toBe(false);
    expect(fixIsUsable(null)).toBe(true);
  });
});

describe("framing", () => {
  it("turns the map so the tee is at the bottom", () => {
    const g = holeGeometry(HOLE_1, 1);
    expect(holeFrame(g, null).rotation).toBeCloseTo(0, 3);
    // Includes the member only when they're on the hole.
    expect(holeFrame(g, north(100)).points.length).toBe(holeFrame(g, null).points.length + 1);
    expect(holeFrame(g, { lat: 53.35, lng: -6.26 }).points.length).toBe(holeFrame(g, null).points.length);
  });
});

describe("the aim circle", () => {
  it("starts a drive out on a long hole, on the line to the green", () => {
    const g = holeGeometry(HOLE_1, 1);
    const aim = defaultAim(g, TEE)!;
    expect(distanceM(TEE, aim)).toBeCloseTo(AIM_DRIVE_M, -1);
    expect(distanceM(aim, g.greenCentre!) + distanceM(TEE, aim)).toBeCloseTo(366, -1);
  });

  it("isn't there when the green is in reach, or unknown", () => {
    const g = holeGeometry(HOLE_1, 1);
    expect(defaultAim(g, north(150))).toBeNull();
    expect(defaultAim(holeGeometry([], 1), TEE)).toBeNull();
  });

  it("never sits on top of the green", () => {
    const g = holeGeometry(HOLE_1, 1);
    const aim = defaultAim(g, north(80))!;
    expect(distanceM(aim, g.greenCentre!)).toBeGreaterThanOrEqual(79);
  });
});
