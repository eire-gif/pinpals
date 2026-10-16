import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBERSHIP_SETTINGS,
  featureAllowed,
  irishToday,
  launchOfferActive,
  membershipStatusLine,
  normalisePrice,
  parseFeatureForm,
  parseSettingsForm,
  type MembershipFeature,
  type Tier,
} from "./memberships";

const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

const feature = (access: MembershipFeature["access"], extra: Partial<MembershipFeature> = {}) => ({
  access,
  keep_for_existing: false,
  paywalled_at: null,
  ...extra,
});

const OFF = { paid_plans_enabled: false, paid_plans_since: null, free_until: null };
const LIVE = { paid_plans_enabled: true, paid_plans_since: "2027-01-01T00:00:00Z", free_until: null };
const NOW = new Date("2027-02-01T12:00:00Z");
const member = (tier: Tier, joinedAt = "2026-10-01T00:00:00Z") => ({ tier, joinedAt });

describe("featureAllowed — same rule as my_feature_access()", () => {
  it("paid plans off: everything that isn't off is free for everyone", () => {
    for (const a of ["free", "premium", "pro"] as const) expect(featureAllowed(feature(a), OFF, member("basic"), NOW)).toBe(true);
    expect(featureAllowed(feature("off"), OFF, member("pro"), NOW)).toBe(false);
  });

  it("paid plans on: levels apply", () => {
    expect(featureAllowed(feature("premium"), LIVE, member("basic"), NOW)).toBe(false);
    expect(featureAllowed(feature("premium"), LIVE, member("premium"), NOW)).toBe(true);
    expect(featureAllowed(feature("premium"), LIVE, member("pro"), NOW)).toBe(true);
    expect(featureAllowed(feature("pro"), LIVE, member("premium"), NOW)).toBe(false);
    expect(featureAllowed(feature("pro"), LIVE, member("pro"), NOW)).toBe(true);
    expect(featureAllowed(feature("free"), LIVE, member("basic"), NOW)).toBe(true);
  });

  it("the launch offer runs to the end of its day in Ireland", () => {
    const s = { ...LIVE, free_until: "2027-02-01" };
    expect(featureAllowed(feature("pro"), s, member("basic"), new Date("2027-02-01T22:59:00Z"))).toBe(true);
    expect(featureAllowed(feature("pro"), s, member("basic"), new Date("2027-02-02T00:30:00Z"))).toBe(false);
  });

  it("keep for existing: joined before it went paid keeps it", () => {
    const f = feature("premium", { keep_for_existing: true, paywalled_at: "2027-01-15T00:00:00Z" });
    expect(featureAllowed(f, LIVE, member("basic", "2027-01-10T00:00:00Z"), NOW)).toBe(true);
    expect(featureAllowed(f, LIVE, member("basic", "2027-01-20T00:00:00Z"), NOW)).toBe(false);
    // Paid plans switched on later than the feature was marked: that's the cut-off.
    const later = { ...LIVE, paid_plans_since: "2027-01-25T00:00:00Z" };
    expect(featureAllowed(f, later, member("basic", "2027-01-20T00:00:00Z"), NOW)).toBe(true);
  });
});

describe("launch offer and status line", () => {
  it("uses the Irish date", () => {
    expect(irishToday(new Date("2027-06-30T23:30:00Z"))).toBe("2027-07-01"); // summer time
    expect(launchOfferActive({ free_until: null })).toBe(false);
  });

  it("says plainly what members get", () => {
    expect(membershipStatusLine(DEFAULT_MEMBERSHIP_SETTINGS)).toMatch(/^Off/);
    expect(membershipStatusLine({ ...DEFAULT_MEMBERSHIP_SETTINGS, paid_plans_enabled: true, free_until: "2027-03-01" }, NOW)).toMatch(/free until 1 March 2027/);
    expect(membershipStatusLine({ ...DEFAULT_MEMBERSHIP_SETTINGS, paid_plans_enabled: true }, NOW)).toMatch(/^Live —/);
  });
});

describe("forms", () => {
  it("parses a feature row", () => {
    expect(parseFeatureForm(form({ key: "gps_yardages", access: "premium", when_locked: "hide", keep_for_existing: "on" }))).toEqual({
      ok: true,
      value: { key: "gps_yardages", access: "premium", when_locked: "hide", keep_for_existing: true },
    });
    expect(parseFeatureForm(form({ key: "gps_yardages", access: "gold" })).ok).toBe(false);
    expect(parseFeatureForm(form({ key: "Bad Key", access: "free" })).ok).toBe(false);
  });

  it("normalises prices", () => {
    expect(normalisePrice("4.99")).toBe("€4.99");
    expect(normalisePrice("€ 34.99")).toBe("€34.99");
    expect(normalisePrice("€5")).toBe("€5");
    expect(normalisePrice("five euro")).toBeNull();
    expect(normalisePrice("4.9")).toBeNull();
  });

  it("parses settings", () => {
    const ok = parseSettingsForm(
      form({
        premium_monthly_price: "4.99",
        premium_annual_price: "€34.99",
        pro_monthly_price: "9.99",
        pro_annual_price: "69.99",
        premium_trial_days: "7",
        pro_trial_days: "0",
        free_until: "2027-03-01",
      })
    );
    expect(ok).toEqual({
      ok: true,
      value: {
        premium_monthly_price: "€4.99",
        premium_annual_price: "€34.99",
        pro_monthly_price: "€9.99",
        pro_annual_price: "€69.99",
        premium_trial_days: 7,
        pro_trial_days: 0,
        free_until: "2027-03-01",
      },
    });
    expect(parseSettingsForm(form({ premium_monthly_price: "x" })).ok).toBe(false);
  });
});
