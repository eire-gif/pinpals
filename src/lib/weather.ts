import "server-only";

import { weatherKitToken, windProvider } from "@/lib/wind";
import { kindFromWeatherKit, kindFromWmo, type WeatherHour } from "@/lib/weather-rules";

/**
 * Weather at a course (Oct 2026): the next ten days hour by hour, and the
 * hours a past round was played in. Same sources, same switch and same
 * WeatherKit settings as the hole map's wind (src/lib/wind.ts): WeatherKit
 * when its four settings are in Vercel, else Open-Meteo; WIND_PROVIDER=off
 * turns weather off too.
 *
 * Forecasts are kept 30 minutes per ~1 km square, so everyone looking at
 * rounds at one course costs one call.
 */

export type Forecast = {
  /** The hour now and the next ten days, UTC, oldest first. */
  hours: WeatherHour[];
  credit: string;
  creditUrl: string;
  at: string;
};

const CREDITS = {
  "open-meteo": { credit: "Weather data by Open-Meteo.com", creditUrl: "https://open-meteo.com/" },
  weatherkit: { credit: "Apple Weather", creditUrl: "https://weatherkit.apple.com/legal-attribution.html" },
} as const;

export function weatherCredit(): { credit: string; creditUrl: string } | null {
  const p = windProvider();
  return p === "off" ? null : CREDITS[p];
}

const THIRTY_MINUTES = 30 * 60 * 1000;
const cache = new Map<string, { at: number; forecast: Forecast }>();
const cell = (lat: number, lng: number) => `${lat.toFixed(2)},${lng.toFixed(2)}`;

export async function forecastAt(lat: number, lng: number): Promise<Forecast | null> {
  const provider = windProvider();
  if (provider === "off") return null;
  const key = `${provider}:${cell(lat, lng)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < THIRTY_MINUTES) return hit.forecast;
  const now = new Date();
  const start = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const end = new Date(start.getTime() + 10 * 24 * 3_600_000);
  const hours = provider === "weatherkit" ? await weatherKitHours(lat, lng, start, end) : await openMeteoForecast(lat, lng);
  if (!hours || hours.length === 0) return null;
  const forecast: Forecast = { hours: hours.filter((h) => Date.parse(h.at) >= start.getTime()), ...CREDITS[provider], at: now.toISOString() };
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), forecast });
  return forecast;
}

/** The hours between two times in the past (a round). Null if the service couldn't say. */
export async function pastHours(lat: number, lng: number, from: Date, to: Date): Promise<WeatherHour[] | null> {
  const provider = windProvider();
  if (provider === "off") return null;
  if (provider === "weatherkit") return weatherKitHours(lat, lng, from, new Date(to.getTime() + 3_600_000));
  return openMeteoPast(lat, lng, from, to);
}

// ---------------------------------------------------------------------------
// Open-Meteo
// ---------------------------------------------------------------------------

const OM_HOURLY = "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m";

type OmHourly = {
  time?: number[];
  temperature_2m?: (number | null)[];
  precipitation?: (number | null)[];
  precipitation_probability?: (number | null)[];
  weather_code?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_direction_10m?: (number | null)[];
  wind_gusts_10m?: (number | null)[];
};

function omHours(h: OmHourly | undefined): WeatherHour[] {
  if (!h?.time) return [];
  const out: WeatherHour[] = [];
  h.time.forEach((t, i) => {
    const temp = h.temperature_2m?.[i];
    const wind = h.wind_speed_10m?.[i];
    const dir = h.wind_direction_10m?.[i];
    if (temp == null || wind == null || dir == null) return;
    out.push({
      at: new Date(t * 1000).toISOString(),
      tempC: temp,
      windKmh: wind,
      gustKmh: h.wind_gusts_10m?.[i] ?? null,
      fromDeg: dir,
      rainPct: h.precipitation_probability?.[i] ?? null,
      rainMm: h.precipitation?.[i] ?? null,
      kind: kindFromWmo(h.weather_code?.[i]),
    });
  });
  return out;
}

async function omFetch(url: string): Promise<WeatherHour[] | null> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const d = (await res.json()) as { hourly?: OmHourly };
  return omHours(d.hourly);
}

const ll = (lat: number, lng: number) => `latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`;

function openMeteoForecast(lat: number, lng: number): Promise<WeatherHour[] | null> {
  return omFetch(
    `https://api.open-meteo.com/v1/forecast?${ll(lat, lng)}&hourly=${OM_HOURLY},precipitation_probability&forecast_days=10&past_hours=1&wind_speed_unit=kmh&timeformat=unixtime&timezone=GMT`
  );
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The forecast service keeps about three months back; older rounds come
 * from the archive, which runs about five days behind.
 */
async function openMeteoPast(lat: number, lng: number, from: Date, to: Date): Promise<WeatherHour[] | null> {
  const recent = Date.now() - from.getTime() < 85 * 24 * 3_600_000;
  const base = recent ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
  const hours = await omFetch(
    `${base}?${ll(lat, lng)}&hourly=${OM_HOURLY}&start_date=${day(from)}&end_date=${day(to)}&wind_speed_unit=kmh&timeformat=unixtime&timezone=GMT`
  );
  if (!hours) return null;
  return hours.filter((h) => Date.parse(h.at) >= from.getTime() && Date.parse(h.at) <= to.getTime());
}

// ---------------------------------------------------------------------------
// Apple WeatherKit
// ---------------------------------------------------------------------------

type WkHour = {
  forecastStart?: string;
  temperature?: number;
  windSpeed?: number;
  windGust?: number;
  windDirection?: number;
  precipitationChance?: number;
  precipitationAmount?: number;
  conditionCode?: string;
};

async function weatherKitHours(lat: number, lng: number, from: Date, to: Date): Promise<WeatherHour[] | null> {
  const url =
    `https://weatherkit.apple.com/api/v1/weather/en/${lat.toFixed(4)}/${lng.toFixed(4)}` +
    `?dataSets=forecastHourly&hourlyStart=${encodeURIComponent(from.toISOString())}&hourlyEnd=${encodeURIComponent(to.toISOString())}&timezone=Etc/UTC`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${weatherKitToken()}` }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const d = (await res.json()) as { forecastHourly?: { hours?: WkHour[] } };
  const out: WeatherHour[] = [];
  for (const h of d.forecastHourly?.hours ?? []) {
    if (!h.forecastStart || h.temperature == null || h.windSpeed == null || h.windDirection == null) continue;
    out.push({
      at: new Date(h.forecastStart).toISOString(),
      tempC: h.temperature,
      windKmh: h.windSpeed,
      gustKmh: h.windGust ?? null,
      fromDeg: h.windDirection,
      rainPct: h.precipitationChance == null ? null : Math.round(h.precipitationChance * 100),
      rainMm: h.precipitationAmount ?? null,
      kind: kindFromWeatherKit(h.conditionCode),
    });
  }
  return out;
}
