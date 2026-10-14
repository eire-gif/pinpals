import { describe, expect, it } from "vitest";
import { checkCreativeDimensions } from "@/lib/advertising";
import { CENTRED, cropRect, hasSlotShape, outputSize, panBy, preferPng } from "./fit-creative";

describe("hasSlotShape", () => {
  it("matches the server's 1% rule", () => {
    expect(hasSlotShape("takeover", 1080, 1920)).toBe(true);
    expect(hasSlotShape("banner", 1200, 300)).toBe(true);
    expect(hasSlotShape("takeover", 1179, 2556)).toBe(false); // iPhone screenshot
    expect(hasSlotShape("feed", 3024, 4032)).toBe(false); // iPhone photo
    expect(hasSlotShape("feed", 0, 100)).toBe(false);
  });
});

describe("cropRect", () => {
  it("takes the largest centred crop of the slot's shape", () => {
    // iPhone photo, portrait 3:4, into a square.
    expect(cropRect("feed", 3024, 4032)).toEqual({ sx: 0, sy: 504, sw: 3024, sh: 3024 });
    // iPhone screenshot into 9:16: full width, trimmed top and bottom.
    const r = cropRect("takeover", 1179, 2556);
    expect(r.sw).toBe(1179);
    expect(r.sh).toBeCloseTo(2096, 0);
    expect(r.sy).toBeCloseTo((2556 - 2096) / 2, 0);
    // Landscape photo into a 4:1 banner: full width.
    expect(cropRect("banner", 4032, 3024)).toMatchObject({ sx: 0, sw: 4032, sh: 1008 });
  });

  it("follows pan and zoom, and stays inside the image", () => {
    expect(cropRect("feed", 3024, 4032, { panX: 0.5, panY: 0, zoom: 1 }).sy).toBe(0);
    expect(cropRect("feed", 3024, 4032, { panX: 0.5, panY: 1, zoom: 1 }).sy).toBe(1008);
    const z = cropRect("feed", 3000, 3000, { panX: 1, panY: 1, zoom: 2 });
    expect(z).toEqual({ sx: 1500, sy: 1500, sw: 1500, sh: 1500 });
    // Out-of-range values are clamped.
    const wild = cropRect("feed", 3000, 3000, { panX: 9, panY: -4, zoom: 50 });
    expect(wild.sx + wild.sw).toBeLessThanOrEqual(3000);
    expect(wild.sy).toBe(0);
    expect(wild.sw).toBe(1000);
  });

  it("produces crops the server accepts", () => {
    for (const [slot, w, h] of [
      ["takeover", 1179, 2556],
      ["takeover", 3024, 4032],
      ["banner", 4032, 3024],
      ["feed", 3024, 4032],
      ["logo", 640, 480],
    ] as const) {
      const size = outputSize(slot, cropRect(slot, w, h, CENTRED));
      if ("error" in size) throw new Error(size.error);
      expect(checkCreativeDimensions(slot, size.width, size.height)).toBeNull();
    }
  });
});

describe("panBy", () => {
  it("dragging right reveals the left of the picture", () => {
    const next = panBy("feed", 4000, 3000, CENTRED, 100, 0, 300);
    expect(next.panX).toBeLessThan(0.5);
    expect(next.panY).toBe(0.5); // no vertical room in a landscape → square crop
  });

  it("stops at the edges", () => {
    expect(panBy("feed", 4000, 3000, CENTRED, 10_000, 0, 300).panX).toBe(0);
    expect(panBy("feed", 4000, 3000, CENTRED, -10_000, 0, 300).panX).toBe(1);
  });
});

describe("outputSize", () => {
  it("scales down to the ideal size but never up", () => {
    expect(outputSize("takeover", { sx: 0, sy: 0, sw: 3024, sh: 5376 })).toEqual({ width: 1080, height: 1920 });
    expect(outputSize("takeover", { sx: 0, sy: 0, sw: 900, sh: 1600 })).toEqual({ width: 900, height: 1600 });
  });

  it("refuses a crop narrower than the slot's minimum", () => {
    expect(outputSize("takeover", { sx: 0, sy: 0, sw: 600, sh: 1067 })).toMatchObject({ error: expect.stringMatching(/at least 720/) });
  });
});

describe("preferPng", () => {
  it("keeps PNG only for logos that were PNG", () => {
    expect(preferPng("logo", "image/png")).toBe(true);
    expect(preferPng("logo", "image/jpeg")).toBe(false);
    expect(preferPng("takeover", "image/png")).toBe(false);
  });
});
