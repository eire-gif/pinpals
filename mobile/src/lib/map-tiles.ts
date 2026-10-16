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
 * rather than keeping a golfer on the tee waiting — and switches to Google
 * as soon as the website's answer does arrive (settledTileSource), so a
 * slow start never leaves the whole hole on Esri.
 */

const WAIT_MS = 4000;
let cached: { source: TileSource; until: number } | null = null;
/** The website's answer being fetched now, without the 4-second limit. */
let asking: Promise<TileSource> | null = null;

const esriNow = () => esriSource(MAP_TILE_URL, MAP_ATTRIBUTION);

/** Ask the website (once at a time); Esri if it can't be reached. */
function ask(): Promise<TileSource> {
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.source);
  if (asking) return asking;
  const esri = esriNow();
  asking = getFromSite<ServerTiles>("/api/app/map-tiles")
    .then((t) => {
      const { source, until } = sourceFromServer(t, esri, Date.now());
      cached = { source, until };
      return source;
    })
    .catch(() => esri)
    .finally(() => {
      asking = null;
    });
  return asking;
}

/** The photo to open the map with: the website's answer, or Esri after 4 seconds. */
export function loadTileSource(): Promise<TileSource> {
  const esri = esriNow();
  const timeout = new Promise<TileSource>((resolve) => setTimeout(() => resolve(esri), WAIT_MS));
  return Promise.race([ask(), timeout]);
}

/** The website's answer however long it takes (no 4-second limit) — for
 *  switching an open map from Esri to Google once it's known. */
export function settledTileSource(): Promise<TileSource> {
  return ask();
}
