import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CATEGORIES, SUBCATEGORIES } from "./marketplace";
import { isBrandValidFor, setLearnedBrands, brandIdsFor, isKnownBrandId } from "./marketplace-brands";
import { SELL_TILES, normKey, subcategoryFor, tileByKey, tileFor, writeTitle, modelQuestion } from "./sell-flow";

describe("sell-flow.ts", () => {
  it("is the same file in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/sell-flow.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/sell-flow.ts"), "utf8");
    expect(app).toBe(site);
  });

  it("only uses the marketplace's own categories and subcategories", () => {
    for (const t of SELL_TILES) {
      expect(CATEGORIES as readonly string[], t.key).toContain(t.category);
      const subs = SUBCATEGORIES[t.category as (typeof CATEGORIES)[number]] as readonly string[];
      if (t.subcategory) expect(subs, t.key).toContain(t.subcategory);
      for (const k of t.kinds ?? []) expect(subs, `${t.key} ${k.label}`).toContain(k.subcategory);
    }
    // Every category can be reached from a tile.
    for (const c of CATEGORIES) expect(SELL_TILES.some((t) => t.category === c), c).toBe(true);
  });

  it("finds the tile back from a category and subcategory", () => {
    expect(tileFor("Bags & trolleys", "Electric trolleys")?.key).toBe("trolleys");
    expect(tileFor("Bags & trolleys", "Cart bags")?.key).toBe("bags");
    expect(tileFor("Balls & accessories", "Rangefinders / GPS")?.key).toBe("gps");
    expect(tileFor("Drivers", null)?.key).toBe("drivers");
    expect(subcategoryFor(tileByKey("trolleys")!, null)).toBe("Electric trolleys");
    expect(subcategoryFor(tileByKey("trolleys")!, "Push trolleys")).toBe("Push trolleys");
    expect(subcategoryFor(tileByKey("drivers")!, null)).toBe("");
  });

  it("matches what the database matches on", () => {
    expect(normKey("Qi 4D-Tour")).toBe("qi4dtour");
    expect(normKey("SUB70")).toBe(normKey("Sub 70"));
  });

  it("writes a plain title", () => {
    expect(writeTitle({ brandLabel: "TaylorMade", model: "Qi10 LS", tile: tileByKey("drivers"), loft: "9°", flex: "X-Stiff" })).toBe("TaylorMade Qi10 LS driver, 9° X-Stiff");
    expect(writeTitle({ brandLabel: "Motocaddy", model: "M5 GPS DHC", tile: tileByKey("trolleys"), kind: "Electric trolleys" })).toBe("Motocaddy M5 GPS DHC electric trolley");
    expect(writeTitle({ brandLabel: "FootJoy", model: "Premiere", tile: tileByKey("shoes"), size: "9" })).toBe("FootJoy Premiere golf shoes, size 9");
    expect(modelQuestion("Motocaddy", tileByKey("trolleys"))).toBe("Which Motocaddy trolley?");
  });
});

describe("brands learned from sellers (0164)", () => {
  it("are offered and accepted like curated ones once loaded", () => {
    expect(isBrandValidFor("kaiser-golf", "Irons")).toBe(false);
    setLearnedBrands([{ id: "kaiser-golf", label: "Kaiser Golf", aliases: [], categories: ["Irons"] }]);
    expect(isBrandValidFor("kaiser-golf", "Irons")).toBe(true);
    expect(isBrandValidFor("kaiser-golf", "Putters")).toBe(false);
    expect(brandIdsFor("Irons").at(-1)).toBe("kaiser-golf");
    expect(isKnownBrandId("kaiser-golf")).toBe(true);
    setLearnedBrands([]);
    expect(isKnownBrandId("kaiser-golf")).toBe(false);
  });
});
