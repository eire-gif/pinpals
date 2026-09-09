import { describe, expect, it } from "vitest";
import { CATEGORIES, SUBCATEGORIES } from "./marketplace";
import {
  ALL_BRAND_IDS,
  BRANDS,
  FALLBACK_BRANDS,
  brandIdsFor,
  brandLabel,
  brandsFor,
  displayBrand,
  isBrandValidFor,
  isKnownBrandId,
  isLegacyResale,
  normalizeBrandText,
  resolveBrandInput,
  sellableBrandsFor,
  specFieldsFor,
} from "./marketplace-brands";

// The taxonomy is data (src/data/golf-brands.json), and data drifts — a
// brand renamed in one place and not another, a subcategory list that no
// longer matches SUBCATEGORIES after someone edits marketplace.ts. These
// first tests are the guardrail for exactly that: they don't assert a
// hand-written expectation, they assert the file is internally consistent
// with the vocabulary the rest of the app already enforces.
describe("brand taxonomy integrity", () => {
  it("gives every category a non-empty, duplicate-free brand list", () => {
    for (const category of CATEGORIES) {
      const ids = brandIdsFor(category);
      expect(ids.length, category).toBeGreaterThan(0);
      expect(new Set(ids).size, category).toBe(ids.length);
    }
  });

  it("only references brands that exist", () => {
    const known = new Set(BRANDS.map((b) => b.id));
    for (const category of CATEGORIES) {
      for (const id of brandIdsFor(category)) {
        expect(known.has(id), `${category} -> ${id}`).toBe(true);
      }
    }
  });

  it("has no duplicate brand ids or labels", () => {
    expect(new Set(BRANDS.map((b) => b.id)).size).toBe(BRANDS.length);
    expect(new Set(BRANDS.map((b) => b.label)).size).toBe(BRANDS.length);
  });

  it("keeps every subcategory-narrowed list a subset of its category", () => {
    for (const category of CATEGORIES) {
      const all = new Set(brandIdsFor(category));
      for (const subcategory of SUBCATEGORIES[category]) {
        for (const id of brandIdsFor(category, subcategory)) {
          expect(all.has(id), `${category}/${subcategory} -> ${id}`).toBe(true);
        }
      }
    }
  });

  it("never leaves a valid category/subcategory pair with nothing to choose", () => {
    for (const category of CATEGORIES) {
      for (const subcategory of SUBCATEGORIES[category]) {
        expect(brandIdsFor(category, subcategory).length, `${category}/${subcategory}`).toBeGreaterThan(0);
      }
    }
  });

  it("unions every category's brands into ALL_BRAND_IDS without duplicates", () => {
    expect(new Set(ALL_BRAND_IDS).size).toBe(ALL_BRAND_IDS.length);
    for (const category of CATEGORIES) {
      for (const id of brandIdsFor(category)) {
        expect(ALL_BRAND_IDS).toContain(id);
      }
    }
  });
});

describe("brandIdsFor", () => {
  it("narrows to the brands that actually make that kind of item", () => {
    // A rangefinder is not made by a club manufacturer, and a golf ball is
    // not made by a grip manufacturer — the whole point of the per-subcategory
    // narrowing.
    expect(brandIdsFor("Balls & accessories", "Rangefinders / GPS")).toContain("bushnell");
    expect(brandIdsFor("Balls & accessories", "Rangefinders / GPS")).not.toContain("titleist");
    expect(brandIdsFor("Balls & accessories", "Golf balls")).toContain("titleist");
    expect(brandIdsFor("Balls & accessories", "Golf balls")).not.toContain("bushnell");
    expect(brandIdsFor("Balls & accessories", "Golf balls")).not.toContain("golf-pride");
  });

  it("excludes apparel-only houses from shoes", () => {
    expect(brandIdsFor("Shoes & apparel", "Shoes")).toContain("footjoy");
    expect(brandIdsFor("Shoes & apparel", "Shoes")).not.toContain("galvin-green");
  });

  it("offers trolley makers under trolleys and not bag-only brands", () => {
    expect(brandIdsFor("Bags & trolleys", "Electric trolleys")).toContain("motocaddy");
    expect(brandIdsFor("Bags & trolleys", "Electric trolleys")).toContain("powakaddy");
    expect(brandIdsFor("Bags & trolleys", "Electric trolleys")).not.toContain("titleist");
  });

  it("falls back to the whole category for a variant subcategory", () => {
    // "Left-handed" says nothing about who made the club.
    expect(brandIdsFor("Irons", "Left-handed")).toEqual(brandIdsFor("Irons"));
  });

  it("falls back to the whole category for an unrecognised subcategory", () => {
    expect(brandIdsFor("Drivers", "Not a real subcategory")).toEqual(brandIdsFor("Drivers"));
  });

  it("returns nothing for an unknown category rather than throwing", () => {
    expect(brandIdsFor("Tennis rackets")).toEqual([]);
    expect(brandsFor("Tennis rackets")).toEqual([]);
  });

  it("orders brands editorially, not alphabetically", () => {
    const drivers = brandIdsFor("Drivers");
    expect(drivers[0]).toBe("taylormade");
    expect(drivers.indexOf("taylormade")).toBeLessThan(drivers.indexOf("acer"));
  });
});

describe("sellableBrandsFor", () => {
  it("always offers Other and Unknown on top of the curated list", () => {
    const ids = sellableBrandsFor("Drivers").map((b) => b.id);
    expect(ids).toContain("other");
    expect(ids).toContain("unknown");
  });

  it("offers Mixed brands only where a mixed-brand item is a real thing", () => {
    expect(sellableBrandsFor("Full sets").map((b) => b.id)).toContain("mixed");
    expect(sellableBrandsFor("Balls & accessories").map((b) => b.id)).toContain("mixed");
    expect(sellableBrandsFor("Drivers").map((b) => b.id)).not.toContain("mixed");
  });

  it("accepts a fallback brand in any category it offers", () => {
    expect(isBrandValidFor("other", "Drivers")).toBe(true);
    expect(isBrandValidFor("unknown", "Putters")).toBe(true);
    expect(isBrandValidFor("mixed", "Full sets")).toBe(true);
    expect(isBrandValidFor("mixed", "Drivers")).toBe(false);
  });

  it("rejects a brand that belongs to a different category", () => {
    expect(isBrandValidFor("motocaddy", "Bags & trolleys")).toBe(true);
    expect(isBrandValidFor("motocaddy", "Wedges")).toBe(false);
    expect(isBrandValidFor("not-a-brand", "Drivers")).toBe(false);
  });

  it("rejects a brand that belongs to the category but not the subcategory", () => {
    expect(isBrandValidFor("bushnell", "Balls & accessories")).toBe(true);
    expect(isBrandValidFor("bushnell", "Balls & accessories", "Golf balls")).toBe(false);
  });
});

describe("isKnownBrandId", () => {
  it("knows curated brands and fallbacks, and nothing else", () => {
    expect(isKnownBrandId("titleist")).toBe(true);
    expect(isKnownBrandId("other")).toBe(true);
    expect(isKnownBrandId("Titleist")).toBe(false);
    expect(isKnownBrandId("'; drop table listings; --")).toBe(false);
  });
});

describe("brandLabel / displayBrand", () => {
  it("labels a known brand and falls back to the raw id for an unknown one", () => {
    expect(brandLabel("taylormade")).toBe("TaylorMade");
    expect(brandLabel("l-a-b-golf")).toBe("L.A.B. Golf");
    // A listing written by a newer deploy still has to render something.
    expect(brandLabel("brand-from-the-future")).toBe("brand-from-the-future");
  });

  it("shows the seller's own words for an Other listing", () => {
    expect(displayBrand({ brand: "other", brand_other: "Ben Sayers Ltd" })).toBe("Ben Sayers Ltd");
    expect(displayBrand({ brand: "titleist", brand_other: null })).toBe("Titleist");
    expect(displayBrand({ brand: null, brand_other: null })).toBeNull();
  });

  it("degrades to the fallback's own label if Other somehow lost its text", () => {
    expect(displayBrand({ brand: "other", brand_other: null })).toBe("Other");
  });
});

describe("normalizeBrandText", () => {
  it("folds case, spacing, punctuation and accents", () => {
    expect(normalizeBrandText("Taylor Made")).toBe(normalizeBrandText("TaylorMade"));
    expect(normalizeBrandText("  PING  ")).toBe("ping");
    expect(normalizeBrandText("Röhnisch")).toBe("rohnisch");
    expect(normalizeBrandText("G/FORE")).toBe("gfore");
    expect(normalizeBrandText("   ")).toBe("");
  });
});

describe("resolveBrandInput", () => {
  it("resolves canonical spellings and the obvious typos", () => {
    expect(resolveBrandInput("TaylorMade")).toEqual({ kind: "brand", brandId: "taylormade" });
    expect(resolveBrandInput("Taylor Made")).toEqual({ kind: "brand", brandId: "taylormade" });
    expect(resolveBrandInput("Titlest")).toEqual({ kind: "brand", brandId: "titleist" });
  });

  it("maps a product line onto its parent brand, keeping the line as a model", () => {
    // The rule that stops the filter list growing a "Vokey" checkbox that
    // competes with Titleist for the same wedges.
    expect(resolveBrandInput("Vokey", "Wedges")).toEqual({
      kind: "brand",
      brandId: "titleist",
      model: "Vokey",
    });
    expect(resolveBrandInput("Wilson Staff")).toEqual({ kind: "brand", brandId: "wilson", model: "Staff" });
    expect(resolveBrandInput("Tour Edge Exotics")).toEqual({
      kind: "brand",
      brandId: "tour-edge",
      model: "Exotics",
    });
  });

  it("keeps Strata as its own consumer-facing full-set brand", () => {
    expect(resolveBrandInput("Callaway Strata", "Full sets")).toEqual({ kind: "brand", brandId: "strata" });
  });

  it("asks rather than guesses when a name is ambiguous in its category", () => {
    expect(resolveBrandInput("Titleist", "Putters")).toEqual({
      kind: "ambiguous",
      brandId: "titleist",
      suggestBrandId: "scotty-cameron",
    });
    expect(resolveBrandInput("Callaway", "Putters")).toEqual({
      kind: "ambiguous",
      brandId: "callaway",
      suggestBrandId: "odyssey",
    });
    // The same names are perfectly unambiguous elsewhere.
    expect(resolveBrandInput("Titleist", "Wedges")).toEqual({ kind: "brand", brandId: "titleist" });
  });

  it("leaves an unrecognised name unresolved rather than forcing a match", () => {
    expect(resolveBrandInput("Geoff's Custom Clubs")).toEqual({ kind: "unresolved" });
    expect(resolveBrandInput("")).toEqual({ kind: "unresolved" });
  });
});

describe("isLegacyResale", () => {
  it("flags brands that stopped making that kind of club", () => {
    expect(isLegacyResale("nike", "Drivers")).toBe(true);
    expect(isLegacyResale("yes", "Putters")).toBe(true);
    // Nike very much still makes shoes and apparel.
    expect(isLegacyResale("nike", "Shoes & apparel")).toBe(false);
    expect(isLegacyResale("taylormade", "Drivers")).toBe(false);
  });
});

describe("specFieldsFor", () => {
  it("shows club specs on clubs and not on bags", () => {
    expect(specFieldsFor("Drivers")).toContain("shaftFlex");
    expect(specFieldsFor("Drivers")).toContain("loft");
    expect(specFieldsFor("Bags & trolleys")).not.toContain("shaftFlex");
    expect(specFieldsFor("Bags & trolleys")).not.toContain("loft");
  });

  it("only asks for a size where an item has one", () => {
    expect(specFieldsFor("Shoes & apparel")).toContain("itemSize");
    expect(specFieldsFor("Irons")).not.toContain("itemSize");
  });

  it("falls back to model-only for an unknown category", () => {
    expect(specFieldsFor("Tennis rackets")).toEqual(["model"]);
  });
});

describe("fallback brands", () => {
  it("keeps fallback ids out of the curated brand table", () => {
    const curated = new Set(BRANDS.map((b) => b.id));
    for (const fallback of FALLBACK_BRANDS) {
      expect(curated.has(fallback.id), fallback.id).toBe(false);
    }
  });
});
