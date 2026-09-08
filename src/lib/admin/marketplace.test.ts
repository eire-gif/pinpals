import { describe, expect, it } from "vitest";
import { auctionEligibleForForceClose, buildMarketplaceAlerts } from "./marketplace";

describe("auctionEligibleForForceClose", () => {
  const now = new Date("2026-09-08T12:00:00Z");

  it("is eligible when live and past its end time", () => {
    expect(auctionEligibleForForceClose({ status: "live", ends_at: "2026-09-08T11:59:00Z" }, now)).toBe(true);
  });

  it("is eligible when scheduled and past its end time (never got a bid)", () => {
    expect(auctionEligibleForForceClose({ status: "scheduled", ends_at: "2026-09-08T11:59:00Z" }, now)).toBe(true);
  });

  it("is not eligible when still before its end time", () => {
    expect(auctionEligibleForForceClose({ status: "live", ends_at: "2026-09-08T12:01:00Z" }, now)).toBe(false);
  });

  it("is eligible exactly at its end time (<=, not <)", () => {
    expect(auctionEligibleForForceClose({ status: "live", ends_at: "2026-09-08T12:00:00Z" }, now)).toBe(true);
  });

  it("is not eligible once already ended", () => {
    expect(auctionEligibleForForceClose({ status: "ended", ends_at: "2026-09-08T11:59:00Z" }, now)).toBe(false);
  });

  it("is not eligible once cancelled", () => {
    expect(auctionEligibleForForceClose({ status: "cancelled", ends_at: "2026-09-08T11:59:00Z" }, now)).toBe(false);
  });
});

describe("buildMarketplaceAlerts", () => {
  const zeroMetrics = {
    openListingReports: 0,
    openMessageReports: 0,
    openDisputes: 0,
    sellersNeedingAttention: 0,
    webhookEventFailures: 0,
    ordersAwaitingPayment: 0,
    staleAuctions: 0,
    unresolvedMarketplaceSupportCases: 0,
  };

  it("returns no alerts when every metric is zero", () => {
    expect(buildMarketplaceAlerts(zeroMetrics)).toEqual([]);
  });

  it("includes only the metrics that are non-zero", () => {
    const alerts = buildMarketplaceAlerts({ ...zeroMetrics, openDisputes: 3, staleAuctions: 1 });
    expect(alerts.map((a) => a.key)).toEqual(["openDisputes", "staleAuctions"]);
  });

  it("carries the count and a working href through for each alert", () => {
    const alerts = buildMarketplaceAlerts({ ...zeroMetrics, sellersNeedingAttention: 5 });
    expect(alerts).toEqual([
      {
        key: "sellersNeedingAttention",
        label: "Sellers needing Connect attention",
        count: 5,
        href: "/admin/marketplace?tab=sellers",
      },
    ]);
  });
});
