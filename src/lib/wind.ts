import "server-only";

import { createSign } from "node:crypto";

/**
 * The wind at a course, for the app's hole map (Oct 2026).
 *
 * Source, in order:
 *   1. Apple WeatherKit, when its four settings are in Vercel. Included with
 *      the Apple Developer Program (500,000 calls a month); works for the
 *      Android app too, because the call is made here, not on the phone.
 *        WEATHERKIT_TEAM_ID      Apple team id (10 characters)
 *        WEATHERKIT_SERVICE_ID   the Services ID made for WeatherKit
 *        WEATHERKIT_KEY_ID       the key's id
 *        WEATHERKIT_PRIVATE_KEY  the .p8 file's text (newlines as \n is fine)
 *   2. Open-Meteo otherwise — free, no key, but its free service is for
 *      non-commercial use: fine while testing, switch to WeatherKit before
 *      launch. WIND_PROVIDER=off turns wind off entirely.
 *
 * Each answer is kept for 10 minutes per ~1 km square, so a fourball
 * opening the map costs one call, not four.
 */

export type Wind = {
  /** km/h, 10 m above ground. */
  speedKmh: number;
  gustKmh: number | null;
  /** Where it blows FROM, degrees clockwise from north. */
  fromDeg: number;
  /** Shown under the wind, as each source's terms ask. */
  credit: string;
  creditUrl: string;
  at: string;
};

const TEN_MINUTES = 10 * 60 * 1000;
const cache = new Map<string, { at: number; wind: Wind }>();

const cell = (lat: number, lng: number) => `${lat.toFixed(2)},${lng.toFixed(2)}`;

export function windProvider(env: NodeJS.ProcessEnv = process.env): "weatherkit" | "open-meteo" | "off" {
  if (env.WIND_PROVIDER === "off") return "off";
  if (env.WEATHERKIT_TEAM_ID && env.WEATHERKIT_SERVICE_ID && env.WEATHERKIT_KEY_ID && env.WEATHERKIT_PRIVATE_KEY) return "weatherkit";
  return "open-meteo";
}

export async function windAt(lat: number, lng: number): Promise<Wind | null> {
  const provider = windProvider();
  if (provider === "off") return null;
  const key = `${provider}:${cell(lat, lng)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TEN_MINUTES) return hit.wind;
  const wind = provider === "weatherkit" ? await fromWeatherKit(lat, lng) : await fromOpenMeteo(lat, lng);
  if (wind) {
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: Date.now(), wind });
  }
  return wind;
}

async function fromOpenMeteo(lat: number, lng: number): Promise<Wind | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const d = (await res.json()) as { current?: { wind_speed_10m?: number; wind_direction_10m?: number; wind_gusts_10m?: number; time?: string } };
  const c = d.current;
  if (!c || typeof c.wind_speed_10m !== "number" || typeof c.wind_direction_10m !== "number") return null;
  return {
    speedKmh: c.wind_speed_10m,
    gustKmh: typeof c.wind_gusts_10m === "number" ? c.wind_gusts_10m : null,
    fromDeg: c.wind_direction_10m,
    credit: "Weather data by Open-Meteo.com",
    creditUrl: "https://open-meteo.com/",
    at: c.time ?? new Date().toISOString(),
  };
}

/** ES256 developer token for WeatherKit's REST API. */
export function weatherKitToken(env: NodeJS.ProcessEnv = process.env, now = Math.floor(Date.now() / 1000)): string {
  const team = env.WEATHERKIT_TEAM_ID!;
  const service = env.WEATHERKIT_SERVICE_ID!;
  const keyId = env.WEATHERKIT_KEY_ID!;
  const pem = env.WEATHERKIT_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid: keyId, id: `${team}.${service}` });
  const body = b64({ iss: team, iat: now, exp: now + 3600, sub: service });
  const signer = createSign("SHA256");
  signer.update(`${head}.${body}`);
  const sig = signer.sign({ key: pem, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${body}.${sig}`;
}

async function fromWeatherKit(lat: number, lng: number): Promise<Wind | null> {
  const url = `https://weatherkit.apple.com/api/v1/weather/en/${lat.toFixed(4)}/${lng.toFixed(4)}?dataSets=currentWeather`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${weatherKitToken()}` }, cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const d = (await res.json()) as { currentWeather?: { windSpeed?: number; windGust?: number; windDirection?: number; asOf?: string } };
  const c = d.currentWeather;
  if (!c || typeof c.windSpeed !== "number" || typeof c.windDirection !== "number") return null;
  return {
    speedKmh: c.windSpeed,
    gustKmh: typeof c.windGust === "number" ? c.windGust : null,
    fromDeg: c.windDirection,
    credit: "Apple Weather",
    creditUrl: "https://weatherkit.apple.com/legal-attribution.html",
    at: c.asOf ?? new Date().toISOString(),
  };
}
