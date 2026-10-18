import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FORMAT_CATEGORIES, GAME_FORMATS, formatById, formatsIn, popularFormats, relatedFormats, searchFormats } from "./game-formats";

describe("game formats", () => {
  it("is byte-identical in the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/game-formats.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/game-formats.ts"), "utf8");
    expect(app).toBe(site);
  });

  it("has 41 formats with unique ids and tile codes", () => {
    expect(GAME_FORMATS).toHaveLength(41);
    expect(new Set(GAME_FORMATS.map((f) => f.id)).size).toBe(GAME_FORMATS.length);
    expect(new Set(GAME_FORMATS.map((f) => f.code)).size).toBe(GAME_FORMATS.length);
  });

  it("gives every format a URL-safe id, a short code and real content", () => {
    for (const f of GAME_FORMATS) {
      expect(f.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(f.code.length).toBe(2);
      expect(f.steps.length, f.id).toBeGreaterThanOrEqual(3);
      for (const field of [f.name, f.blurb, f.intro, f.players, f.scoring, f.allowance, f.winner]) {
        expect(field.trim().length, f.id).toBeGreaterThan(0);
      }
    }
  });

  it("puts every format in a known category, and every category has some", () => {
    const ids = FORMAT_CATEGORIES.map((c) => c.id);
    for (const f of GAME_FORMATS) expect(ids).toContain(f.category);
    for (const c of FORMAT_CATEGORIES) expect(formatsIn(c.id).length).toBeGreaterThan(0);
  });

  it("only relates formats that exist, never to themselves", () => {
    for (const f of GAME_FORMATS) {
      for (const r of f.related ?? []) {
        expect(formatById(r), `${f.id} → ${r}`).toBeDefined();
        expect(r).not.toBe(f.id);
      }
      expect(relatedFormats(f)).toHaveLength((f.related ?? []).length);
    }
  });

  it("states the WHS allowances live scoring plays off", () => {
    expect(formatById("stableford")?.allowance).toContain("95%");
    expect(formatById("stroke-play")?.allowance).toContain("95%");
    expect(formatById("fourball-matchplay")?.allowance).toContain("90%");
    expect(formatById("fourball-better-ball")?.allowance).toContain("85%");
    expect(formatById("foursomes")?.allowance).toContain("50%");
    expect(formatById("greensomes")?.allowance).toMatch(/60%.*40%/);
    expect(formatById("texas-scramble")?.allowance).toMatch(/25%.*20%.*15%.*10%.*35%.*15%/);
  });

  it("has the three pictured formats and a short popular list", () => {
    expect(formatById("stableford")?.visual).toBe("points");
    expect(formatById("foursomes")?.visual).toBe("alternate");
    expect(formatById("texas-scramble")?.visual).toBe("scramble");
    const popular = popularFormats();
    expect(popular.length).toBeGreaterThanOrEqual(3);
    expect(popular.length).toBeLessThanOrEqual(8);
  });

  it("finds formats by name, other name and description", () => {
    expect(searchFormats("")).toHaveLength(41);
    expect(searchFormats("stableford")[0]?.id).toBe("stableford");
    expect(searchFormats("Stapleford")[0]?.id).toBe("stableford");
    expect(searchFormats("alternate shot").map((f) => f.id)).toContain("foursomes");
    expect(searchFormats("canadian").map((f) => f.id).slice(0, 2)).toEqual(expect.arrayContaining(["greensomes", "greensomes-matchplay"]));
    expect(searchFormats("skins")[0]?.id).toBe("skins");
    expect(searchFormats("three putt").map((f) => f.id)).toContain("snake");
    expect(searchFormats("cha cha cha")[0]?.id).toBe("waltz");
    expect(searchFormats("zzzz")).toHaveLength(0);
  });
});
