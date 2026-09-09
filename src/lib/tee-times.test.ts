import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISIBILITY,
  VISIBILITY_BADGES,
  VISIBILITY_DESCRIPTIONS,
  VISIBILITY_LABELS,
  VISIBILITY_OPTIONS,
  isInviteVisibility,
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
