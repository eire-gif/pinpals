/**
 * The pure half of map-tiles.ts (no fetch, no React), tested in
 * map-tiles-rules.test.ts.
 */

export type TileSource =
  | { provider: "esri"; url: string; attribution: string }
  /** Apple's map (MapKit JS) under ours; Esri's url + credit are the
   *  backup if Apple's map can't start. */
  | { provider: "apple"; token: string; url: string; attribution: string }
  | { provider: "google"; url: string; viewportUrl: string };

/** What /api/app/map-tiles answers (src/lib/map-tiles.ts on the website). */
export type ServerTiles =
  | { provider: "esri" }
  | { provider: "apple"; token: string; expiresAt: number }
  | { provider: "google"; tileUrl: string; viewportUrl: string; expiresAt: number };

export const esriSource = (url: string, attribution: string): TileSource => ({ provider: "esri", url, attribution });

/** How long to keep using an Esri answer before asking again: short, so
 *  switching Google on (or back on) reaches a phone within minutes. */
const ESRI_RECHECK_MS = 2 * 60 * 1000;

/** The website's answer → what the map loads, and until when. */
export function sourceFromServer(t: ServerTiles | null | undefined, esri: TileSource, now: number): { source: TileSource; until: number } {
  if (
    t &&
    t.provider === "apple" &&
    typeof t.token === "string" &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t.token) &&
    typeof t.expiresAt === "number" &&
    t.expiresAt > now &&
    esri.provider === "esri"
  ) {
    return { source: { provider: "apple", token: t.token, url: esri.url, attribution: esri.attribution }, until: t.expiresAt };
  }
  if (
    t &&
    t.provider === "google" &&
    typeof t.tileUrl === "string" &&
    t.tileUrl.startsWith("https://tile.googleapis.com/") &&
    t.tileUrl.includes("{z}") &&
    typeof t.viewportUrl === "string" &&
    t.viewportUrl.startsWith("https://tile.googleapis.com/") &&
    typeof t.expiresAt === "number" &&
    t.expiresAt > now
  ) {
    return { source: { provider: "google", url: t.tileUrl, viewportUrl: t.viewportUrl }, until: t.expiresAt };
  }
  return { source: esri, until: now + ESRI_RECHECK_MS };
}

export type ViewBox = { zoom: number; north: number; south: number; east: number; west: number };

/** Google's viewport request for a view (all five parameters are required). */
export function viewportQuery(viewportUrl: string, v: ViewBox): string {
  const r = (n: number) => String(Math.round(n * 1e6) / 1e6);
  const z = Math.max(0, Math.min(22, Math.round(v.zoom)));
  return `${viewportUrl}&zoom=${z}&north=${r(v.north)}&south=${r(v.south)}&east=${r(v.east)}&west=${r(v.west)}`;
}

type ZoomRect = { maxZoom?: unknown; north?: unknown; south?: unknown; east?: unknown; west?: unknown };

/** How far in Google's photos go at a point: the best of the rectangles
 *  covering it, kept to 15–20 (what the map uses), or null if unknown. */
export function nativeZoomAt(rects: unknown, lat: number, lng: number): number | null {
  if (!Array.isArray(rects)) return null;
  let best: number | null = null;
  for (const raw of rects as ZoomRect[]) {
    const { maxZoom, north, south, east, west } = raw ?? {};
    if (typeof maxZoom !== "number" || typeof north !== "number" || typeof south !== "number" || typeof east !== "number" || typeof west !== "number") continue;
    const inLat = lat <= north && lat >= south;
    const inLng = west <= east ? lng >= west && lng <= east : lng >= west || lng <= east;
    if (inLat && inLng && (best == null || maxZoom > best)) best = maxZoom;
  }
  if (best == null) return null;
  return Math.max(15, Math.min(20, Math.floor(best)));
}
