import { describe, expect, it } from "vitest";
import {
  aggregateStoreStats,
  formatCommissionRate,
  formatCtr,
  heldForSellersEur,
  isBannerLive,
  parseCommissionPercent,
  parseRevenuePeriod,
  periodStart,
  releasesDueWithin,
  sumEur,
  summarizeBannerFees,
  summarizeOrderRevenue,
  summarizePromotionRevenue,
  topClickedProducts,
} from "./marketplace-revenue";

const now = new Date("2026-10-10T12:00:00Z");

describe("parseRevenuePeriod / periodStart", () => {
  it("accepts the four known periods and defaults to 30d", () => {
    expect(parseRevenuePeriod("7d")).toBe("7d");
    expect(parseRevenuePeriod("all")).toBe("all");
    expect(parseRevenuePeriod("365d")).toBe("30d");
    expect(parseRevenuePeriod(undefined)).toBe("30d");
  });

  it("starts the period N days back, and has no start for all time", () => {
    expect(periodStart("7d", now)?.toISOString()).toBe("2026-10-03T12:00:00.000Z");
    expect(periodStart("90d", now)?.toISOString()).toBe("2026-07-12T12:00:00.000Z");
    expect(periodStart("all", now)).toBeNull();
  });
});

describe("sumEur", () => {
  it("sums in cents without float drift and tolerates strings/nulls", () => {
    expect(sumEur([0.1, 0.2])).toBe(0.3);
    expect(sumEur(["1.15", 2, null, "x"])).toBe(3.15);
  });
});

describe("summarizeOrderRevenue", () => {
  it("separates Buyer Protection (member sales) from shop commission", () => {
    const summary = summarizeOrderRevenue([
      // Member sale: €100 item → €5.70 Buyer Protection.
      { total_eur: 105.7, platform_fee_eur: 5.7, seller_commission_eur: 0, store_id: null },
      // Shop sale: €200 item at 8% → €16 commission, no fee.
      { total_eur: "200.00", platform_fee_eur: "0", seller_commission_eur: "16.00", store_id: 3 },
    ]);
    expect(summary).toEqual({
      paidOrders: 2,
      shopOrders: 1,
      gmvEur: 305.7,
      buyerProtectionEur: 5.7,
      shopCommissionEur: 16,
    });
  });

  it("is all zeros for no orders", () => {
    expect(summarizeOrderRevenue([])).toEqual({
      paidOrders: 0,
      shopOrders: 0,
      gmvEur: 0,
      buyerProtectionEur: 0,
      shopCommissionEur: 0,
    });
  });
});

describe("summarizePromotionRevenue", () => {
  it("counts only paid promotions (active/expired), split by kind", () => {
    const summary = summarizePromotionRevenue([
      { kind: "featured", status: "active", amount_eur: 4.99 },
      { kind: "featured", status: "expired", amount_eur: "4.99" },
      { kind: "bump", status: "expired", amount_eur: 1.99 },
      { kind: "bump", status: "pending", amount_eur: 1.99 },
      { kind: "featured", status: "refunded", amount_eur: 4.99 },
      { kind: "bump", status: "cancelled", amount_eur: 1.99 },
    ]);
    expect(summary.count).toBe(3);
    expect(summary.totalEur).toBe(11.97);
    expect(summary.byKind.featured).toEqual({ count: 2, totalEur: 9.98 });
    expect(summary.byKind.bump).toEqual({ count: 1, totalEur: 1.99 });
  });
});

describe("summarizeBannerFees", () => {
  const rows = [
    { starts_at: "2026-10-08T00:00:00Z", fee_eur: 250 },
    { starts_at: "2026-09-01T00:00:00Z", fee_eur: "400.00" },
    { starts_at: "2026-10-20T00:00:00Z", fee_eur: 500 }, // future — not booked yet
    { starts_at: "2026-10-09T00:00:00Z", fee_eur: null },
  ];

  it("books fees on starts_at within the period, never in the future", () => {
    expect(summarizeBannerFees(rows, periodStart("7d", now), now)).toEqual({ count: 2, totalEur: 250 });
  });

  it("includes everything already started for all time", () => {
    expect(summarizeBannerFees(rows, null, now)).toEqual({ count: 3, totalEur: 650 });
  });
});

describe("topClickedProducts", () => {
  it("ranks by click count, ties by id, and limits", () => {
    const clicks = [3, 1, 3, 2, 2, 3, 5].map((product_id) => ({ product_id }));
    expect(topClickedProducts(clicks, 2)).toEqual([
      { productId: 3, clicks: 3 },
      { productId: 2, clicks: 2 },
    ]);
  });
});

describe("heldForSellersEur", () => {
  it("is the buyers' totals less PinPals' own Buyer Protection fee", () => {
    expect(
      heldForSellersEur([
        { total_eur: 105.7, platform_fee_eur: 5.7 },
        { total_eur: "52.80", platform_fee_eur: "3.20" },
        { total_eur: 200, platform_fee_eur: 0 },
      ])
    ).toBe(349.6);
  });
});

describe("releasesDueWithin", () => {
  it("returns held orders due in the window (overdue included), soonest first, skipping problems", () => {
    const orders = [
      { id: 1, release_due_at: "2026-10-12T09:00:00Z", problem_at: null },
      { id: 2, release_due_at: "2026-10-20T09:00:00Z", problem_at: null },
      { id: 3, release_due_at: "2026-10-09T09:00:00Z", problem_at: null },
      { id: 4, release_due_at: "2026-10-11T09:00:00Z", problem_at: "2026-10-10T08:00:00Z" },
      { id: 5, release_due_at: null, problem_at: null },
    ];
    expect(releasesDueWithin(orders, 3, now).map((o) => o.id)).toEqual([3, 1]);
  });
});

describe("formatCtr", () => {
  it("shows a one-decimal percentage, or a dash without impressions", () => {
    expect(formatCtr(1000, 25)).toBe("2.5%");
    expect(formatCtr(0, 4)).toBe("—");
  });
});

describe("aggregateStoreStats", () => {
  it("counts active listings and paid sales/commission per store", () => {
    const stats = aggregateStoreStats(
      [{ store_id: 1 }, { store_id: 1 }, { store_id: 2 }, { store_id: null }],
      [
        { store_id: 1, seller_commission_eur: 8 },
        { store_id: 1, seller_commission_eur: "4.40" },
        { store_id: 3, seller_commission_eur: 1.1 },
      ]
    );
    expect(stats.get(1)).toEqual({ itemsInStock: 2, salesCount: 2, commissionEur: 12.4 });
    expect(stats.get(2)).toEqual({ itemsInStock: 1, salesCount: 0, commissionEur: 0 });
    expect(stats.get(3)).toEqual({ itemsInStock: 0, salesCount: 1, commissionEur: 1.1 });
  });
});

describe("parseCommissionPercent / formatCommissionRate", () => {
  it("turns a percent into a stored rate, to a tenth of a percent", () => {
    expect(parseCommissionPercent("8")).toBe(0.08);
    expect(parseCommissionPercent("8.5%")).toBe(0.085);
    expect(parseCommissionPercent("0")).toBe(0);
    expect(parseCommissionPercent("50")).toBe(0.5);
  });

  it("rejects out-of-range or malformed input", () => {
    expect(parseCommissionPercent("51")).toBeNull();
    expect(parseCommissionPercent("-1")).toBeNull();
    expect(parseCommissionPercent("8.25")).toBeNull();
    expect(parseCommissionPercent("")).toBeNull();
    expect(parseCommissionPercent("abc")).toBeNull();
  });

  it("formats a stored rate back as a percent", () => {
    expect(formatCommissionRate(0.08)).toBe("8%");
    expect(formatCommissionRate("0.085")).toBe("8.5%");
  });
});

describe("isBannerLive", () => {
  it("is live only when active and inside its schedule", () => {
    const base = { active: true, starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-10-31T00:00:00Z" };
    expect(isBannerLive(base, now)).toBe(true);
    expect(isBannerLive({ ...base, active: false }, now)).toBe(false);
    expect(isBannerLive({ ...base, starts_at: "2026-10-11T00:00:00Z" }, now)).toBe(false);
    expect(isBannerLive({ ...base, ends_at: "2026-10-10T12:00:00Z" }, now)).toBe(false);
    expect(isBannerLive({ ...base, ends_at: null }, now)).toBe(true);
  });
});
