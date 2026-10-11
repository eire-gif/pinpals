/**
 * Satellite imagery for the app's hole maps (Oct 2026): Google Map Tiles
 * API 2D satellite, with Esri World Imagery as the fallback.
 *
 * The app's map is Leaflet in a web view and stays exactly as it is — the
 * T, flag, aim circle, lines, hazards, shots and outlines are all ours.
 * Only the photo underneath changes. This file decides which photo, and
 * for Google keeps one session token for everyone (Google: one token can
 * be used across many clients; it lasts about two weeks).
 *
 * Settings (Vercel):
 *   GOOGLE_MAP_TILES_KEY          creates sessions; required for Google.
 *   GOOGLE_MAP_TILES_BROWSER_KEY  optional second key for the tile URLs
 *                                 the app's map loads (same project), so
 *                                 that one can carry a website restriction.
 *                                 Without it, the first key is used.
 *   MAP_TILES_PROVIDER=esri       the off switch: back to Esri at once,
 *                                 no app update needed.
 *
 * Google's rules this follows (developers.google.com/maps/documentation/
 * tile/policies): the Google Maps logo and the viewport's copyright string
 * on the map — the app's map page draws both; no caching beyond what the
 * response headers allow — the web view's normal HTTP cache; no offline use.
 */

export type MapTiles =
  | { provider: "esri" }
  | {
      provider: "google";
      /** Leaflet template: {z}/{x}/{y} filled in by the map. */
      tileUrl: string;
      /** Add &zoom=&north=&south=&east=&west= for the copyright string. */
      viewportUrl: string;
      /** Epoch ms after which the app should ask again. */
      expiresAt: number;
    };

type Session = { token: string; expiresAt: number };

export type MapTilesEnv = {
  GOOGLE_MAP_TILES_KEY?: string;
  GOOGLE_MAP_TILES_BROWSER_KEY?: string;
  MAP_TILES_PROVIDER?: string;
};

const TILE_BASE = "https://tile.googleapis.com";
/** Hand out a session only while it has at least this long left. */
const MIN_LIFE_MS = 24 * 60 * 60 * 1000;

/** Which provider the settings ask for. */
export function chooseProvider(env: MapTilesEnv): "google" | "esri" {
  if ((env.MAP_TILES_PROVIDER ?? "").trim().toLowerCase() === "esri") return "esri";
  return env.GOOGLE_MAP_TILES_KEY?.trim() ? "google" : "esri";
}

/** The URLs the app needs for a session. */
export function googleTiles(session: Session, browserKey: string): MapTiles {
  const q = `session=${encodeURIComponent(session.token)}&key=${encodeURIComponent(browserKey)}`;
  return {
    provider: "google",
    tileUrl: `${TILE_BASE}/v1/2dtiles/{z}/{x}/{y}?${q}`,
    viewportUrl: `${TILE_BASE}/tile/v1/viewport?${q}`,
    // Ask again a day before Google's expiry, so a round never straddles it.
    expiresAt: session.expiresAt - MIN_LIFE_MS,
  };
}

/** Google's createSession response → our session, or null if it's not one. */
export function parseSession(body: unknown, now: number): Session | null {
  const b = body as { session?: unknown; expiry?: unknown } | null;
  if (!b || typeof b.session !== "string" || !b.session) return null;
  const expirySec = Number(b.expiry);
  // Missing or odd expiry: assume Google's documented two weeks.
  const expiresAt = Number.isFinite(expirySec) && expirySec > 0 ? expirySec * 1000 : now + 14 * 24 * 60 * 60 * 1000;
  return expiresAt - now > MIN_LIFE_MS ? { token: b.session, expiresAt } : null;
}

let cached: Session | null = null;

/** Exposed for tests. */
export function resetMapTilesCache() {
  cached = null;
}

/**
 * The tiles for the app to use now. Never throws: any trouble reaching
 * Google means Esri for this request, and the next request tries again.
 */
export async function currentMapTiles(
  env: MapTilesEnv = process.env as MapTilesEnv,
  fetcher: typeof fetch = fetch,
  now: number = Date.now()
): Promise<MapTiles> {
  if (chooseProvider(env) === "esri") return { provider: "esri" };
  const key = env.GOOGLE_MAP_TILES_KEY!.trim();
  const browserKey = env.GOOGLE_MAP_TILES_BROWSER_KEY?.trim() || key;

  if (!cached || cached.expiresAt - now <= MIN_LIFE_MS) {
    try {
      const res = await fetcher(`${TILE_BASE}/v1/createSession?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // highDpi + 2x: 512-pixel images covering the same ground as a
        // 256 tile, so the photo is sharp on a phone screen at no extra
        // tile count (billing is per tile, not per pixel).
        body: JSON.stringify({ mapType: "satellite", language: "en-GB", region: "IE", scale: "scaleFactor2x", highDpi: true }),
        cache: "no-store",
      });
      if (!res.ok) {
        console.error("map-tiles: createSession failed", res.status, (await res.text().catch(() => "")).slice(0, 300));
        return { provider: "esri" };
      }
      const session = parseSession(await res.json(), now);
      if (!session) {
        console.error("map-tiles: createSession returned no usable session");
        return { provider: "esri" };
      }
      cached = session;
    } catch (e) {
      console.error("map-tiles: createSession error", e);
      return { provider: "esri" };
    }
  }
  return googleTiles(cached, browserKey);
}
