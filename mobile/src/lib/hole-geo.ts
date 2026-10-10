/**
 * Hole maps — the arithmetic (Oct 2026, claude/hole-maps.md).
 *
 * Pure: no React, no Expo, no Supabase, so it runs under vitest with the
 * rest of the app's tested modules. Everything a hole map shows that is a
 * number comes from here: distances to the green, to hazards, between shots,
 * and to anywhere the member taps.
 *
 * Distances are great-circle (haversine) on the WGS84 mean radius. Over a
 * golf hole (< 700 m) the error against a proper ellipsoid is a few
 * centimetres — far below a phone's GPS error of 3–10 m, which is the number
 * that actually limits accuracy, and which the screen shows.
 */

export type LatLng = { lat: number; lng: number };

export type PointKind =
  | "tee_front"
  | "tee_back"
  | "green_front"
  | "green_centre"
  | "green_back"
  | "green_bunker"
  | "fairway_bunker"
  | "water"
  | "trees"
  | "marker_100"
  | "marker_150"
  | "marker_200"
  | "dogleg"
  | "other";

export type LayoutPoint = LatLng & { hole: number; kind: PointKind; label: string | null };

export type Unit = "yards" | "metres";

const EARTH_RADIUS_M = 6_371_008.8;
const METRES_PER_YARD = 0.9144;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Metres between two points. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from a to b, 0–360°, 0 = north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export const midpoint = (a: LatLng, b: LatLng): LatLng => ({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });

/** A distance as a whole number in the member's unit. */
export function inUnit(metres: number, unit: Unit): number {
  return Math.round(unit === "yards" ? metres / METRES_PER_YARD : metres);
}

export const unitShort = (unit: Unit): string => (unit === "yards" ? "yds" : "m");

// ---------------------------------------------------------------------------
// One hole
// ---------------------------------------------------------------------------

export type Hazard = LatLng & { kind: PointKind; label: string | null };

export type HoleGeometry = {
  hole: number;
  /** The back tee if known, else the front: where "from the tee" is measured. */
  tee: LatLng | null;
  teeFront: LatLng | null;
  teeBack: LatLng | null;
  greenFront: LatLng | null;
  greenCentre: LatLng | null;
  greenBack: LatLng | null;
  hazards: Hazard[];
  /** Enough to draw and measure: a tee and some part of the green. */
  mapped: boolean;
};

const HAZARD_KINDS: ReadonlySet<PointKind> = new Set([
  "green_bunker",
  "fairway_bunker",
  "water",
  "trees",
  "marker_100",
  "marker_150",
  "marker_200",
  "dogleg",
  "other",
]);

export function holeGeometry(points: readonly LayoutPoint[], hole: number): HoleGeometry {
  const mine = points.filter((p) => p.hole === hole);
  const first = (kind: PointKind): LatLng | null => {
    const p = mine.find((x) => x.kind === kind);
    return p ? { lat: p.lat, lng: p.lng } : null;
  };
  const teeFront = first("tee_front");
  const teeBack = first("tee_back");
  const greenFront = first("green_front");
  const greenBack = first("green_back");
  // A provider sometimes gives front and back but no centre; between the
  // two is a better centre than none.
  const greenCentre = first("green_centre") ?? (greenFront && greenBack ? midpoint(greenFront, greenBack) : greenFront ?? greenBack);
  const tee = teeBack ?? teeFront;
  return {
    hole,
    tee,
    teeFront,
    teeBack,
    greenFront,
    greenCentre,
    greenBack,
    hazards: mine.filter((p) => HAZARD_KINDS.has(p.kind)).map((p) => ({ lat: p.lat, lng: p.lng, kind: p.kind, label: p.label })),
    mapped: tee != null && greenCentre != null,
  };
}

/**
 * The hole measured from a tee the member dragged the T to (Oct 2026: the
 * mapped tee is one box — often the back — and you may be playing another,
 * or the map's tee may simply be in the wrong place).
 */
export function withTee(g: HoleGeometry, tee: LatLng | null): HoleGeometry {
  if (!tee) return g;
  return { ...g, tee, teeBack: tee, mapped: g.greenCentre != null };
}

/** Where the flag is on the green, by thirds front to back. */
export type PinZone = "front" | "middle" | "back";

/**
 * The flag colours most clubs use: red at the front of the green, yellow
 * (the course's standard is sometimes blue) in the middle, white at the back.
 */
export const PIN_COLOURS: Record<PinZone, string> = { front: "#d7322b", middle: "#f6c915", back: "#ffffff" };

/**
 * Which third of the green the pin is in, measured along the line from the
 * green's front edge to its back edge. Middle when the green has no front
 * and back mapped (nothing to measure against).
 */
export function pinZone(g: HoleGeometry, pin: LatLng): PinZone {
  if (!g.greenFront || !g.greenBack) return "middle";
  const k = Math.cos((g.greenFront.lat * Math.PI) / 180);
  const ax = (g.greenBack.lng - g.greenFront.lng) * k;
  const ay = g.greenBack.lat - g.greenFront.lat;
  const len2 = ax * ax + ay * ay;
  if (len2 === 0) return "middle";
  const t = (((pin.lng - g.greenFront.lng) * k) * ax + (pin.lat - g.greenFront.lat) * ay) / len2;
  return t < 1 / 3 ? "front" : t > 2 / 3 ? "back" : "middle";
}

/** The hole with the flag where the member put it: "centre" becomes the pin. */
export function withPin(g: HoleGeometry, pin: LatLng | null): HoleGeometry {
  if (!pin || !g.greenCentre) return g;
  return { ...g, greenCentre: pin };
}

/** Holes in the layout that can be drawn, in order. */
export function mappedHoles(points: readonly LayoutPoint[]): number[] {
  return [...new Set(points.map((p) => p.hole))].sort((a, b) => a - b).filter((h) => holeGeometry(points, h).mapped);
}

/** Hole length from the back tee (or front) to the centre of the green. */
export function holeLengthM(g: HoleGeometry): number | null {
  return g.tee && g.greenCentre ? distanceM(g.tee, g.greenCentre) : null;
}

// ---------------------------------------------------------------------------
// Where am I measuring from?
// ---------------------------------------------------------------------------

/**
 * A member more than this far from the green isn't on this hole (in the car
 * park, at home browsing the course, on another hole entirely): their
 * distances would be nonsense, so the screen measures from the tee instead
 * and says so. Generous enough for a par 5 with a bad drive.
 */
export const ON_HOLE_RADIUS_M = 750;

export type Origin = { from: "you" | "tee"; point: LatLng } | null;

export function measuringFrom(g: HoleGeometry, me: LatLng | null): Origin {
  if (me && g.greenCentre && distanceM(me, g.greenCentre) <= ON_HOLE_RADIUS_M) return { from: "you", point: me };
  if (g.tee) return { from: "tee", point: g.tee };
  if (me) return { from: "you", point: me };
  return null;
}

export type GreenDistances = { front: number | null; centre: number | null; back: number | null };

export function greenDistancesM(g: HoleGeometry, from: LatLng): GreenDistances {
  const d = (p: LatLng | null) => (p ? distanceM(from, p) : null);
  return { front: d(g.greenFront), centre: d(g.greenCentre), back: d(g.greenBack) };
}

/**
 * Hazards still in front of the player — nearer the green than they are —
 * nearest first, with the distance to reach each one. A bunker behind you
 * is not a decision you have to make.
 */
export function hazardsAheadM(g: HoleGeometry, from: LatLng): Array<Hazard & { distance: number }> {
  if (!g.greenCentre) return [];
  const toGreen = distanceM(from, g.greenCentre);
  return g.hazards
    .filter((h) => !h.kind.startsWith("marker_") && h.kind !== "dogleg")
    .filter((h) => distanceM(h, g.greenCentre!) < toGreen)
    .map((h) => ({ ...h, distance: distanceM(from, h) }))
    .sort((a, b) => a.distance - b.distance);
}

/** Tapping the map: how far it is to there, and from there to the green. */
export function tapDistancesM(g: HoleGeometry, from: LatLng, tap: LatLng): { toTap: number; tapToGreen: number | null } {
  return { toTap: distanceM(from, tap), tapToGreen: g.greenCentre ? distanceM(tap, g.greenCentre) : null };
}

/** How far out the aim circle starts: a good drive (~230 yds). */
export const AIM_DRIVE_M = 210;

/**
 * Where the aim circle starts (Oct 2026, the Hole19-style map): a drive's
 * length along the line to the green, so a par 4 opens showing "to the
 * aim, then the aim to the green" with nothing tapped. Null when the green
 * is within a drive (and a bit) — then the aim is the green itself. The
 * member drags it or taps anywhere to move it.
 */
export function defaultAim(g: HoleGeometry, from: LatLng): LatLng | null {
  if (!g.greenCentre) return null;
  const d = distanceM(from, g.greenCentre);
  if (d <= AIM_DRIVE_M + 30) return null;
  const t = Math.min(AIM_DRIVE_M, d - 80) / d;
  return { lat: from.lat + (g.greenCentre.lat - from.lat) * t, lng: from.lng + (g.greenCentre.lng - from.lng) * t };
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

export type Shot = LatLng & { shotNo: number; accuracyM: number | null };

export type ShotLeg = {
  shotNo: number;
  from: LatLng;
  /** Where the next shot was played from. Null for the last one marked. */
  to: LatLng | null;
  /** Length of the shot, i.e. to where the next one was played from. */
  distance: number | null;
  /** Left to the centre of the green from where this shot was played. */
  remaining: number | null;
};

/**
 * A player's shots on one hole as legs. A shot's length is only known once
 * the next one is marked: the ball's resting place IS where the next shot
 * is played from. Shot numbers that skip (one forgotten) still pair up in
 * order — the distance is then two shots' worth, which is honest about what
 * was measured.
 */
export function shotLegs(shots: readonly Shot[], g: HoleGeometry | null): ShotLeg[] {
  const ordered = [...shots].sort((a, b) => a.shotNo - b.shotNo);
  return ordered.map((s, i) => {
    const next = ordered[i + 1] ?? null;
    return {
      shotNo: s.shotNo,
      from: { lat: s.lat, lng: s.lng },
      to: next ? { lat: next.lat, lng: next.lng } : null,
      distance: next ? distanceM(s, next) : null,
      remaining: g?.greenCentre ? distanceM(s, g.greenCentre) : null,
    };
  });
}

/**
 * A fix this bad isn't worth marking a shot with: the dot could be in the
 * next fairway. The phone keeps refining its fix for a few seconds, so the
 * screen waits for one under this before enabling "Mark shot".
 */
export const USABLE_ACCURACY_M = 30;

export const fixIsUsable = (accuracyM: number | null | undefined): boolean =>
  accuracyM == null || accuracyM <= USABLE_ACCURACY_M;

// ---------------------------------------------------------------------------
// Framing the hole on the map
// ---------------------------------------------------------------------------

/**
 * What the map should show: every point on the hole, and the member if they
 * are on it. The map turns so the tee is at the bottom and the green at the
 * top, the way every yardage book draws a hole.
 */
export function holeFrame(g: HoleGeometry, me: LatLng | null): { points: LatLng[]; rotation: number } {
  const pts: LatLng[] = [g.tee, g.teeFront, g.greenFront, g.greenCentre, g.greenBack, ...g.hazards].filter(
    (p): p is LatLng => p != null
  );
  if (me && g.greenCentre && distanceM(me, g.greenCentre) <= ON_HOLE_RADIUS_M) pts.push(me);
  const rotation = g.tee && g.greenCentre ? bearingDeg(g.tee, g.greenCentre) : 0;
  return { points: pts, rotation };
}
