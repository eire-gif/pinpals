import { createSign } from "node:crypto";

/**
 * Satellite imagery for the app's hole maps (Oct 2026): Apple Maps
 * (MapKit JS satellite), Google Map Tiles API 2D satellite, or Esri World
 * Imagery as the fallback.
 *
 * APPLE (from 17 Oct 2026). Google stopped serving satellite tiles to
 * accounts billed in the EEA (16 Oct, claude/map-tiles-setup.md). Apple's
 * photos can't be loaded as tiles; the app's map page runs Apple's own map
 * (MapKit JS) underneath ours and keeps it in step. This file only signs the
 * short-lived token MapKit JS asks for:
 *   MAPKIT_TEAM_ID       Apple team id (falls back to WEATHERKIT_TEAM_ID)
 *   MAPKIT_KEY_ID        id of a key with "MapKit JS" ticked
 *   MAPKIT_PRIVATE_KEY   that key's .p8 text (newlines as \n is fine)
 * Included with the Apple Developer Program: 250,000 map views a day.
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
 *   MAP_TILES_PROVIDER            esri | google | apple — force one; esri
 *                                 is the off switch (no app update needed).
 *                                 Unset: Apple if set up, else Google if a
 *                                 key is set, else Esri.
 *
 * Google's rules this follows (developers.google.com/maps/documentation/
 * tile/policies): the Google Maps logo and the viewport's copyright string
 * on the map — the app's map page draws both; no caching beyond what the
 * response headers allow — the web view's normal HTTP cache; no offline use.
 */

export type MapTiles =
  | { provider: "esri" }
  | {
      provider: "apple";
      /** MapKit JS authorization token (a signed JWT). */
      token: string;
      /** Epoch ms after which the app should ask again. */
      expiresAt: number;
    }
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
  MAPKIT_TEAM_ID?: string;
  MAPKIT_KEY_ID?: string;
  MAPKIT_PRIVATE_KEY?: string;
  WEATHERKIT_TEAM_ID?: string;
  GOOGLE_MAP_TILES_KEY?: string;
  GOOGLE_MAP_TILES_BROWSER_KEY?: string;
  MAP_TILES_PROVIDER?: string;
};

const TILE_BASE = "https://tile.googleapis.com";
/** Hand out a session only while it has at least this long left. */
const MIN_LIFE_MS = 24 * 60 * 60 * 1000;

const appleTeam = (env: MapTilesEnv) => (env.MAPKIT_TEAM_ID || env.WEATHERKIT_TEAM_ID || "").trim();
const appleReady = (env: MapTilesEnv) => Boolean(appleTeam(env) && env.MAPKIT_KEY_ID?.trim() && env.MAPKIT_PRIVATE_KEY?.trim());
const googleReady = (env: MapTilesEnv) => Boolean(env.GOOGLE_MAP_TILES_KEY?.trim());

/** Which provider the settings ask for. */
export function chooseProvider(env: MapTilesEnv): "apple" | "google" | "esri" {
  const forced = (env.MAP_TILES_PROVIDER ?? "").trim().toLowerCase();
  if (forced === "esri") return "esri";
  if (forced === "google") return googleReady(env) ? "google" : "esri";
  if (forced === "apple") return appleReady(env) ? "apple" : "esri";
  if (appleReady(env)) return "apple";
  return googleReady(env) ? "google" : "esri";
}

/** A MapKit JS token lasts a day; it's re-signed when under half is left,
 *  and the app asks again before then, so a round never straddles expiry. */
const APPLE_LIFE_S = 24 * 60 * 60;

/** MapKit JS authorization token: an ES256 JWT (header kid + typ; iss, iat, exp). */
export function mapKitToken(env: MapTilesEnv, nowS: number): string {
  const pem = env.MAPKIT_PRIVATE_KEY!.trim().replace(/\\n/g, "\n");
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid: env.MAPKIT_KEY_ID!.trim(), typ: "JWT" });
  const body = b64({ iss: appleTeam(env), iat: nowS, exp: nowS + APPLE_LIFE_S });
  const signer = createSign("SHA256");
  signer.update(`${head}.${body}`);
  const sig = signer.sign({ key: pem, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${body}.${sig}`;
}

let appleCached: { token: string; exp: number } | null = null;

function appleTiles(env: MapTilesEnv, now: number): MapTiles {
  const nowS = Math.floor(now / 1000);
  if (!appleCached || appleCached.exp - nowS < APPLE_LIFE_S / 2) {
    appleCached = { token: mapKitToken(env, nowS), exp: nowS + APPLE_LIFE_S };
  }
  // Ask again with at least 12 hours left on the token.
  return { provider: "apple", token: appleCached.token, expiresAt: (appleCached.exp - APPLE_LIFE_S / 2) * 1000 };
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

/**
 * What we ask Google for, best first. highDpi + 2x gives 512-pixel images
 * covering the same ground as a 256 tile (sharp on a phone, same tile count,
 * billing is per tile). If Google answers 400 to that for satellite, the
 * plain session is asked for instead.
 */
const SESSION_BODIES = [
  { mapType: "satellite", language: "en-GB", region: "IE", scale: "scaleFactor2x", highDpi: true },
  { mapType: "satellite", language: "en-GB", region: "IE" },
];

let cached: Session | null = null;

/** Exposed for tests. */
export function resetMapTilesCache() {
  cached = null;
  appleCached = null;
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
  const provider = chooseProvider(env);
  if (provider === "esri") return { provider: "esri" };
  if (provider === "apple") {
    try {
      return appleTiles(env, now);
    } catch (e) {
      // A key pasted wrongly: say so in the logs, and the map stays usable.
      console.error("map-tiles: MapKit token error", e instanceof Error ? e.message : e);
      return { provider: "esri" };
    }
  }
  const key = env.GOOGLE_MAP_TILES_KEY!.trim();
  const browserKey = env.GOOGLE_MAP_TILES_BROWSER_KEY?.trim() || key;

  if (!cached || cached.expiresAt - now <= MIN_LIFE_MS) {
    try {
      let session: Session | null = null;
      for (const body of SESSION_BODIES) {
        const res = await fetcher(`${TILE_BASE}/v1/createSession?key=${encodeURIComponent(key)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        });
        if (res.ok) {
          session = parseSession(await res.json(), now);
          break;
        }
        const reason = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
        console.error("map-tiles: createSession failed", res.status, JSON.stringify(body), reason);
        // 400 = Google didn't accept one of the options: try the plainer ask.
        // Anything else (bad key, API off, quota) won't be fixed by that.
        if (res.status !== 400) break;
      }
      if (!session) return { provider: "esri" };
      cached = session;
    } catch (e) {
      console.error("map-tiles: createSession error", e);
      return { provider: "esri" };
    }
  }
  return googleTiles(cached, browserKey);
}
