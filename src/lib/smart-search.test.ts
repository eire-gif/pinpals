import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import brandsJson from "@/data/golf-brands.json";
import { CATEGORIES, CONDITIONS, SUBCATEGORIES } from "./marketplace";
import { SHAFT_FLEXES } from "./marketplace-brands";
import { ALL_REGIONS } from "./regions";
import {
  SMART_CATEGORIES,
  SMART_CONDITIONS,
  SMART_COUNTIES,
  SMART_TOWNS,
  completeSearch,
  editDistance,
  parseListingTitle,
  parseSearch,
  priceGuide,
  understoodSomething,
  type SmartBrand,
} from "./smart-search";

const BRANDS = brandsJson.brands as SmartBrand[];

describe("smart-search.ts", () => {
  it("is byte-identical in the website and the app", () => {
    const site = readFileSync(join(process.cwd(), "src/lib/smart-search.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "mobile/src/lib/smart-search.ts"), "utf8");
    expect(app).toBe(site);
  });

  it("uses the marketplace's own vocabulary", () => {
    expect([...SMART_CATEGORIES]).toEqual([...CATEGORIES]);
    expect([...SMART_CONDITIONS]).toEqual([...CONDITIONS]);
    const source = readFileSync(join(process.cwd(), "src/lib/smart-search.ts"), "utf8");
    // Every subcategory and county the parser can produce is a real one.
    for (const m of source.matchAll(/subcategory: "([^"]+)"/g)) {
      expect(Object.values(SUBCATEGORIES).flat()).toContain(m[1]);
    }
    for (const county of SMART_COUNTIES) expect(ALL_REGIONS).toContain(county);
    for (const county of Object.values(SMART_TOWNS)) expect(SMART_COUNTIES).toContain(county);
    for (const flex of ["Stiff", "Regular", "Senior", "Ladies", "Extra stiff"]) expect(SHAFT_FLEXES).toContain(flex);
  });
});

describe("parseSearch", () => {
  it("reads shorthand, a typo, a price and a place", () => {
    const s = parseSearch("tm qi10 drvier under 300 near me", BRANDS);
    expect(s.brands).toEqual(["taylormade"]);
    expect(s.category).toBe("Drivers");
    expect(s.maxPriceCents).toBe(30000);
    expect(s.nearMe).toBe(true);
    expect(s.text).toBe("qi10");
    expect(s.corrections).toEqual([{ from: "drvier", to: "driver" }]);
    expect(understoodSomething(s)).toBe(true);
    expect(s.chips.map((c) => c.value)).toEqual(["TaylorMade", "qi10", "Drivers", "€300", "Near me"]);
  });

  it("finds two-word brands, towns, conditions and the left hand", () => {
    const s = parseSearch("scotty cameron putter malahide excellent left handed", BRANDS);
    expect(s.brands).toEqual(["scotty-cameron"]);
    expect(s.category).toBe("Putters");
    expect(s.county).toBe("Dublin");
    expect(s.condition).toBe("Excellent");
    expect(s.leftHanded).toBe(true);
    expect(s.text).toBe("");
  });

  it("knows subcategories from pairs", () => {
    expect(parseSearch("electric trolley cork", BRANDS)).toMatchObject({ category: "Bags & trolleys", subcategory: "Electric trolleys", county: "Cork" });
    expect(parseSearch("ping stand bag", BRANDS)).toMatchObject({ brands: ["ping"], subcategory: "Stand bags" });
    expect(parseSearch("56 sand wedge", BRANDS)).toMatchObject({ category: "Wedges", subcategory: "Sand wedge", text: "56" });
  });

  it("reads price ranges every way people write them", () => {
    expect(parseSearch("irons €400", BRANDS).maxPriceCents).toBe(40000);
    expect(parseSearch("putter <150", BRANDS).maxPriceCents).toBe(15000);
    expect(parseSearch("driver less than 200", BRANDS).maxPriceCents).toBe(20000);
    expect(parseSearch("driver over 100", BRANDS).minPriceCents).toBe(10000);
    expect(parseSearch("driver 100-250", BRANDS)).toMatchObject({ minPriceCents: 10000, maxPriceCents: 25000 });
  });

  it("doesn't mistake an iron range for a price", () => {
    const s = parseSearch("titleist t200 irons 5-pw", BRANDS);
    expect(s.minPriceCents).toBeNull();
    expect(s.text).toBe("t200 5-pw");
  });

  it("leaves model names alone rather than 'correcting' them", () => {
    expect(parseSearch("paradym", BRANDS).corrections).toEqual([]);
    expect(parseSearch("stealth", BRANDS).corrections).toEqual([]);
    expect(parseSearch("phantom", BRANDS).corrections).toEqual([]);
  });

  it("treats 'used' as the whole marketplace, not a condition", () => {
    expect(parseSearch("used drivers", BRANDS)).toMatchObject({ category: "Drivers", condition: "", text: "" });
  });

  it("is harmless with nothing, junk or a huge string", () => {
    expect(parseSearch("", BRANDS).chips).toEqual([]);
    expect(parseSearch("%%% ;; drop table", BRANDS).brands).toEqual([]);
    expect(() => parseSearch("x".repeat(5000), BRANDS)).not.toThrow();
  });
});

describe("completeSearch", () => {
  it("finishes a brand", () => {
    expect(completeSearch("tayl", BRANDS)[0]).toBe("TaylorMade");
  });
  it("finishes a category after a brand", () => {
    expect(completeSearch("ping dr", BRANDS)).toContain("ping drivers");
  });
  it("offers categories once a brand is typed", () => {
    expect(completeSearch("callaway ", BRANDS)).toContain("callaway drivers");
  });
  it("offers a price once a category is typed", () => {
    expect(completeSearch("putters ", BRANDS)).toContain("putters under €100");
  });
  it("offers nothing for nothing", () => {
    expect(completeSearch("   ", BRANDS)).toEqual([]);
  });
});

describe("parseListingTitle", () => {
  it("fills the form from a rough title and tidies it", () => {
    const d = parseListingTitle("taylormade qi10 driver 10.5 stiff", BRANDS);
    expect(d).toMatchObject({ category: "Drivers", brand: "taylormade", model: "Qi10", loft: "10.5°", shaftFlex: "Stiff" });
    expect(d.title).toBe("TaylorMade Qi10 driver — 10.5°, stiff");
    expect(d.filled).toEqual(["category", "brand", "model", "loft", "shaftFlex"]);
  });

  it("handles left-handed, an iron range and shaft material", () => {
    const d = parseListingTitle("ping g425 irons 5-pw graphite regular lh", BRANDS);
    expect(d).toMatchObject({ category: "Irons", subcategory: "Iron sets", brand: "ping", model: "G425", shaftFlex: "Regular", shaftMaterial: "Graphite", dexterity: "Left-handed" });
    expect(d.title).toBe("PING G425 irons — 5–PW, regular, graphite, left-handed");
  });

  it("knows two-word brands and models", () => {
    const d = parseListingTitle("scotty cameron special select newport 2 putter", BRANDS);
    expect(d.brand).toBe("scotty-cameron");
    expect(d.model).toBe("Special Select Newport 2");
    expect(d.category).toBe("Putters");
  });

  it("keeps the seller's words when it can't make sense of them", () => {
    const d = parseListingTitle("box of bits from the shed", BRANDS);
    expect(d.category).toBe("");
    expect(d.title.toLowerCase()).toContain("box of bits");
  });
});

describe("priceGuide", () => {
  it("gives the middle half, to the nearest €5", () => {
    expect(priceGuide([20000, 22000, 25000, 27000, 30000])).toEqual({ lowCents: 22000, highCents: 27000, count: 5 });
  });
  it("needs at least three", () => {
    expect(priceGuide([20000, 25000])).toBeNull();
  });
});

describe("editDistance", () => {
  it("counts a swap as one", () => {
    expect(editDistance("drvier", "driver")).toBe(1);
    expect(editDistance("putter", "putter")).toBe(0);
    expect(editDistance("abc", "xyzxyz")).toBeGreaterThan(2);
  });
});
