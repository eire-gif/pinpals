import { getFromSite } from "./api";
import { MAP_ATTRIBUTION, MAP_TILE_URL } from "./config";
import { esriSource, sourceFromServer, viewportQuery, nativeZoomAt, type ServerTiles, type TileSource } from "./map-tiles-rules";

export type { TileSource } from "./map-tiles-rules";
export { viewportQuery, nativeZoomAt } from "./map-tiles-rules";

/**
 * Which satellite photo the hole map loads (Oct 2026). The website decides
 * (GET /api/app/map-tiles — Google, or Esri if Google isn't set up or is
 * switched off), so changing provider never needs an app update. Asked
 * once per app session, and again when the Google session nears expiry.
 *
 * If the website can't be reached quickly the map goes ahead on Esri
 * rather than keeping a golfer on the tee waiting.
 */

const WAIT_MS = 4000;
let cached: { source: TileSource; until: number } | null = null;
let inFlight: Promise<TileSource> | null = null;

export function loadTileSource(): Promise<TileSource> {
  const esri = esriSource(MAP_TILE_URL, MAP_ATTRIBUTION);
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.source);
  if (inFlight) return inFlight;
  const ask = getFromSite<ServerTiles>("/api/app/map-tiles").then((t) => {
    const { source, until } = sourceFromServer(t, esri, Date.now());
    cached = { source, until };
    return source;
  });
  const timeout = new Promise<TileSource>((resolve) => setTimeout(() => resolve(esri), WAIT_MS));
  inFlight = Promise.race([ask.catch(() => esri), timeout]).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
