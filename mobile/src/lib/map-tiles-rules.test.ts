import { describe, expect, it } from "vitest";

import { esriSource, nativeZoomAt, sourceFromServer, viewportQuery } from "./map-tiles-rules";

const NOW = 1_800_000_000_000;
const ESRI = esriSource("https://esri/{z}/{y}/{x}", "Imagery © Esri");
const GOOGLE = {
  provider: "google" as const,
  tileUrl: "https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=S&key=K",
  viewportUrl: "https://tile.googleapis.com/tile/v1/viewport?session=S&key=K",
  expiresAt: NOW + 10 * 86_400_000,
};

describe("sourceFromServer", () => {
  it("uses Google's tiles until the session's own expiry", () => {
    expect(sourceFromServer(GOOGLE, ESRI, NOW)).toEqual({
      source: { provider: "google", url: GOOGLE.tileUrl, viewportUrl: GOOGLE.viewportUrl },
      until: GOOGLE.expiresAt,
    });
  });
  it("falls back to Esri for an Esri answer, nonsense, a stale session or a foreign host", () => {
    for (const bad of [
      { provider: "esri" as const },
      null,
      { ...GOOGLE, expiresAt: NOW - 1 },
      { ...GOOGLE, tileUrl: "https://evil.example/{z}/{x}/{y}" },
      { ...GOOGLE, tileUrl: "https://tile.googleapis.com/v1/2dtiles/fixed" },
    ]) {
      const r = sourceFromServer(bad, ESRI, NOW);
      expect(r.source).toBe(ESRI);
      expect(r.until).toBeGreaterThan(NOW);
    }
  });
});

describe("viewportQuery", () => {
  it("adds all five required parameters, rounded", () => {
    expect(viewportQuery(GOOGLE.viewportUrl, { zoom: 17.75, north: 53.4567891234, south: 53.44, east: -6.1, west: -6.123456789 })).toBe(
      `${GOOGLE.viewportUrl}&zoom=18&north=53.456789&south=53.44&east=-6.1&west=-6.123457`
    );
  });
});

describe("nativeZoomAt", () => {
  const rects = [
    { maxZoom: 19, north: 60, south: 50, east: 0, west: -12 },
    { maxZoom: 21, north: 53.5, south: 53.4, east: -6.0, west: -6.2 },
  ];
  it("takes the best rectangle covering the point, kept to 15–20", () => {
    expect(nativeZoomAt(rects, 53.45, -6.1)).toBe(20);
    expect(nativeZoomAt(rects, 52.0, -9.5)).toBe(19);
    expect(nativeZoomAt([{ maxZoom: 13, north: 1, south: -1, east: 1, west: -1 }], 0, 0)).toBe(15);
  });
  it("is null when nothing usable covers it", () => {
    expect(nativeZoomAt(rects, 10, 10)).toBeNull();
    expect(nativeZoomAt(undefined, 53, -6)).toBeNull();
    expect(nativeZoomAt([{ maxZoom: "20" }], 53, -6)).toBeNull();
  });
  it("handles a rectangle across the date line", () => {
    expect(nativeZoomAt([{ maxZoom: 18, north: 10, south: -10, east: -170, west: 170 }], 0, 175)).toBe(18);
  });
});
