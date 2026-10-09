import { distanceM, type LatLng, type LayoutPoint } from "./hole-geo";

/**
 * OpenStreetMap golf courses (Oct 2026, claude/hole-maps.md).
 *
 * Volunteers have drawn most Irish courses in OSM in remarkable detail —
 * Portmarnock has every green, fairway, tee and 159 bunkers, and a line for
 * each hole from tee to green. This file turns that into two things:
 *
 *   outlines   the shapes, drawn over the satellite photo so the hole
 *              reads like a yardage book;
 *   points     tee, green front / centre / back and the hazards beside the
 *              hole — the same LayoutPoints golfapi.io supplies — so a course
 *              golfapi hasn't covered still gets live yardages, free.
 *
 * Pure: the fetch is in osm-fetch.ts. OSM data is ODbL: the map credits
 * "© OpenStreetMap contributors" whenever outlines are drawn.
 */

export type OsmKind = "green" | "fairway" | "bunker" | "tee" | "water" | "hole" | "pin";

export type OsmFeature = {
  kind: OsmKind;
  /** Hole number for `hole` lines (OSM `ref`), else null. */
  ref: number | null;
  coords: LatLng[];
};

type OverpassElement = {
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { role?: string; geometry?: { lat: number; lon: number }[] }[];
};

function kindOf(tags: Record<string, string> | undefined): OsmKind | null {
  if (!tags) return null;
  const g = tags.golf;
  if (g === "green" || g === "fairway" || g === "bunker" || g === "tee" || g === "hole" || g === "pin") return g;
  if (g === "water_hazard" || g === "lateral_water_hazard" || tags.natural === "water") return "water";
  return null;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Overpass `out geom` JSON → features. Anything unrecognised is dropped. */
export function parseOverpass(json: unknown): OsmFeature[] {
  const els = (json as { elements?: OverpassElement[] } | null)?.elements;
  if (!Array.isArray(els)) return [];
  const out: OsmFeature[] = [];
  for (const e of els) {
    const kind = kindOf(e.tags);
    if (!kind) continue;
    const ref = kind === "hole" ? Number.parseInt(e.tags?.ref ?? "", 10) : NaN;
    if (e.type === "node" && typeof e.lat === "number" && typeof e.lon === "number") {
      out.push({ kind, ref: null, coords: [{ lat: round6(e.lat), lng: round6(e.lon) }] });
    } else if (e.type === "way" && e.geometry?.length) {
      out.push({ kind, ref: Number.isFinite(ref) ? ref : null, coords: e.geometry.map((p) => ({ lat: round6(p.lat), lng: round6(p.lon) })) });
    } else if (e.type === "relation" && e.members) {
      // Multipolygons (a big green with a hole in it, a lake): the outer rings.
      for (const m of e.members) {
        if ((m.role ?? "outer") === "outer" && m.geometry?.length) {
          out.push({ kind, ref: null, coords: m.geometry.map((p) => ({ lat: round6(p.lat), lng: round6(p.lon) })) });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Local geometry (metres on a flat patch: fine across one golf course)
// ---------------------------------------------------------------------------

type XY = { x: number; y: number };

function projector(origin: LatLng) {
  const kx = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = 110_540;
  return (p: LatLng): XY => ({ x: (p.lng - origin.lng) * kx, y: (p.lat - origin.lat) * ky });
}

function centroid(coords: LatLng[]): LatLng {
  const ring = coords.length > 1 && coords[0].lat === coords[coords.length - 1].lat && coords[0].lng === coords[coords.length - 1].lng ? coords.slice(0, -1) : coords;
  const n = ring.length || 1;
  return { lat: ring.reduce((s, p) => s + p.lat, 0) / n, lng: ring.reduce((s, p) => s + p.lng, 0) / n };
}

function pointInPolygon(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToLine(p: XY, line: XY[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distToSegment(p, line[i - 1], line[i]));
  return line.length === 1 ? Math.hypot(p.x - line[0].x, p.y - line[0].y) : best;
}

const lineLength = (coords: LatLng[]) => coords.slice(1).reduce((s, p, i) => s + distanceM(coords[i], p), 0);

// ---------------------------------------------------------------------------
// Which line is hole n
// ---------------------------------------------------------------------------

/**
 * The hole lines of one course, by number. A 27-hole club has three "1"s:
 * hole 1 is the candidate nearest the club's own position, and every later
 * hole the candidate whose tee is nearest the previous green — a course is
 * a walk, so that picks one consistent loop.
 */
export function holeLines(features: readonly OsmFeature[], clubAt: LatLng | null): Map<number, LatLng[]> {
  const byRef = new Map<number, LatLng[][]>();
  for (const f of features) {
    if (f.kind !== "hole" || f.ref == null || f.ref < 1 || f.ref > 18 || f.coords.length < 2) continue;
    if (!byRef.has(f.ref)) byRef.set(f.ref, []);
    byRef.get(f.ref)!.push(f.coords);
  }
  const chosen = new Map<number, LatLng[]>();
  let prevEnd: LatLng | null = clubAt;
  for (let n = 1; n <= 18; n++) {
    const cands = byRef.get(n);
    if (!cands?.length) {
      prevEnd = null;
      continue;
    }
    const pick: LatLng[] =
      cands.length === 1 || !prevEnd
        ? cands.reduce((a, b) => (lineLength(b) > lineLength(a) ? b : a))
        : cands.reduce((a, b) => (distanceM(prevEnd!, b[0]) < distanceM(prevEnd!, a[0]) ? b : a));
    chosen.set(n, pick);
    prevEnd = pick[pick.length - 1];
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// One hole's points, from the shapes
// ---------------------------------------------------------------------------

/** How close a bunker or water must be to the line of the hole to count. */
const HAZARD_NEAR_M = 40;
/** A bunker this close to the green centre is greenside. */
const GREENSIDE_M = 45;

export function osmHolePoints(features: readonly OsmFeature[], hole: number, line: LatLng[] | undefined): LayoutPoint[] {
  if (!line || line.length < 2) return [];
  const tee = line[0];
  const end = line[line.length - 1];
  const proj = projector(tee);
  const lineXY = line.map(proj);
  const endXY = proj(end);

  // The green the line ends on: the one containing its end, else the nearest within 60 m.
  const greens = features.filter((f) => f.kind === "green" && f.coords.length >= 3);
  let green = greens.find((g) => pointInPolygon(endXY, g.coords.map(proj)));
  if (!green) {
    const near = greens
      .map((g) => ({ g, d: distanceM(end, centroid(g.coords)) }))
      .filter((x) => x.d <= 60)
      .sort((a, b) => a.d - b.d)[0];
    green = near?.g;
  }

  const points: LayoutPoint[] = [{ hole, kind: "tee_back", lat: tee.lat, lng: tee.lng, label: null }];
  let centre: LatLng = end;
  if (green) {
    const gxy = green.coords.map(proj);
    const pin = features.find((f) => f.kind === "pin" && pointInPolygon(proj(f.coords[0]), gxy));
    centre = pin ? pin.coords[0] : centroid(green.coords);
    // Front and back: the green's nearest and farthest edge along the line of play.
    const from = line[line.length - 2];
    const fxy = proj(from);
    const dir = { x: endXY.x - fxy.x, y: endXY.y - fxy.y };
    const len = Math.hypot(dir.x, dir.y) || 1;
    const along = (p: XY) => ((p.x - fxy.x) * dir.x + (p.y - fxy.y) * dir.y) / len;
    let front = green.coords[0];
    let back = green.coords[0];
    for (let i = 0; i < gxy.length; i++) {
      if (along(gxy[i]) < along(proj(front))) front = green.coords[i];
      if (along(gxy[i]) > along(proj(back))) back = green.coords[i];
    }
    points.push({ hole, kind: "green_front", lat: front.lat, lng: front.lng, label: null });
    points.push({ hole, kind: "green_back", lat: back.lat, lng: back.lng, label: null });
  }
  points.push({ hole, kind: "green_centre", lat: centre.lat, lng: centre.lng, label: null });

  // Hazards beside the line of play: a bunker by its middle; water by its
  // nearest edge, because that's the carry that matters.
  const centreXY = proj(centre);
  for (const f of features) {
    if (f.kind === "bunker" && f.coords.length >= 3) {
      const c = centroid(f.coords);
      const cxy = proj(c);
      if (distToLine(cxy, lineXY) > HAZARD_NEAR_M) continue;
      const greenside = Math.hypot(cxy.x - centreXY.x, cxy.y - centreXY.y) <= GREENSIDE_M;
      points.push({ hole, kind: greenside ? "green_bunker" : "fairway_bunker", lat: c.lat, lng: c.lng, label: greenside ? "Greenside bunker" : "Fairway bunker" });
    } else if (f.kind === "water" && f.coords.length >= 2) {
      let best: { p: LatLng; d: number } | null = null;
      for (const p of f.coords) {
        const d = distToLine(proj(p), lineXY);
        if (!best || d < best.d) best = { p, d };
      }
      if (best && best.d <= HAZARD_NEAR_M) points.push({ hole, kind: "water", lat: best.p.lat, lng: best.p.lng, label: "Water" });
    }
  }
  return points;
}

/** Every hole OSM can map for this course, as LayoutPoints. */
export function osmLayoutPoints(features: readonly OsmFeature[], clubAt: LatLng | null): LayoutPoint[] {
  const lines = holeLines(features, clubAt);
  return [...lines.entries()].flatMap(([n, line]) => osmHolePoints(features, n, line));
}

/** Shapes worth drawing near a hole, so the web view isn't sent a whole county. */
export function outlinesNear(features: readonly OsmFeature[], around: LatLng[], radiusM = 700): OsmFeature[] {
  if (around.length === 0) return [];
  return features.filter((f) => f.kind !== "pin" && f.coords.some((p) => around.some((a) => distanceM(a, p) <= radiusM)));
}
