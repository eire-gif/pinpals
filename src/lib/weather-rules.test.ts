import { describe, expect, it } from "vitest";

import { hoursIn, kindFromWeatherKit, kindFromWmo, readyForWeather, roundWindow, summariseRound, type WeatherHour } from "./weather-rules";

const hour = (at: string, over: Partial<WeatherHour> = {}): WeatherHour => ({
  at,
  tempC: 10,
  windKmh: 20,
  gustKmh: 30,
  fromDeg: 270,
  rainPct: null,
  rainMm: 0,
  kind: "cloudy",
  ...over,
});

describe("weather kinds", () => {
  it("maps Open-Meteo's WMO codes", () => {
    expect(kindFromWmo(0)).toBe("clear");
    expect(kindFromWmo(2)).toBe("partly");
    expect(kindFromWmo(3)).toBe("cloudy");
    expect(kindFromWmo(45)).toBe("fog");
    expect(kindFromWmo(53)).toBe("drizzle");
    expect(kindFromWmo(63)).toBe("rain");
    expect(kindFromWmo(81)).toBe("showers");
    expect(kindFromWmo(75)).toBe("snow");
    expect(kindFromWmo(95)).toBe("thunder");
    expect(kindFromWmo(null)).toBe("cloudy");
  });

  it("maps WeatherKit's condition codes, unknown ones to cloudy", () => {
    expect(kindFromWeatherKit("MostlyClear")).toBe("clear");
    expect(kindFromWeatherKit("HeavyRain")).toBe("rain");
    expect(kindFromWeatherKit("ScatteredShowers")).toBe("showers");
    expect(kindFromWeatherKit("Thunderstorms")).toBe("thunder");
    expect(kindFromWeatherKit("SomethingNew")).toBe("cloudy");
  });
});

describe("summariseRound", () => {
  it("averages wind and temperature, takes the strongest gust and totals the rain", () => {
    const w = summariseRound(
      [
        hour("2026-10-10T10:00:00.000Z", { tempC: 8, windKmh: 30, gustKmh: 45, rainMm: 0.2, kind: "cloudy" }),
        hour("2026-10-10T09:00:00.000Z", { tempC: 6, windKmh: 20, gustKmh: 55, rainMm: 1.1, kind: "showers" }),
        hour("2026-10-10T11:00:00.000Z", { tempC: 10, windKmh: 40, gustKmh: 50, rainMm: 0, kind: "partly" }),
      ],
      "Apple Weather"
    )!;
    expect(w.tempC).toBe(8);
    expect(w.windKmh).toBe(30);
    expect(w.gustKmh).toBe(55);
    expect(w.rainMm).toBe(1.3);
    expect(w.wet).toBe(true);
    expect(w.kind).toBe("showers");
    expect(w.from).toBe("2026-10-10T09:00:00.000Z");
    expect(w.to).toBe("2026-10-10T11:00:00.000Z");
    expect(w.fromDeg).toBe(270);
  });

  it("calls two hours of rain rain, and a dry round its commonest sky", () => {
    expect(summariseRound([hour("a", { kind: "rain" }), hour("b", { kind: "rain" })], "x")!.kind).toBe("rain");
    const dry = summariseRound([hour("a", { kind: "clear" }), hour("b", { kind: "partly" }), hour("c", { kind: "partly" })], "x")!;
    expect(dry.kind).toBe("partly");
    expect(dry.wet).toBe(false);
  });

  it("averages directions around north rather than through south", () => {
    const w = summariseRound([hour("a", { fromDeg: 350 }), hour("b", { fromDeg: 10 })], "x")!;
    expect([0, 360]).toContain(w.fromDeg);
  });

  it("is null with no hours", () => {
    expect(summariseRound([], "x")).toBeNull();
  });
});

describe("roundWindow", () => {
  it("runs from set-up to finish on the hour, at most six hours", () => {
    const w = roundWindow({ playedOn: "2026-10-10", startedAt: "2026-10-10T08:40:00Z", finishedAt: "2026-10-10T12:55:00Z" });
    expect(w.from.toISOString()).toBe("2026-10-10T08:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    const long = roundWindow({ playedOn: "2026-10-10", startedAt: "2026-10-10T08:00:00Z", finishedAt: "2026-10-11T08:00:00Z" });
    expect(long.to.toISOString()).toBe("2026-10-10T14:00:00.000Z");
  });

  it("gives an unfinished round four and a half hours, and a hand-typed card the middle of the day", () => {
    expect(roundWindow({ playedOn: "2026-10-10", startedAt: "2026-10-10T08:00:00Z", finishedAt: null }).to.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    const manual = roundWindow({ playedOn: "2026-10-10", startedAt: null, finishedAt: null });
    expect(manual.from.toISOString()).toBe("2026-10-10T09:00:00.000Z");
    expect(manual.to.toISOString()).toBe("2026-10-10T13:00:00.000Z");
  });
});

describe("readyForWeather", () => {
  const now = new Date("2026-10-10T14:00:00Z");
  it("waits for a live round to finish, unless it was left going", () => {
    expect(readyForWeather({ playedOn: "2026-10-10", startedAt: "2026-10-10T09:00:00Z", finishedAt: null }, now)).toBe(false);
    expect(readyForWeather({ playedOn: "2026-10-10", startedAt: "2026-10-10T09:00:00Z", finishedAt: "2026-10-10T13:30:00Z" }, now)).toBe(true);
    expect(readyForWeather({ playedOn: "2026-10-09", startedAt: "2026-10-09T09:00:00Z", finishedAt: null }, now)).toBe(true);
  });
  it("waits for mid-afternoon on a hand-typed card for today", () => {
    expect(readyForWeather({ playedOn: "2026-10-10", startedAt: null, finishedAt: null }, now)).toBe(false);
    expect(readyForWeather({ playedOn: "2026-10-09", startedAt: null, finishedAt: null }, now)).toBe(true);
  });
});

describe("hoursIn", () => {
  it("keeps the hours inside the window, both ends included", () => {
    const hs = ["07", "08", "09", "10"].map((h) => hour(`2026-10-10T${h}:00:00.000Z`));
    expect(hoursIn(hs, new Date("2026-10-10T08:00:00Z"), new Date("2026-10-10T09:00:00Z")).map((h) => h.at.slice(11, 13))).toEqual(["08", "09"]);
  });
});
