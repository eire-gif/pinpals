import type { LatLng } from "./hole-geo";
import { parseOverpass, type OsmFeature } from "./osm-course";

/**
 * Fetching a course's OpenStreetMap shapes (claude/hole-maps.md).
 *
 * From the phone, straight to the public Overpass API: the shared mirrors
 * are unreliable from Supabase's servers (406s, 504s, timeouts — see
 * import-courses) but fine from a phone. One query per course per app
 * session, kept in memory; a course is ~150 KB of shapes once parsed.
 *
 * Overpass is a free, shared service: never call this in a loop or on a
 * timer, only when a member opens a hole map.
 */

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** Metres around the club's position. Big enough for a 27-hole estate. */
const RADIUS_M = 2000;

const cache = new Map<number, Promise<OsmFeature[]>>();

function query(at: LatLng): string {
  const a = `(around:${RADIUS_M},${at.lat.toFixed(5)},${at.lng.toFixed(5)})`;
  return `[out:json][timeout:40];(way["golf"]${a};relation["golf"]${a};node["golf"="pin"]${a};way["natural"="water"]${a};way["golf"~"water_hazard"]${a};);out geom;`;
}

async function fetchOnce(url: string, body: string): Promise<OsmFeature[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(body)}`,
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    return parseOverpass(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The course's shapes, or [] if OSM has none or every mirror failed. A
 * failure isn't cached, so the next time the map opens it tries again.
 */
export function loadCourseShapes(clubId: number, at: LatLng): Promise<OsmFeature[]> {
  const hit = cache.get(clubId);
  if (hit) return hit;
  const body = query(at);
  const p = (async () => {
    for (const url of ENDPOINTS) {
      try {
        return await fetchOnce(url, body);
      } catch {
        // Next mirror.
      }
    }
    throw new Error("No Overpass mirror answered");
  })();
  cache.set(clubId, p);
  p.catch(() => cache.delete(clubId));
  return p.catch(() => []);
}
