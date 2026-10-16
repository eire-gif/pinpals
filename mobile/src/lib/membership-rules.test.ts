import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBERSHIP,
  annualSaving,
  checkoutWording,
  gateFor,
  parseFeatureAccess,
  parseMembership,
  perMonth,
  priceValue,
  renewalLine,
} from "./membership-rules";

describe("parsing the database's answer", () => {
  it("reads my_membership(), falling back to Basic", () => {
    expect(parseMembership(null)).toEqual(DEFAULT_MEMBERSHIP);
    const m = parseMembership({
      tier: "premium",
      paid_plans_enabled: true,
      billing: "annual",
      source: "app_store",
      in_trial: true,
      will_renew: true,
      premium_annual_price: "€39.99",
      pro_trial_days: 14,
    });
    expect(m.tier).toBe("premium");
    expect(m.paidPlansEnabled).toBe(true);
    expect(m.prices.premium.annual).toBe("€39.99");
    expect(m.prices.premium.monthly).toBe("€4.99");
    expect(m.trialDays.pro).toBe(14);
    expect(parseMembership({ tier: "gold" }).tier).toBe("basic");
  });

  it("reads my_feature_access(), skipping bad rows", () => {
    expect(
      parseFeatureAccess([
        { key: "gps_yardages", allowed: false, access: "premium", when_locked: "upsell" },
        { key: "stats", allowed: false, access: "premium", when_locked: "hide" },
        { key: 3, allowed: true },
        { key: "x" },
      ])
    ).toEqual({
      gps_yardages: { allowed: false, access: "premium", whenLocked: "upsell" },
      stats: { allowed: false, access: "premium", whenLocked: "hide" },
    });
    expect(parseFeatureAccess("nonsense")).toEqual({});
  });
});

describe("gateFor — fails open", () => {
  const map = parseFeatureAccess([
    { key: "gps_yardages", allowed: false, access: "premium", when_locked: "upsell" },
    { key: "stats", allowed: false, access: "premium", when_locked: "hide" },
    { key: "old_thing", allowed: false, access: "off", when_locked: "upsell" },
    { key: "live_scoring", allowed: true, access: "free", when_locked: "upsell" },
  ]);
  it("shows, locks or hides as the database says", () => {
    expect(gateFor(map, "gps_yardages")).toBe("locked");
    expect(gateFor(map, "stats")).toBe("hide");
    expect(gateFor(map, "old_thing")).toBe("hide");
    expect(gateFor(map, "live_scoring")).toBe("show");
  });
  it("shows anything it has no answer for", () => {
    expect(gateFor(map, "something_new")).toBe("show");
    expect(gateFor(null, "gps_yardages")).toBe("show");
  });
});

describe("prices", () => {
  it("reads euro labels", () => {
    expect(priceValue("€34.99")).toBe(34.99);
    expect(priceValue("€ 5")).toBe(5);
    expect(priceValue("free")).toBeNull();
  });
  it("works out the annual saving and monthly equivalent", () => {
    expect(annualSaving("€4.99", "€34.99")).toBe(41);
    expect(annualSaving("€9.99", "€69.99")).toBe(41);
    expect(annualSaving("x", "€1")).toBe(0);
    expect(perMonth("€34.99")).toBe("€2.91/mo");
  });
});

describe("checkout wording", () => {
  const m = DEFAULT_MEMBERSHIP;
  it("offers the trial on annual plans", () => {
    expect(checkoutWording("premium", "annual", m)).toEqual({
      button: "Start 7-day free trial",
      fine: "Free for 7 days, then €34.99 a year. Renews automatically — cancel any time in your App Store or Google Play settings.",
    });
  });
  it("subscribes straight away monthly, or with no trial", () => {
    expect(checkoutWording("pro", "monthly", m).button).toBe("Subscribe for €9.99 a month");
    expect(checkoutWording("pro", "annual", { ...m, trialDays: { premium: 7, pro: 0 } }).button).toBe("Subscribe for €69.99 a year");
  });
  it("doesn't sell you what you have", () => {
    expect(checkoutWording("premium", "annual", { ...m, tier: "premium" }).button).toBe("This is your plan");
    expect(checkoutWording("basic", "annual", m).button).toBe("Continue with Basic");
  });
});

describe("renewal line", () => {
  it("says when a trial ends, a plan renews or ends", () => {
    const at = "2026-10-23T10:00:00Z";
    expect(renewalLine({ expiresAt: at, inTrial: true, willRenew: true, source: "app_store" })).toMatch(/^Free trial ends 23 Oct 2026/);
    expect(renewalLine({ expiresAt: at, inTrial: false, willRenew: true, source: "app_store" })).toMatch(/^Renews/);
    expect(renewalLine({ expiresAt: at, inTrial: false, willRenew: false, source: "play_store" })).toMatch(/^Ends/);
    expect(renewalLine({ expiresAt: null, inTrial: false, willRenew: false, source: "staff_grant" })).toMatch(/no end date/);
  });
});
