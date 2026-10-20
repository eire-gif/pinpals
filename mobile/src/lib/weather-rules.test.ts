import { describe, expect, it } from "vitest";

import { asRoundWeather, compass, conditionsLine, hourNow, rainSoon, teeForecast, teeInstant, weatherBands, windLabel, type RoundWeather, type WeatherHour } from "./weather-rules";

const hour = (at: string, over: Partial<WeatherHour> = {}): WeatherHour => ({
  at,
  tempC: 10,
  windKmh: 24,
  gustKmh: 40,
  fromDeg: 225,
  rainPct: 10,
  rainMm: 0,
  kind: "partly",
  ...over,
});

const hoursFrom = (startIso: string, n: number, over: (i: number) => Partial<WeatherHour> = () => ({})) =>
  Array.from({ length: n }, (_, i) => hour(new Date(Date.parse(startIso) + i * 3_600_000).toISOString(), over(i)));

describe("labels", () => {
  it("names the wind's direction and speed, gusts only when they stand out", () => {
    expect(compass(225)).toBe("SW");
    expect(compass(355)).toBe("N");
    expect(windLabel(24, 40, true)).toBe("15 mph, gusts 25");
    expect(windLabel(24, 26, true)).toBe("15 mph");
    expect(windLabel(24, null, false)).toBe("24 km/h");
  });

  it("writes a card's conditions in one line", () => {
    const w: RoundWeather = { v: 1, tempC: 9.4, windKmh: 35, gustKmh: 56, fromDeg: 270, rainMm: 3.2, wet: true, kind: "showers", from: "a", to: "b", credit: "Apple Weather" };
    expect(conditionsLine(w, true)).toBe("9° · wind 22 mph, gusts 35 from the W · showers, 3 mm");
  });

  it("accepts only what the database should hold", () => {
    expect(asRoundWeather(null)).toBeNull();
    expect(asRoundWeather({ v: 2 })).toBeNull();
    expect(asRoundWeather({ v: 1, tempC: 1, windKmh: 1, fromDeg: 1, kind: "rain" })).not.toBeNull();
    expect(asRoundWeather({ v: 1, tempC: 1, windKmh: 1, fromDeg: 1, kind: "hail" })).toBeNull();
  });
});

describe("live", () => {
  const hours = hoursFrom("2026-10-24T08:00:00.000Z", 4, (i) => ({ rainPct: i === 1 ? 70 : 10 }));
  it("finds the hour now", () => {
    expect(hourNow(hours, new Date("2026-10-24T08:30:00Z"))?.at).toBe("2026-10-24T08:00:00.000Z");
  });
  it("warns when rain is likely within the hour or so", () => {
    expect(rainSoon(hours, new Date("2026-10-24T08:30:00Z"))).toEqual({ pct: 70, inMinutes: 30 });
    expect(rainSoon(hours, new Date("2026-10-24T10:30:00Z"))).toBeNull();
  });
});

describe("teeForecast", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const hours = hoursFrom("2026-10-20T12:00:00.000Z", 240, (i) => ({ kind: i % 24 === 0 ? "rain" : "partly", rainPct: i % 24 === 0 ? 80 : 10 }));

  it("turns an Irish tee time into the right instant, summer time included", () => {
    expect(teeInstant("2026-10-24", "08:40:00").toISOString()).toBe("2026-10-24T07:40:00.000Z");
    expect(teeInstant("2026-11-06", "09:30").toISOString()).toBe("2026-11-06T09:30:00.000Z");
  });

  it("summarises the hours from the tee", () => {
    const f = teeForecast(hours, "2026-10-24", "08:40:00", now);
    expect(f?.state).toBe("hours");
    if (f?.state !== "hours") return;
    expect(f.hours.length).toBe(6);
    expect(f.kind).toBe("partly");
    expect(f.rainPct).toBe(80);
  });

  it("says when the forecast will show for a round beyond it, and nothing for one that's over", () => {
    expect(teeForecast(hours, "2026-11-06", "09:30", now)).toEqual({ state: "later", from: "2026-10-28" });
    expect(teeForecast(hours, "2026-10-19", "09:30", now)).toBeNull();
  });
});

describe("weatherBands", () => {
  const w = (windKmh: number, wet: boolean): RoundWeather => ({ v: 1, tempC: 10, windKmh, gustKmh: null, fromDeg: 0, rainMm: null, wet, kind: "cloudy", from: "a", to: "b", credit: "x" });
  const card = (weather: RoundWeather | null, over: number, teamCard: string | null = null) => ({
    weather,
    teamCard,
    holeList: Array.from({ length: 18 }, () => ({ par: 4, strokes: 4 + over })),
  });

  it("averages strokes over par a hole by wind and by rain", () => {
    const b = weatherBands([card(w(10, false), 0), card(w(40, true), 2), card(null, 5), card(w(40, true), 9, "scramble")]);
    expect(b.rounds).toBe(2);
    expect(b.calm).toEqual({ value: 0, n: 18, read: "early" });
    expect(b.windy).toEqual({ value: 2, n: 18, read: "early" });
    expect(b.breezy).toEqual({ need: 18, unit: "holes" });
    expect(b.wet).toEqual({ value: 2, n: 18, read: "early" });
  });
});
