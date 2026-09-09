import { describe, expect, it } from "vitest";
import {
  ALL_REGIONS,
  COUNTRIES,
  COUNTRY_CODES,
  REGIONS_BY_COUNTRY,
  REGION_GROUPS,
  countryForRegion,
  countryName,
  isCountryCode,
  isRegionInCountry,
  regionsForCountry,
} from "./regions";

describe("countries", () => {
  it("covers Ireland and the four UK countries", () => {
    expect(COUNTRY_CODES).toEqual([
      "ireland",
      "northern-ireland",
      "england",
      "scotland",
      "wales",
    ]);
  });

  it("uses URL-safe codes, since they are path segments under /courses", () => {
    for (const code of COUNTRY_CODES) {
      expect(code).toMatch(/^[a-z-]+$/);
    }
  });

  it("recognises only its own codes", () => {
    expect(isCountryCode("scotland")).toBe(true);
    expect(isCountryCode("Scotland")).toBe(false);
    expect(isCountryCode("uk")).toBe(false);
    expect(isCountryCode(null)).toBe(false);
    expect(isCountryCode(undefined)).toBe(false);
  });

  it("falls back to the raw value for an unknown code rather than throwing", () => {
    // A country code read off an old row should render as *something* in a
    // member card, not blow up the page it's on.
    expect(countryName("ireland")).toBe("Ireland");
    expect(countryName("atlantis")).toBe("atlantis");
  });
});

describe("regions", () => {
  it("has the expected number of regions per country", () => {
    // Guards against a paste losing a line: these are fixed, published
    // administrative counts, so a change here is a mistake unless the real
    // world changed.
    expect(REGIONS_BY_COUNTRY.ireland).toHaveLength(26);
    expect(REGIONS_BY_COUNTRY["northern-ireland"]).toHaveLength(6);
    expect(REGIONS_BY_COUNTRY.england).toHaveLength(48);
    expect(REGIONS_BY_COUNTRY.scotland).toHaveLength(32);
    expect(REGIONS_BY_COUNTRY.wales).toHaveLength(22);
  });

  it("lists every region alphabetically within its country", () => {
    for (const code of COUNTRY_CODES) {
      const regions = [...REGIONS_BY_COUNTRY[code]];
      expect(regions).toEqual([...regions].sort((a, b) => a.localeCompare(b)));
    }
  });

  it("never repeats a region name inside one country", () => {
    for (const code of COUNTRY_CODES) {
      const regions = REGIONS_BY_COUNTRY[code];
      expect(new Set(regions).size).toBe(regions.length);
    }
  });

  // This is the load-bearing one. `listings.country` and the marketplace's
  // single grouped county select both rely on a region name identifying its
  // country on its own (see countryForRegion and listingCountySchema). If a
  // future region were added that appears in two countries, that derivation
  // would silently start returning null — so the uniqueness is asserted
  // rather than assumed.
  it("never repeats a region name across countries", () => {
    const seen = new Map<string, string>();
    for (const code of COUNTRY_CODES) {
      for (const region of REGIONS_BY_COUNTRY[code]) {
        const previous = seen.get(region);
        expect(previous, `"${region}" appears in both ${previous} and ${code}`).toBeUndefined();
        seen.set(region, code);
      }
    }
    expect(ALL_REGIONS).toHaveLength(seen.size);
  });

  it("resolves a region back to exactly one country", () => {
    expect(countryForRegion("Kerry")).toBe("ireland");
    expect(countryForRegion("Down")).toBe("northern-ireland");
    expect(countryForRegion("Surrey")).toBe("england");
    expect(countryForRegion("Fife")).toBe("scotland");
    expect(countryForRegion("Gwynedd")).toBe("wales");
    expect(countryForRegion("Nowhereshire")).toBeNull();
  });

  it("keeps Derry spelled as this site has always spelled it", () => {
    // Six members' profiles and the seeded clubs were entered against
    // "Derry"; the importer maps OSM's "Londonderry" onto it. Changing this
    // string is a data migration, not an edit.
    expect(REGIONS_BY_COUNTRY["northern-ireland"]).toContain("Derry");
    expect(REGIONS_BY_COUNTRY["northern-ireland"]).not.toContain("Londonderry");
  });

  it("does not put Northern Ireland's counties in Ireland's list", () => {
    // The whole point of the five-country split: the old all-island list had
    // all 32.
    for (const region of REGIONS_BY_COUNTRY["northern-ireland"]) {
      expect(REGIONS_BY_COUNTRY.ireland).not.toContain(region);
    }
  });

  it("matches a region to its own country only", () => {
    expect(isRegionInCountry("ireland", "Kerry")).toBe(true);
    expect(isRegionInCountry("scotland", "Kerry")).toBe(false);
    expect(isRegionInCountry("not-a-country", "Kerry")).toBe(false);
  });

  it("returns nothing for an unknown country rather than throwing", () => {
    expect(regionsForCountry("uk")).toEqual([]);
  });
});

describe("region groups", () => {
  it("mirrors the country list, in the same order", () => {
    expect(REGION_GROUPS.map((g) => g.country)).toEqual([...COUNTRY_CODES]);
    expect(REGION_GROUPS.map((g) => g.label)).toEqual(COUNTRIES.map((c) => c.name));
  });

  it("accounts for every region exactly once", () => {
    const grouped = REGION_GROUPS.flatMap((g) => [...g.regions]);
    expect(grouped).toHaveLength(ALL_REGIONS.length);
    expect(new Set(grouped).size).toBe(ALL_REGIONS.length);
  });
});
