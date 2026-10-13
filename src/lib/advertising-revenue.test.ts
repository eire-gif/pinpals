import { describe, expect, it } from "vitest";
import {
  bookedCents,
  cumulativeEarnedCents,
  dailyReport,
  divRoundHalfEven,
  earnedBetweenCents,
  isCapReached,
  monthBounds,
  monthTotals,
  runDays,
  summarizeCampaign,
  toCents,
  type CampaignMoney,
  type DailyStat,
} from "./advertising-revenue";

function campaign(over: Partial<CampaignMoney> = {}): CampaignMoney {
  return {
    pricing_model: "flat",
    rate_eur: "300.00",
    budget_cap_eur: null,
    starts_at: "2026-10-01T00:00:00Z",
    ends_at: "2026-10-31T00:00:00Z", // 30 days: 1st–30th
    status: "approved",
    payment_status: "unpaid",
    approved_at: "2026-09-28T10:00:00Z",
    ...over,
  };
}

const day = (d: string, views: number, clicks = 0): DailyStat => ({ day: d, views, clicks, dismisses: 0, anon_views: 0 });

describe("cents", () => {
  it("parses numeric strings and floats exactly", () => {
    expect(toCents("12.50")).toBe(1250);
    expect(toCents("7")).toBe(700);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(null)).toBe(0);
    expect(toCents("abc")).toBe(0);
  });

  it("rounds extra digits half to even", () => {
    expect(toCents("0.125")).toBe(12);
    expect(toCents("0.135")).toBe(14);
    expect(toCents("0.1251")).toBe(13);
  });

  it("divides half to even", () => {
    expect(divRoundHalfEven(5, 2)).toBe(2);
    expect(divRoundHalfEven(7, 2)).toBe(4);
    expect(divRoundHalfEven(10, 3)).toBe(3);
    expect(divRoundHalfEven(20, 3)).toBe(7);
  });
});

describe("flat", () => {
  it("spreads the fee evenly by day and caps at the rate", () => {
    const c = campaign();
    expect(runDays(c)).toEqual({ first: "2026-10-01", last: "2026-10-30", total: 30 });
    expect(cumulativeEarnedCents(c, [], "2026-09-30")).toBe(0);
    expect(cumulativeEarnedCents(c, [], "2026-10-01")).toBe(1000); // a day counts once it starts
    expect(cumulativeEarnedCents(c, [], "2026-10-15")).toBe(15000);
    expect(cumulativeEarnedCents(c, [], "2026-11-20")).toBe(30000);
  });

  it("books the full value once approved; nothing before", () => {
    const asOf = new Date("2026-10-05T12:00:00Z");
    expect(bookedCents(campaign(), [], asOf)).toBe(30000);
    expect(bookedCents(campaign({ status: "pending_approval", approved_at: null }), [], asOf)).toBe(0);
    expect(cumulativeEarnedCents(campaign({ status: "draft", approved_at: null }), [], "2026-10-20")).toBe(0);
    // Edited after approval and back in the queue: still earning.
    expect(cumulativeEarnedCents(campaign({ status: "pending_approval" }), [], "2026-10-02")).toBe(2000);
  });

  it("splits a run across two months so the parts add up to the whole", () => {
    // 25 Oct 09:00 – 4 Nov 09:00, €100: touches 11 UTC days, 7 in October and 4 in November.
    const c = campaign({ rate_eur: "100", starts_at: "2026-10-25T09:00:00Z", ends_at: "2026-11-04T09:00:00Z" });
    expect(runDays(c)?.total).toBe(11); // partial first and last days each count as a day
    const oct = earnedBetweenCents(c, [], "2026-10-01", "2026-10-31");
    const nov = earnedBetweenCents(c, [], "2026-11-01", "2026-11-30");
    expect(oct + nov).toBe(10000);
    expect(oct).toBe(divRoundHalfEven(10000 * 7, 11));
  });

  it("pays out daily figures that sum to the contract", () => {
    const c = campaign({ rate_eur: "100.00", ends_at: "2026-10-04T00:00:00Z" }); // 3 days: 33.33, 33.34, 33.33
    const rows = dailyReport(c, [], new Date("2026-11-01T00:00:00Z"));
    expect(rows.map((r) => r.earnedEur)).toEqual([33.33, 33.34, 33.33]);
    expect(rows.reduce((a, r) => a + Math.round(r.earnedEur * 100), 0)).toBe(10000);
  });
});

describe("cpm", () => {
  const c = campaign({ pricing_model: "cpm", rate_eur: "12.00", ends_at: null });

  it("charges per thousand billable views", () => {
    const stats = [day("2026-10-01", 1500), day("2026-10-02", 250)];
    expect(cumulativeEarnedCents(c, stats, "2026-10-01")).toBe(1800);
    expect(cumulativeEarnedCents(c, stats, "2026-10-02")).toBe(2100);
  });

  it("caps at the budget, and says so", () => {
    const capped = { ...c, budget_cap_eur: "20.00" };
    const stats = [day("2026-10-01", 1500), day("2026-10-02", 900)];
    expect(cumulativeEarnedCents(capped, stats, "2026-10-02")).toBe(2000);
    expect(isCapReached(capped, stats)).toBe(true);
    expect(isCapReached(capped, [day("2026-10-01", 1600)])).toBe(false);
    expect(bookedCents(capped, stats, new Date("2026-10-02T12:00:00Z"))).toBe(2000);
  });

  it("handles zero views", () => {
    const s = summarizeCampaign(c, [], new Date("2026-10-10T00:00:00Z"));
    expect(s).toMatchObject({ views: 0, earnedEur: 0, ctr: null, effectiveCpmEur: null, outstandingEur: 0 });
  });
});

describe("cpc", () => {
  it("charges per billable click, capped", () => {
    const c = campaign({ pricing_model: "cpc", rate_eur: "0.40", budget_cap_eur: "10.00", ends_at: null });
    const stats = [day("2026-10-01", 900, 20), day("2026-10-02", 800, 10)];
    expect(cumulativeEarnedCents(c, stats, "2026-10-01")).toBe(800);
    expect(cumulativeEarnedCents(c, stats, "2026-10-02")).toBe(1000); // 30 × 0.40 = 12, capped at 10
    expect(isCapReached(c, stats)).toBe(true);
    expect(earnedBetweenCents(c, stats, "2026-10-02", "2026-10-02")).toBe(200);
  });
});

describe("summary", () => {
  it("reports CTR, effective CPM and outstanding", () => {
    const c = campaign({ payment_status: "invoiced" });
    const stats = [day("2026-10-01", 1000, 15), day("2026-10-02", 1000, 5)];
    const s = summarizeCampaign(c, stats, new Date("2026-10-02T12:00:00Z"));
    expect(s.views).toBe(2000);
    expect(s.clicks).toBe(20);
    expect(s.ctr).toBeCloseTo(0.01);
    expect(s.earnedEur).toBe(20);
    expect(s.effectiveCpmEur).toBe(10);
    expect(s.bookedEur).toBe(300);
    expect(s.outstandingEur).toBe(20);
  });

  it("treats paid as the booked amount paid, and waived as nothing owed", () => {
    const asOf = new Date("2026-10-10T00:00:00Z");
    expect(summarizeCampaign(campaign({ payment_status: "paid" }), [], asOf)).toMatchObject({ paidEur: 300, outstandingEur: 0 });
    expect(summarizeCampaign(campaign({ payment_status: "waived" }), [], asOf)).toMatchObject({ paidEur: 0, outstandingEur: 0 });
    expect(summarizeCampaign(campaign({ payment_status: "unpaid" }), [], asOf).outstandingEur).toBe(100);
  });
});

describe("month totals", () => {
  it("counts only this month, month to date", () => {
    expect(monthBounds(new Date("2026-02-14T00:00:00Z"))).toEqual({ first: "2026-02-01", last: "2026-02-28" });
    const flat = campaign({ starts_at: "2026-09-16T00:00:00Z", ends_at: "2026-10-16T00:00:00Z" }); // 30 days, €10/day
    const cpm = campaign({ pricing_model: "cpm", rate_eur: "10", ends_at: null, starts_at: "2026-09-01T00:00:00Z" });
    const cpmStats = [day("2026-09-30", 5000, 50), day("2026-10-03", 2000, 10)];
    const t = monthTotals(
      [
        { campaign: flat, stats: [] },
        { campaign: cpm, stats: cpmStats },
      ],
      new Date("2026-10-05T08:00:00Z")
    );
    expect(t.month).toBe("2026-10");
    // flat: 5 October days × €10; cpm: 2,000 views × €10/1000.
    expect(t.earnedEur).toBe(70);
    expect(t.views).toBe(2000);
    expect(t.clicks).toBe(10);
  });
});
