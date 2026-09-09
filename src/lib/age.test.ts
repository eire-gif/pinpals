import { describe, expect, it } from "vitest";
import { AGE_BANDS, ageBandForDate, ageInYears } from "./age";

const asOf = new Date("2026-09-09T12:00:00Z");

describe("ageInYears", () => {
  it("counts completed years, not elapsed ones", () => {
    // Birthday already passed this year.
    expect(ageInYears(new Date("1990-01-01T00:00:00Z"), asOf)).toBe(36);
    // Birthday still to come this year.
    expect(ageInYears(new Date("1990-12-31T00:00:00Z"), asOf)).toBe(35);
  });

  it("treats the birthday itself as the day the age ticks over", () => {
    expect(ageInYears(new Date("2001-09-08T00:00:00Z"), asOf)).toBe(25);
    expect(ageInYears(new Date("2001-09-09T00:00:00Z"), asOf)).toBe(25);
    expect(ageInYears(new Date("2001-09-10T00:00:00Z"), asOf)).toBe(24);
  });

  it("handles a 29 February birth date in a non-leap year", () => {
    // Turns 26 on 2026-03-01 by the convention used here; by September
    // they are unambiguously 26.
    expect(ageInYears(new Date("2000-02-29T00:00:00Z"), asOf)).toBe(26);
  });
});

describe("ageBandForDate", () => {
  it("maps each band, including both boundaries", () => {
    expect(ageBandForDate("2005-01-01", asOf)).toBe("Under 25"); // 21
    expect(ageBandForDate("2002-01-01", asOf)).toBe("Under 25"); // 24
    expect(ageBandForDate("2001-01-01", asOf)).toBe("25–34"); // 25
    expect(ageBandForDate("1992-01-01", asOf)).toBe("25–34"); // 34
    expect(ageBandForDate("1991-01-01", asOf)).toBe("35–44"); // 35
    expect(ageBandForDate("1982-01-01", asOf)).toBe("35–44"); // 44
    expect(ageBandForDate("1981-01-01", asOf)).toBe("45–54"); // 45
    expect(ageBandForDate("1971-01-01", asOf)).toBe("55–64"); // 55
    expect(ageBandForDate("1961-01-01", asOf)).toBe("65+"); // 65
    expect(ageBandForDate("1940-01-01", asOf)).toBe("65+");
  });

  it("accepts a Date as well as a YYYY-MM-DD string", () => {
    expect(ageBandForDate(new Date("1991-01-01T00:00:00Z"), asOf)).toBe("35–44");
  });

  it("returns null for absent, unparseable or future dates", () => {
    expect(ageBandForDate(null, asOf)).toBeNull();
    expect(ageBandForDate(undefined, asOf)).toBeNull();
    expect(ageBandForDate("", asOf)).toBeNull();
    expect(ageBandForDate("not a date", asOf)).toBeNull();
    // A mistyped birth year — better to show nothing than "Under 25".
    expect(ageBandForDate("2062-01-01", asOf)).toBeNull();
  });

  it("only ever returns a value from AGE_BANDS", () => {
    for (const year of [1935, 1950, 1965, 1980, 1995, 2005, 2010]) {
      const band = ageBandForDate(`${year}-06-15`, asOf);
      expect(band).not.toBeNull();
      expect(AGE_BANDS).toContain(band!);
    }
  });
});
