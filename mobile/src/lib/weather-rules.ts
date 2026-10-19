import { entriesCloseAt } from "./outing-rules";
import type { Figure } from "./scoring-patterns";

/**
 * Weather in the app (Oct 2026) — pure, tested in weather-rules.test.ts.
 * The shapes match the website's (src/lib/weather-rules.ts): an hour of
 * weather, and the summary saved on a scorecard (0182).
 *
 *   - the strip on live scoring: now, and whether rain is close
 *   - the forecast on an upcoming round: the hours from the tee time
 *   - the conditions line on a scorecard
 *   - My Game: how you score in wind and rain
 */

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "showers" | "rain" | "snow" | "thunder";

export type WeatherHour = {
  at: string;
  tempC: number;
  windKmh: number;
  gustKmh: number | null;
  fromDeg: number;
  rainPct: number | null;
  rainMm: number | null;
  kind: WeatherKind;
};

export type Forecast = { hours: WeatherHour[]; credit: string; creditUrl: string; at: string };

export type RoundWeather = {
  v: 1;
  tempC: number;
  windKmh: number;
  gustKmh: number | null;
  fromDeg: number;
  rainMm: number | null;
  wet: boolean;
  kind: WeatherKind;
  from: string;
  to: string;
  credit: string;
};

export const KMH_PER_MPH = 1.609344;

export const KIND_LABEL: Record<WeatherKind, string> = {
  clear: "Sunny",
  partly: "Sunny spells",
  cloudy: "Cloudy",
  fog: "Mist",
  drizzle: "Drizzle",
  showers: "Showers",
  rain: "Rain",
  snow: "Sleet or snow",
  thunder: "Thunder",
};

/** An Ionicons name for each kind (plain strings: no icon package here). */
export const KIND_ICON: Record<WeatherKind, string> = {
  clear: "sunny-outline",
  partly: "partly-sunny-outline",
  cloudy: "cloudy-outline",
  fog: "cloudy-outline",
  drizzle: "rainy-outline",
  showers: "rainy-outline",
  rain: "rainy-outline",
  snow: "snow-outline",
  thunder: "thunderstorm-outline",
};

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** "SW" — where the wind comes from. */
export function compass(fromDeg: number): string {
  return POINTS[Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8];
}

export const tempLabel = (c: number) => `${Math.round(c)}°`;

/** "14 mph" or "22 km/h", in the member's unit (yards → mph, as the hole map's wind). */
export const speedLabel = (kmh: number, mph: boolean) => (mph ? `${Math.round(kmh / KMH_PER_MPH)} mph` : `${Math.round(kmh)} km/h`);

/** "18 mph, gusts 27" */
export function windLabel(kmh: number, gustKmh: number | null, mph: boolean): string {
  const gust = gustKmh != null && gustKmh - kmh >= 8 ? `, gusts ${mph ? Math.round(gustKmh / KMH_PER_MPH) : Math.round(gustKmh)}` : "";
  return `${speedLabel(kmh, mph)}${gust}`;
}

const HOUR = 3_600_000;

/** The hour that contains `now`, or the next one. */
export function hourNow(hours: readonly WeatherHour[], now: Date = new Date()): WeatherHour | null {
  const t = now.getTime();
  return hours.find((h) => Date.parse(h.at) <= t && t < Date.parse(h.at) + HOUR) ?? hours.find((h) => Date.parse(h.at) > t) ?? null;
}

/** Rain close by: the chance over this hour and the next, when it's 50% or more. */
export function rainSoon(hours: readonly WeatherHour[], now: Date = new Date()): { pct: number; inMinutes: number } | null {
  const t = now.getTime();
  const near = hours.filter((h) => Date.parse(h.at) + HOUR > t && Date.parse(h.at) < t + 2 * HOUR);
  for (const h of near) {
    const wet = h.rainPct != null ? h.rainPct >= 50 : h.rainMm != null && h.rainMm >= 0.3;
    if (wet) return { pct: h.rainPct ?? 60, inMinutes: Math.max(0, Math.round((Date.parse(h.at) - t) / 60000)) };
  }
  return null;
}

/** "Rain likely now" or "Rain likely in about 40 minutes". */
export function rainSoonLabel(r: { inMinutes: number }): string {
  if (r.inMinutes < 10) return "Rain likely now";
  return `Rain likely in about ${Math.round(r.inMinutes / 10) * 10} minutes`;
}

/** A round takes about four and a half hours from the tee. */
const ROUND_HOURS = 4.5;

/** "08:40" on "2026-10-24" in Ireland, as an instant. */
export function teeInstant(playDate: string, tee: string | null): Date {
  const midnight = entriesCloseAt(playDate);
  const [h, m] = (tee ?? "09:00").split(":").map(Number);
  return new Date(midnight.getTime() + ((h || 0) * 60 + (m || 0)) * 60000);
}

export type TeeForecast =
  | { state: "later"; from: string }
  | {
      state: "hours";
      hours: WeatherHour[];
      tempC: number;
      windKmh: number;
      gustKmh: number | null;
      fromDeg: number;
      rainPct: number | null;
      kind: WeatherKind;
    };

/**
 * The forecast for a round from its tee time: the hours it covers and a
 * one-line summary (warmest, windiest gust, likeliest rain, the kind that
 * matters most). Beyond the forecast: when it will appear. Over or no data:
 * null.
 */
export function teeForecast(hours: readonly WeatherHour[], playDate: string, tee: string | null, now: Date = new Date()): TeeForecast | null {
  const start = teeInstant(playDate, tee);
  const end = new Date(start.getTime() + ROUND_HOURS * HOUR);
  if (end.getTime() < now.getTime()) return null;
  const last = hours.length > 0 ? Date.parse(hours[hours.length - 1].at) : null;
  if (last == null || start.getTime() > last) {
    const from = new Date(start.getTime() - 9 * 24 * HOUR);
    return { state: "later", from: from.toISOString().slice(0, 10) };
  }
  const covered = hours.filter((h) => Date.parse(h.at) + HOUR > start.getTime() && Date.parse(h.at) < end.getTime());
  if (covered.length === 0) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const gusts = covered.map((h) => h.gustKmh).filter((g): g is number => g != null);
  const pcts = covered.map((h) => h.rainPct).filter((p): p is number => p != null);
  const order: WeatherKind[] = ["thunder", "snow", "rain", "showers", "drizzle", "fog", "cloudy", "partly", "clear"];
  const wettest = order.find((k) => covered.filter((h) => h.kind === k).length >= (k === "thunder" || k === "snow" ? 1 : 2));
  const kind = wettest ?? covered[Math.floor(covered.length / 2)].kind;
  return {
    state: "hours",
    hours: covered,
    tempC: mean(covered.map((h) => h.tempC)),
    windKmh: mean(covered.map((h) => h.windKmh)),
    gustKmh: gusts.length ? Math.max(...gusts) : null,
    fromDeg: covered[Math.floor(covered.length / 2)].fromDeg,
    rainPct: pcts.length ? Math.max(...pcts) : null,
    kind,
  };
}

/** "9° · wind 22 mph, gusts 35 from the W · showers, 3 mm" */
export function conditionsLine(w: RoundWeather, mph: boolean): string {
  const rain = w.rainMm != null && w.rainMm >= 0.5 ? `, ${Math.round(w.rainMm)} mm` : "";
  return `${tempLabel(w.tempC)} · wind ${windLabel(w.windKmh, w.gustKmh, mph)} from the ${compass(w.fromDeg)} · ${KIND_LABEL[w.kind].toLowerCase()}${rain}`;
}

/** Parse what the database holds; anything unexpected is no weather. */
export function asRoundWeather(raw: unknown): RoundWeather | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Partial<RoundWeather>;
  if (w.v !== 1 || typeof w.tempC !== "number" || typeof w.windKmh !== "number" || typeof w.fromDeg !== "number" || !w.kind || !(w.kind in KIND_LABEL)) return null;
  return w as RoundWeather;
}

// ---------------------------------------------------------------------------
// My Game: how you score in the weather
// ---------------------------------------------------------------------------

export type WeatherCard = {
  weather: RoundWeather | null;
  teamCard: string | null;
  holeList: { par: number; strokes: number | null }[];
};

const MIN = { early: 18, good: 72, unit: "holes" } as const;

function figure(overs: number[]): Figure<number> {
  if (overs.length < MIN.early) return { need: MIN.early - overs.length, unit: MIN.unit };
  const v = overs.reduce((a, b) => a + b, 0) / overs.length;
  return { value: Math.round(v * 100) / 100, n: overs.length, read: overs.length >= MIN.good ? "good" : "early" };
}

export type WeatherBands = {
  /** Cards with weather on them. */
  rounds: number;
  calm: Figure<number>;
  breezy: Figure<number>;
  windy: Figure<number>;
  dry: Figure<number>;
  wet: Figure<number>;
};

/** Average strokes over par a hole, by the wind (under 10, 10–20, over 20 mph) and by rain. */
export function weatherBands(cards: readonly WeatherCard[]): WeatherBands {
  const bucket = { calm: [] as number[], breezy: [] as number[], windy: [] as number[], dry: [] as number[], wet: [] as number[] };
  let rounds = 0;
  for (const c of cards) {
    if (!c.weather || c.teamCard) continue;
    const overs = c.holeList.filter((h) => h.strokes != null && h.strokes > 0).map((h) => h.strokes! - h.par);
    if (overs.length === 0) continue;
    rounds++;
    const mph = c.weather.windKmh / KMH_PER_MPH;
    (mph < 10 ? bucket.calm : mph <= 20 ? bucket.breezy : bucket.windy).push(...overs);
    (c.weather.wet ? bucket.wet : bucket.dry).push(...overs);
  }
  return {
    rounds,
    calm: figure(bucket.calm),
    breezy: figure(bucket.breezy),
    windy: figure(bucket.windy),
    dry: figure(bucket.dry),
    wet: figure(bucket.wet),
  };
}
