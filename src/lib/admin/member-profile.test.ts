import { describe, expect, it } from "vitest";
import {
  MEMBER_EDIT_ROLES,
  parseMemberProfileEdit,
  summariseProfileChanges,
  type MemberProfileInput,
  type MemberProfileValues,
} from "./member-profile";

function input(overrides: Partial<MemberProfileInput> = {}): MemberProfileInput {
  return {
    firstName: "Sinead",
    lastName: "Kelly",
    clubId: "412",
    country: "ireland",
    county: "Kerry",
    handicap: "14.2",
    handicapVisible: true,
    bio: "Weekend golfer.",
    guiNumber: "1234567",
    ...overrides,
  };
}

function values(overrides: Partial<MemberProfileValues> = {}): MemberProfileValues {
  return {
    first_name: "Sinead",
    last_name: "Kelly",
    home_club_id: 412,
    country: "ireland",
    county: "Kerry",
    handicap: 14.2,
    handicap_visible: true,
    bio: "Weekend golfer.",
    gui_membership_number: "1234567",
    ...overrides,
  };
}

describe("MEMBER_EDIT_ROLES", () => {
  it("is super_admin alone — this rewrites a member's own facts, not a status", () => {
    expect(MEMBER_EDIT_ROLES).toEqual(["super_admin"]);
  });
});

describe("parseMemberProfileEdit", () => {
  it("accepts a complete, coherent edit", () => {
    const result = parseMemberProfileEdit(input());
    expect(result).toEqual({ ok: true, values: values() });
  });

  it("trims every text field", () => {
    const result = parseMemberProfileEdit(
      input({ firstName: "  Sinead ", lastName: " Kelly  ", bio: "  Weekend golfer. " })
    );
    expect(result.ok && result.values.first_name).toBe("Sinead");
    expect(result.ok && result.values.last_name).toBe("Kelly");
    expect(result.ok && result.values.bio).toBe("Weekend golfer.");
  });

  it("refuses an empty name", () => {
    expect(parseMemberProfileEdit(input({ firstName: "   " }))).toEqual({
      ok: false,
      error: "First and last name can't be empty.",
    });
  });

  it("refuses a country that isn't one of ours", () => {
    const result = parseMemberProfileEdit(input({ country: "narnia" }));
    expect(result.ok).toBe(false);
  });

  it("refuses a county that belongs to a different country", () => {
    // The exact mismatch the member's own form refuses: saving
    // "Scotland / Kerry" would show in the directory as a place nobody
    // could search for.
    const result = parseMemberProfileEdit(input({ country: "scotland", county: "Kerry" }));
    expect(result).toEqual({ ok: false, error: "That county isn't in Scotland." });
  });

  it("allows no county at all", () => {
    const result = parseMemberProfileEdit(input({ county: "" }));
    expect(result.ok && result.values.county).toBeNull();
  });

  it("allows clearing the home club", () => {
    const result = parseMemberProfileEdit(input({ clubId: "" }));
    expect(result.ok && result.values.home_club_id).toBeNull();
  });

  it("refuses a club id that isn't a whole positive number", () => {
    for (const clubId of ["12abc", "-4", "0", "not-a-club", "4.5"]) {
      const result = parseMemberProfileEdit(input({ clubId }));
      expect(result, clubId).toEqual({ ok: false, error: "Pick the home club from the suggestions." });
    }
  });

  it("refuses a handicap outside the playable range", () => {
    for (const handicap of ["-11", "55", "300", "abc"]) {
      const result = parseMemberProfileEdit(input({ handicap }));
      expect(result.ok, handicap).toBe(false);
    }
  });

  it("keeps the ends of the range", () => {
    expect(parseMemberProfileEdit(input({ handicap: "-10" })).ok).toBe(true);
    expect(parseMemberProfileEdit(input({ handicap: "54" })).ok).toBe(true);
  });

  it("rounds to one decimal, because profiles.handicap is numeric(4,1)", () => {
    const result = parseMemberProfileEdit(input({ handicap: "14.26" }));
    expect(result.ok && result.values.handicap).toBe(14.3);
  });

  it("treats an empty handicap as 'not set' rather than zero", () => {
    const result = parseMemberProfileEdit(input({ handicap: "  " }));
    expect(result.ok && result.values.handicap).toBeNull();
  });

  it("carries the privacy toggle through untouched", () => {
    const result = parseMemberProfileEdit(input({ handicapVisible: false }));
    expect(result.ok && result.values.handicap_visible).toBe(false);
  });

  it("refuses an oversized bio", () => {
    const result = parseMemberProfileEdit(input({ bio: "x".repeat(2001) }));
    expect(result.ok).toBe(false);
  });

  it("stores empty optional text as null, not an empty string", () => {
    const result = parseMemberProfileEdit(input({ bio: "", guiNumber: "" }));
    expect(result.ok && result.values.bio).toBeNull();
    expect(result.ok && result.values.gui_membership_number).toBeNull();
  });
});

describe("summariseProfileChanges", () => {
  it("is empty when nothing changed", () => {
    expect(summariseProfileChanges(values(), values())).toEqual({});
  });

  it("records before and after for a scalar field", () => {
    const changes = summariseProfileChanges(values(), values({ handicap: 9.1 }));
    expect(changes).toEqual({ handicap: { from: 14.2, to: 9.1 } });
  });

  it("records a club change by id", () => {
    const changes = summariseProfileChanges(values(), values({ home_club_id: 900 }));
    expect(changes).toEqual({ home_club_id: { from: 412, to: 900 } });
  });

  it("treats undefined in the before-row as null, not a change to null", () => {
    const changes = summariseProfileChanges({ ...values(), county: undefined }, values({ county: null }));
    expect(changes).toEqual({});
  });

  it("records a privacy toggle being flipped by staff", () => {
    const changes = summariseProfileChanges(values(), values({ handicap_visible: false }));
    expect(changes).toEqual({ handicap_visible: { from: true, to: false } });
  });

  it("never copies bio text into the audit log — only its size", () => {
    const changes = summariseProfileChanges(values(), values({ bio: "Something else entirely." }));
    expect(changes.bio).toEqual({ from: "15 characters", to: "24 characters" });
    expect(JSON.stringify(changes)).not.toContain("Weekend golfer");
  });

  it("says 'empty' rather than a length when a bio is added or cleared", () => {
    expect(summariseProfileChanges(values({ bio: null }), values()).bio).toEqual({
      from: "empty",
      to: "15 characters",
    });
    expect(summariseProfileChanges(values(), values({ bio: null })).bio).toEqual({
      from: "15 characters",
      to: "empty",
    });
  });

  it("reports several changed fields at once", () => {
    const changes = summariseProfileChanges(
      values(),
      values({ county: "Cork", handicap: 12, first_name: "Sinéad" })
    );
    expect(Object.keys(changes).sort()).toEqual(["county", "first_name", "handicap"]);
  });
});
