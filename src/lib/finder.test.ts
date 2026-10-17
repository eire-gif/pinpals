import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  brandTiles,
  chooseTopPicks,
  countsFrom,
  finderHeading,
  finderStep,
  matchModel,
  modelTiles,
  priceRange,
  suggestModels,
  topPicksSeed,
  totalForSale,
  withoutTopPicks,
  type FinderModel,
} from "./finder";
import modelsJson from "@/data/golf-models.json";
import brandsJson from "@/data/golf-brands.json";

const M = (id: string, family: string, year: number, versions: string[] = []): FinderModel => ({
  id,
  brandId: "taylormade",
  category: "Drivers",
  family,
  year,
  versions,
});

describe("finder.ts", () => {
  it("is the same file in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/finder.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/finder.ts"), "utf8");
    expect(app).toBe(site);
  });

  it("asks for club, then brand, then model", () => {
    expect(finderStep({ category: "", brand: "", model: "" })).toBe("category");
    expect(finderStep({ category: "", brand: "ping", model: "" })).toBe("category");
    expect(finderStep({ category: "Drivers", brand: "", model: "" })).toBe("brand");
    expect(finderStep({ category: "Drivers", brand: "ping", model: "" })).toBe("model");
    expect(finderStep({ category: "Drivers", brand: "ping", model: "ping-g430" })).toBe("done");
  });

  it("reads the counts and drops anything odd", () => {
    const counts = countsFrom([
      { level: "category", key: "Drivers", listing_count: "64", min_price_cents: 3500, max_price_cents: 42000 },
      { level: "category", key: "Irons", listing_count: 52 },
      { level: "brand", key: "ping", listing_count: "19" },
      { level: "nonsense", key: "x", listing_count: 1 },
      { level: "model", key: "", listing_count: 1 },
    ]);
    expect(counts).toHaveLength(3);
    expect(totalForSale(counts)).toBe(116);
    expect(countsFrom(null)).toEqual([]);
  });

  it("puts brands with something for sale first", () => {
    const counts = countsFrom([
      { level: "brand", key: "ping", listing_count: 2 },
      { level: "brand", key: "cobra", listing_count: 9 },
    ]);
    expect(brandTiles(["taylormade", "titleist", "ping", "cobra"], counts).map((b) => b.id)).toEqual(["cobra", "ping", "taylormade", "titleist"]);
  });

  it("splits models into for sale now and the rest, newest first", () => {
    const counts = countsFrom([{ level: "model", key: "tm-qi10", listing_count: 7 }]);
    const tiles = modelTiles([M("tm-sim", "SIM", 2020), M("tm-qi10", "Qi10", 2024), M("tm-qi35", "Qi35", 2025)], counts);
    expect(tiles.forSale.map((m) => m.family)).toEqual(["Qi10"]);
    expect(tiles.older.map((m) => m.family)).toEqual(["Qi35", "SIM"]);
  });

  it("shows prices and headings plainly", () => {
    expect(priceRange(18000, 29000)).toBe("€180–€290");
    expect(priceRange(25000, 25000)).toBe("€250");
    expect(priceRange(null, null)).toBe("");
    expect(finderHeading({ category: "Drivers", brand: "taylormade", model: "x" }, "TaylorMade", "Qi10")).toBe("TaylorMade Qi10 drivers");
    expect(finderHeading({ category: "Putters", brand: "", model: "" }, "", "")).toBe("Putters");
  });

  it("fills Top picks with Premium Plus first, three at most, and takes turns", () => {
    const ads = [1, 2, 3, 4, 5].map((id) => ({ id, premiumPlus: id === 5 }));
    for (const seed of [0, 1, 2, 3]) {
      const picks = chooseTopPicks(ads, seed);
      expect(picks).toHaveLength(3);
      expect(picks[0].id).toBe(5);
      expect(new Set(picks.map((p) => p.id)).size).toBe(3);
    }
    const seen = new Set<number>();
    for (let seed = 0; seed < 40; seed++) for (const p of chooseTopPicks(ads, seed)) seen.add(p.id);
    expect(seen.size).toBe(5);
    expect(chooseTopPicks(ads, 7)).toEqual(chooseTopPicks(ads, 7));
    expect(topPicksSeed(0)).toBe(topPicksSeed(599_999));
    expect(topPicksSeed(600_000)).toBe(1);
  });

  it("never shows a Top pick twice", () => {
    expect(withoutTopPicks([{ id: 1 }, { id: 2 }, { id: 3 }], [{ id: 2 }]).map((l) => l.id)).toEqual([1, 3]);
  });

  it("matches what a seller typed to a model", () => {
    const models = [M("tm-stealth", "Stealth", 2022), M("tm-stealth-2", "Stealth 2", 2023, ["Stealth 2 Plus"]), M("tm-qi10", "Qi10", 2024, ["Qi10 LS"])];
    expect(matchModel(models, "TaylorMade Stealth 2 Plus 9°")?.id).toBe("tm-stealth-2");
    expect(matchModel(models, "Stealth driver 10.5")?.id).toBe("tm-stealth");
    expect(matchModel(models, "Ping G430")).toBeNull();
    expect(suggestModels(models, "qi10 ls").map((m) => m.id)).toEqual(["tm-qi10"]);
    expect(suggestModels(models, "").map((m) => m.id)).toEqual(["tm-qi10", "tm-stealth-2", "tm-stealth"]);
  });
});

describe("the model catalogue (src/data/golf-models.json)", () => {
  const models = (modelsJson as { models: { id: string; brand: string; category: string; family: string; year: number; versions: string[] }[] }).models;
  const brands = brandsJson as unknown as { brands: { id: string }[]; categories: Record<string, { brands: string[] }> };

  it("only uses brands the category offers, with unique ids and families", () => {
    const ids = new Set<string>();
    const families = new Set<string>();
    for (const m of models) {
      expect(brands.categories[m.category]?.brands, `${m.id}`).toContain(m.brand);
      expect(ids.has(m.id), m.id).toBe(false);
      ids.add(m.id);
      const key = `${m.brand}|${m.category}|${m.family.toLowerCase()}`;
      expect(families.has(key), key).toBe(false);
      families.add(key);
      expect(m.id).toMatch(/^[a-z0-9][a-z0-9-]{1,90}$/);
      expect(m.family.length).toBeLessThanOrEqual(60);
      expect(m.year).toBeGreaterThanOrEqual(2000);
    }
    expect(models.length).toBeGreaterThan(300);
  });

  it("is what the migration seeds", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0163_marketplace_catalogue_top_picks.sql"), "utf8");
    for (const m of models) expect(sql, m.id).toContain(`('${m.id}', '${m.brand}'`);
  });
});
