import { describe, expect, it } from "vitest";
import {
  buildListingSearchOrFilter,
  buildReportSearchOrFilter,
  buildUserSearchOrFilter,
  isUserSuspended,
  sanitizeSearchTerm,
} from "./queries";

describe("isUserSuspended", () => {
  it("is false when there's no ban on record", () => {
    expect(isUserSuspended({ banned_until: null })).toBe(false);
  });

  it("is true when banned_until is in the future", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isUserSuspended({ banned_until: future })).toBe(true);
  });

  it("is false when banned_until has already passed", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isUserSuspended({ banned_until: past })).toBe(false);
  });
});

describe("sanitizeSearchTerm", () => {
  it("passes plain names through unchanged (aside from trimming)", () => {
    expect(sanitizeSearchTerm("  Grace Walsh  ")).toBe("Grace Walsh");
  });

  it("keeps hyphens and apostrophes, which appear in real Irish names", () => {
    expect(sanitizeSearchTerm("O'Brien-Murphy")).toBe("O'Brien-Murphy");
  });

  it("keeps accented letters (fada), which appear in real club/county names", () => {
    expect(sanitizeSearchTerm("Dún Laoghaire")).toBe("Dún Laoghaire");
  });

  it("strips characters that are reserved in either ILIKE patterns or PostgREST filter syntax", () => {
    expect(sanitizeSearchTerm("50%_off,(test)\\path")).toBe("50offtestpath");
  });

  it("truncates to a sane maximum length", () => {
    const long = "a".repeat(500);
    expect(sanitizeSearchTerm(long)).toHaveLength(100);
  });

  it("reduces a punctuation-only query to an empty string", () => {
    expect(sanitizeSearchTerm("%,.()")).toBe("");
  });
});

describe("buildUserSearchOrFilter", () => {
  it("returns null when there's nothing to filter on", () => {
    expect(buildUserSearchOrFilter("", [])).toBeNull();
    expect(buildUserSearchOrFilter("   ", [])).toBeNull();
    expect(buildUserSearchOrFilter("%,.()", [])).toBeNull();
  });

  it("builds an ilike clause across all four indexed columns", () => {
    const filter = buildUserSearchOrFilter("Grace", []);
    expect(filter).toBe(
      "first_name.ilike.%Grace%,last_name.ilike.%Grace%,home_club.ilike.%Grace%,county.ilike.%Grace%"
    );
  });

  it("appends an id.in clause for email-matched ids", () => {
    const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const filter = buildUserSearchOrFilter("", [id]);
    expect(filter).toBe(`id.in.(${id})`);
  });

  it("combines name/club/county ilike clauses with email-matched ids", () => {
    const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const filter = buildUserSearchOrFilter("Grace", [id]);
    expect(filter).toContain("first_name.ilike.%Grace%");
    expect(filter).toContain(`id.in.(${id})`);
  });

  it("drops malformed ids rather than trusting them into the filter string", () => {
    expect(buildUserSearchOrFilter("", ["not-a-uuid", "; drop table profiles;"])).toBeNull();
  });
});

describe("buildListingSearchOrFilter", () => {
  it("returns null when there's nothing to filter on", () => {
    expect(buildListingSearchOrFilter("", [])).toBeNull();
    expect(buildListingSearchOrFilter("   ", [])).toBeNull();
    expect(buildListingSearchOrFilter("%,.()", [])).toBeNull();
  });

  it("builds an ilike clause across title and description", () => {
    const filter = buildListingSearchOrFilter("Driver", []);
    expect(filter).toBe("title.ilike.%Driver%,description.ilike.%Driver%");
  });

  it("appends a seller_id.in clause for name-matched sellers", () => {
    const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const filter = buildListingSearchOrFilter("", [id]);
    expect(filter).toBe(`seller_id.in.(${id})`);
  });

  it("combines title/description ilike clauses with seller-matched ids", () => {
    const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const filter = buildListingSearchOrFilter("Driver", [id]);
    expect(filter).toContain("title.ilike.%Driver%");
    expect(filter).toContain(`seller_id.in.(${id})`);
  });

  it("drops malformed ids rather than trusting them into the filter string", () => {
    expect(buildListingSearchOrFilter("", ["not-a-uuid", "; drop table listings;"])).toBeNull();
  });
});

describe("buildReportSearchOrFilter", () => {
  it("returns null when there's nothing to filter on", () => {
    expect(buildReportSearchOrFilter("", [])).toBeNull();
    expect(buildReportSearchOrFilter("   ", [])).toBeNull();
    expect(buildReportSearchOrFilter("%,.()", [])).toBeNull();
  });

  it("builds an ilike clause against description", () => {
    const filter = buildReportSearchOrFilter("harassment", []);
    expect(filter).toBe("description.ilike.%harassment%");
  });

  it("appends a reporter_id.in clause for name-matched reporters", () => {
    const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const filter = buildReportSearchOrFilter("", [id]);
    expect(filter).toBe(`reporter_id.in.(${id})`);
  });

  it("combines the description ilike clause with reporter-matched ids", () => {
    const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const filter = buildReportSearchOrFilter("spam", [id]);
    expect(filter).toContain("description.ilike.%spam%");
    expect(filter).toContain(`reporter_id.in.(${id})`);
  });

  it("drops malformed ids rather than trusting them into the filter string", () => {
    expect(buildReportSearchOrFilter("", ["not-a-uuid", "; drop table reports;"])).toBeNull();
  });
});
