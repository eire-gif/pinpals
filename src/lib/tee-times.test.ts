import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISIBILITY,
  LADIES_ONLY_BADGE,
  LADIES_ONLY_DESCRIPTION,
  LADIES_ONLY_LABEL,
  VISIBILITY_BADGES,
  VISIBILITY_DESCRIPTIONS,
  VISIBILITY_LABELS,
  VISIBILITY_OPTIONS,
  isInviteVisibility,
  parseLadiesOnlyFilter,
  partitionConfirmedRounds,
  todayIsoDate,
} from "./tee-times";

describe("invite visibility", () => {
  it("offers exactly the two values the database allows", () => {
    // Mirrors tee_time_invites_visibility_check in
    // supabase/migrations/0065_tee_time_invite_visibility.sql. If the
    // constraint ever gains a third value, this fails first.
    expect(VISIBILITY_OPTIONS).toEqual(["everyone", "connections"]);
  });

  it("defaults to everyone, matching the column default", () => {
    expect(DEFAULT_VISIBILITY).toBe("everyone");
  });

  it("labels and describes every option", () => {
    for (const option of VISIBILITY_OPTIONS) {
      expect(VISIBILITY_LABELS[option]).toBeTruthy();
      expect(VISIBILITY_DESCRIPTIONS[option]).toBeTruthy();
    }
  });

  it("badges connections-only invites and nothing else", () => {
    expect(VISIBILITY_BADGES.connections).toBe("Connections only");
    expect(VISIBILITY_BADGES.everyone).toBeNull();
  });
});

describe("isInviteVisibility", () => {
  it("accepts the two real values", () => {
    expect(isInviteVisibility("everyone")).toBe(true);
    expect(isInviteVisibility("connections")).toBe(true);
  });

  it("rejects anything else, including near-misses", () => {
    // The guard is what stands between a hand-built POST and an invite
    // posted to an audience its host never chose.
    for (const value of ["", "Everyone", "connection", "public", "private", "all", "everyone "]) {
      expect(isInviteVisibility(value)).toBe(false);
    }
  });
});

describe("parseLadiesOnlyFilter", () => {
  it("is on only for the literal '1'", () => {
    expect(parseLadiesOnlyFilter("1")).toBe(true);
  });

  it("is off for anything else a hand-edited URL might carry", () => {
    for (const value of ["0", "true", "yes", "on", "", " 1", undefined]) {
      expect(parseLadiesOnlyFilter(value), String(value)).toBe(false);
    }
  });
});

describe("ladies-only wording", () => {
  it("uses one constant everywhere, so the badge and the email can't drift", () => {
    expect(LADIES_ONLY_BADGE).toBe("Ladies only");
    expect(LADIES_ONLY_LABEL).toBe(LADIES_ONLY_BADGE);
  });

  it("describes what the flag does without promising enforcement", () => {
    // Nothing in RLS reads ladies_only (migration 0074), so the form must
    // not tell a host that men are prevented from joining. If this
    // description is ever reworded to claim they are, either the wording is
    // wrong or the enforcement needs building first.
    expect(LADIES_ONLY_DESCRIPTION).not.toMatch(/only wom(a|e)n can|can'?t join|prevent|block/i);
    expect(LADIES_ONLY_DESCRIPTION.toLowerCase()).toContain("shown");
  });
});

describe("partitionConfirmedRounds", () => {
  const round = (playDate: string) => ({ playDate });

  it("puts a round played today in 'upcoming', not 'past'", () => {
    // It may not have teed off yet. Dropping it at midnight would take it
    // away on the one morning the member most wants to look at it.
    const { upcoming, past } = partitionConfirmedRounds([round("2026-09-14")], "2026-09-14");
    expect(upcoming).toEqual([round("2026-09-14")]);
    expect(past).toEqual([]);
  });

  it("sorts upcoming soonest-first", () => {
    const { upcoming } = partitionConfirmedRounds(
      [round("2026-10-02"), round("2026-09-20"), round("2026-12-01")],
      "2026-09-14"
    );
    expect(upcoming.map((r) => r.playDate)).toEqual(["2026-09-20", "2026-10-02", "2026-12-01"]);
  });

  it("sorts past most-recent-first", () => {
    const { past } = partitionConfirmedRounds(
      [round("2026-01-05"), round("2026-08-30"), round("2026-06-11")],
      "2026-09-14"
    );
    expect(past.map((r) => r.playDate)).toEqual(["2026-08-30", "2026-06-11", "2026-01-05"]);
  });

  it("splits a mixed list on the day boundary", () => {
    const { upcoming, past } = partitionConfirmedRounds(
      [round("2026-09-13"), round("2026-09-14"), round("2026-09-15")],
      "2026-09-14"
    );
    expect(upcoming.map((r) => r.playDate)).toEqual(["2026-09-14", "2026-09-15"]);
    expect(past.map((r) => r.playDate)).toEqual(["2026-09-13"]);
  });

  it("handles an empty list", () => {
    expect(partitionConfirmedRounds([], "2026-09-14")).toEqual({ upcoming: [], past: [] });
  });

  it("compares dates as strings across a year boundary", () => {
    // The whole reason play_date stays a yyyy-mm-dd string: this has to be
    // right without anyone reasoning about timezones.
    const { upcoming, past } = partitionConfirmedRounds(
      [round("2027-01-02"), round("2026-12-31")],
      "2027-01-01"
    );
    expect(upcoming.map((r) => r.playDate)).toEqual(["2027-01-02"]);
    expect(past.map((r) => r.playDate)).toEqual(["2026-12-31"]);
  });

  it("does not mutate the list it was given", () => {
    const input = [round("2026-10-02"), round("2026-09-20")];
    partitionConfirmedRounds(input, "2026-09-14");
    expect(input.map((r) => r.playDate)).toEqual(["2026-10-02", "2026-09-20"]);
  });
});

describe("todayIsoDate", () => {
  it("is the yyyy-mm-dd a play_date can be compared against", () => {
    expect(todayIsoDate(new Date("2026-09-14T22:45:00Z"))).toBe("2026-09-14");
  });
});
