// Pure, framework-free helpers for /admin/marketplace — no Supabase, no
// Next.js, same split as roles.ts/moderation.ts: the actual data fetching
// lives in queries.ts, the actual mutation lives in
// src/app/admin/marketplace/actions.ts, this file only holds logic that's
// worth testing in isolation.

import type { Auction } from "@/lib/types";

/**
 * Whether an auction is eligible for the admin "force close" action —
 * still 'scheduled'/'live' (not already ended/cancelled) AND its own
 * ends_at has passed. This is the ONLY thing forceCloseAuction() (see
 * src/app/admin/marketplace/actions.ts) is allowed to act on: this schema
 * has no scheduled sweep that closes an auction the moment its clock runs
 * out (see supabase/migrations/0039_auctions_and_bids.sql — closing only
 * ever happens lazily, the moment someone tries to bid on or buy-now a
 * listing whose auction has already ended), so a real auction can sit
 * indefinitely in 'live' status with no way for its highest bidder to check
 * out. This is the pure predicate both the query layer (listAuctions()'
 * `staleOnly` filter) and the action's own server-side re-check share, so
 * the two can never drift apart into checking different things.
 *
 * Deliberately does NOT also gate on there being a winning bid — an auction
 * with zero bids that simply expired unsold is just as stuck (still 'live',
 * blocking a future edit/relist) and just as eligible to force-close.
 */
export function auctionEligibleForForceClose(
  auction: Pick<Auction, "status" | "ends_at">,
  now: Date = new Date()
): boolean {
  return (auction.status === "scheduled" || auction.status === "live") && new Date(auction.ends_at) <= now;
}

export type MarketplaceAlert = {
  key: string;
  label: string;
  count: number;
  href: string;
};

/**
 * Turns the raw counts from getMarketplaceOverviewMetrics() (queries.ts)
 * into the ordered list of alert cards the overview tab renders — pure and
 * DB-free so the "which counts become a visible alert, and in what order"
 * decision is unit-testable without mocking Supabase. A metric of 0 is
 * simply omitted (an empty queue isn't an alert), never rendered as a
 * "0 — all clear" card — the overview tab's own "Community snapshot"-style
 * section (mirroring /admin's root overview) is where a healthy zero still
 * belongs; this list is only ever things that need a human to look at them.
 */
export function buildMarketplaceAlerts(metrics: {
  openListingReports: number;
  openMessageReports: number;
  openDisputes: number;
  sellersNeedingAttention: number;
  webhookEventFailures: number;
  ordersAwaitingPayment: number;
  staleAuctions: number;
  unresolvedMarketplaceSupportCases: number;
}): MarketplaceAlert[] {
  const candidates: MarketplaceAlert[] = [
    {
      key: "openListingReports",
      label: "Listings with open reports",
      count: metrics.openListingReports,
      href: "/admin/marketplace?tab=listings",
    },
    {
      key: "openMessageReports",
      label: "Reported messages awaiting review",
      count: metrics.openMessageReports,
      href: "/admin/marketplace?tab=messages",
    },
    {
      key: "openDisputes",
      label: "Open disputes",
      count: metrics.openDisputes,
      href: "/admin/marketplace?tab=disputes",
    },
    {
      key: "sellersNeedingAttention",
      label: "Sellers needing Connect attention",
      count: metrics.sellersNeedingAttention,
      href: "/admin/marketplace?tab=sellers",
    },
    {
      key: "webhookEventFailures",
      label: "Failed webhook events",
      count: metrics.webhookEventFailures,
      href: "/admin/webhook-events?status=failed",
    },
    {
      key: "ordersAwaitingPayment",
      label: "Orders awaiting payment",
      count: metrics.ordersAwaitingPayment,
      href: "/admin/marketplace?tab=orders",
    },
    {
      key: "staleAuctions",
      label: "Auctions stuck past their end time",
      count: metrics.staleAuctions,
      href: "/admin/marketplace?tab=offers",
    },
    {
      key: "unresolvedMarketplaceSupportCases",
      label: "Open marketplace support cases",
      count: metrics.unresolvedMarketplaceSupportCases,
      href: "/admin/support",
    },
  ];
  return candidates.filter((a) => a.count > 0);
}
