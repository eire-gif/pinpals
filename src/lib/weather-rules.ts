/**
 * Weather across PinPals (Oct 2026) — the pure part, tested in
 * weather-rules.test.ts. Fetching is in weather.ts (server only).
 *
 * One shape for an hour of weather whichever service it came from, a plain
 * "kind" of weather in place of each service's own codes, and the summary
 * saved on a scorecard: what the round was played in.
 */

export const WEATHER_KINDS = ["clear", "partly", "cloudy", "fog", "drizzle", "showers", "rain", "snow", "thunder"] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

export type WeatherHour = {
  /** ISO time the hour starts, UTC. */
  at: string;
  tempC: number;
  /** km/h, 10 m above ground. */
  windKmh: number;
  gustKmh: number | null;
  /** Where the wind blows FROM, degrees clockwise from north. */
  fromDeg: number;
  /** Chance of rain, 0–100. Forecasts only. */
  rainPct: number | null;
  /** Rain in the hour, mm. */
  rainMm: number | null;
  kind: WeatherKind;
};

/** What a round was played in — saved on its scorecards (0182). */
export type RoundWeather = {
  v: 1;
  tempC: number;
  windKmh: number;
  gustKmh: number | null;
  fromDeg: number;
  /** Rain over the round, mm; null when the source didn't say. */
  rainMm: number | null;
  /** Rain enough to matter: 1 mm or more, or two hours of rain. */
  wet: boolean;
  kind: WeatherKind;
  /** The hours it covers, UTC. */
  from: string;
  to: string;
  credit: string;
};

/** Open-Meteo's WMO weather codes. */
export function kindFromWmo(code: number | null | undefined): WeatherKind {
  if (code == null) return "cloudy";
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 95) return "thunder";
  return "cloudy";
}

/** Apple WeatherKit's condition codes. */
export function kindFromWeatherKit(code: string | null | undefined): WeatherKind {
  switch (code) {
    case "Clear":
    case "MostlyClear":
    case "Hot":
      return "clear";
    case "PartlyCloudy":
    case "Breezy":
    case "Windy":
      return "partly";
    case "Foggy":
    case "Haze":
    case "Smoky":
    case "BlowingDust":
      return "fog";
    case "Drizzle":
    case "FreezingDrizzle":
      return "drizzle";
    case "SunShowers":
    case "ScatteredShowers":
      return "showers";
    case "Rain":
    case "HeavyRain":
    case "FreezingRain":
      return "rain";
    case "Flurries":
    case "SunFlurries":
    case "Snow":
    case "HeavySnow":
    case "Sleet":
    case "WintryMix":
    case "Blizzard":
    case "BlowingSnow":
    case "Frigid":
      return "snow";
    case "Thunderstorms":
    case "IsolatedThunderstorms":
    case "ScatteredThunderstorms":
    case "StrongStorms":
    case "Hurricane":
    case "TropicalStorm":
      return "thunder";
    default:
      return "cloudy";
  }
}

const WET: readonly WeatherKind[] = ["drizzle", "showers", "rain", "snow", "thunder"];
const round1 = (x: number) => Math.round(x * 10) / 10;

/** The average direction of the wind, weighted by its speed. */
function meanDirection(hours: readonly WeatherHour[]): number {
  let x = 0;
  let y = 0;
  for (const h of hours) {
    const r = (h.fromDeg * Math.PI) / 180;
    x += Math.cos(r) * Math.max(h.windKmh, 0.1);
    y += Math.sin(r) * Math.max(h.windKmh, 0.1);
  }
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((deg + 360) % 360);
}

/**
 * What a round was played in, from the hours it covers. Wind and temperature
 * are averages; gusts the strongest; rain the total. The kind is the
 * wettest weather that lasted, else the commonest sky.
 */
export function summariseRound(hours: readonly WeatherHour[], credit: string): RoundWeather | null {
  if (hours.length === 0) return null;
  const sorted = [...hours].sort((a, b) => a.at.localeCompare(b.at));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const gusts = sorted.map((h) => h.gustKmh).filter((g): g is number => g != null);
  const mm = sorted.map((h) => h.rainMm).filter((m): m is number => m != null);
  const rainMm = mm.length > 0 ? round1(mm.reduce((a, b) => a + b, 0)) : null;
  const wetHours = sorted.filter((h) => WET.includes(h.kind)).length;
  const count = (k: WeatherKind) => sorted.filter((h) => h.kind === k).length;

  let kind: WeatherKind;
  if (count("thunder") > 0) kind = "thunder";
  else if (count("snow") > 0) kind = "snow";
  else if (count("rain") >= 2) kind = "rain";
  else if (count("rain") + count("showers") > 0) kind = "showers";
  else if (count("drizzle") > 0) kind = "drizzle";
  else {
    const dry: WeatherKind[] = ["clear", "partly", "cloudy", "fog"];
    kind = dry.reduce((best, k) => (count(k) > count(best) ? k : best), "cloudy" as WeatherKind);
  }

  return {
    v: 1,
    tempC: round1(mean(sorted.map((h) => h.tempC))),
    windKmh: round1(mean(sorted.map((h) => h.windKmh))),
    gustKmh: gusts.length > 0 ? round1(Math.max(...gusts)) : null,
    fromDeg: meanDirection(sorted),
    rainMm,
    wet: (rainMm != null && rainMm >= 1) || wetHours >= 2,
    kind,
    from: sorted[0].at,
    to: sorted[sorted.length - 1].at,
    credit,
  };
}

const HOUR = 60 * 60 * 1000;

/**
 * The hours a card's round covers, UTC, on the hour. A live round: from when
 * it was set up to when it finished — never more than six hours, and four
 * and a half when it never finished. A card typed in by hand has only a
 * date, so it gets the middle of the day.
 */
export function roundWindow(card: { playedOn: string; startedAt: string | null; finishedAt: string | null }): { from: Date; to: Date } {
  if (card.startedAt) {
    const start = new Date(card.startedAt);
    const finished = card.finishedAt ? new Date(card.finishedAt) : null;
    const span = finished && finished > start ? Math.min(finished.getTime() - start.getTime(), 6 * HOUR) : 4.5 * HOUR;
    const from = new Date(Math.floor(start.getTime() / HOUR) * HOUR);
    const to = new Date(Math.floor((start.getTime() + Math.max(span, HOUR)) / HOUR) * HOUR);
    return { from, to };
  }
  return { from: new Date(`${card.playedOn}T09:00:00Z`), to: new Date(`${card.playedOn}T13:00:00Z`) };
}

/** The hours that fall inside a window, both ends included. */
export function hoursIn(hours: readonly WeatherHour[], from: Date, to: Date): WeatherHour[] {
  const a = from.getTime();
  const b = to.getTime();
  return hours.filter((h) => {
    const t = Date.parse(h.at);
    return t >= a && t <= b;
  });
}

/**
 * Whether a card is ready for its weather: the round is over. A live round
 * still going (and less than eight hours old) waits; a card for today typed
 * in by hand waits until mid-afternoon.
 */
export function readyForWeather(card: { playedOn: string; startedAt: string | null; finishedAt: string | null }, now: Date): boolean {
  if (card.startedAt) {
    if (card.finishedAt) return true;
    return now.getTime() - Date.parse(card.startedAt) > 8 * HOUR;
  }
  return now.getTime() >= Date.parse(`${card.playedOn}T15:00:00Z`);
}
