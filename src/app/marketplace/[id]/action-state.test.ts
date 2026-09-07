import { describe, expect, it } from "vitest";
import { computeListingPurchaseState } from "./action-state";
import type { Auction, Listing } from "@/lib/types";

// Only the fields computeListingPurchaseState() actually reads.
function listing(overrides: Partial<Pick<Listing, "status" | "sale_type" | "price_eur">> = {}) {
  return {
    status: "active" as const,
    sale_type: "fixed_price" as const,
    price_eur: 100,
    ...overrides,
  };
}

function auction(overrides: Partial<Auction> = {}): Auction {
  return {
    id: 1,
    listing_id: 1,
    starting_price_cents: 10000,
    reserve_price_cents: null,
    buy_now_price_cents: null,
    min_increment_cents: 500,
    currency: "eur",
    starts_at: "2026-06-01T00:00:00.000Z",
    ends_at: "2026-06-20T00:00:00.000Z",
    status: "scheduled",
    winning_bid_id: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeListingPurchaseState", () => {
  it("shows Manage Listing for the seller, regardless of status or sale type", () => {
    const state = computeListingPurchaseState({
      listing: listing({ status: "sold" }),
      auction: null,
      currentBidCents: null,
      isSeller: true,
      isSignedIn: true,
    });
    expect(state).toEqual({ kind: "seller" });
  });

  it("prompts sign-in for a signed-out visitor on an active listing", () => {
    const state = computeListingPurchaseState({
      listing: listing(),
      auction: null,
      currentBidCents: null,
      isSeller: false,
      isSignedIn: false,
    });
    expect(state).toEqual({ kind: "signed_out" });
  });

  it.each(["reserved", "sold", "expired", "removed"] as const)(
    "disables purchasing and states why for a %s listing",
    (status) => {
      const state = computeListingPurchaseState({
        listing: listing({ status }),
        auction: null,
        currentBidCents: null,
        isSeller: false,
        isSignedIn: true,
      });
      expect(state.kind).toBe("unavailable");
      expect(state).toMatchObject({ kind: "unavailable" });
      if (state.kind === "unavailable") {
        expect(state.reason.length).toBeGreaterThan(0);
      }
    }
  );

  it("fixed_price: Buy Now only, no offer option", () => {
    const state = computeListingPurchaseState({
      listing: listing({ sale_type: "fixed_price", price_eur: 250 }),
      auction: null,
      currentBidCents: null,
      isSeller: false,
      isSignedIn: true,
    });
    expect(state).toEqual({ kind: "fixed_price", priceEur: 250, offersAllowed: false });
  });

  it("offers_allowed: Buy Now plus the optional Make an Offer flag", () => {
    const state = computeListingPurchaseState({
      listing: listing({ sale_type: "offers_allowed", price_eur: 250 }),
      auction: null,
      currentBidCents: null,
      isSeller: false,
      isSignedIn: true,
    });
    expect(state).toEqual({ kind: "fixed_price", priceEur: 250, offersAllowed: true });
  });

  it("auction: current bid, minimum next bid and exact closing time, no Buy Now price", () => {
    const a = auction({ starting_price_cents: 5000, min_increment_cents: 250, ends_at: "2099-01-01T00:00:00.000Z" });
    const state = computeListingPurchaseState({
      listing: listing({ sale_type: "auction", price_eur: null }),
      auction: a,
      currentBidCents: 6000,
      isSeller: false,
      isSignedIn: true,
    });
    expect(state).toEqual({
      kind: "auction",
      auctionId: a.id,
      currentBidCents: 6000,
      minimumNextBidCents: 6250,
      closesAtIso: a.ends_at,
      ended: false,
      buyNowPriceCents: null,
    });
  });

  it("auction with no bids yet: current bid falls back to the starting price", () => {
    const a = auction({ starting_price_cents: 5000, ends_at: "2099-01-01T00:00:00.000Z" });
    const state = computeListingPurchaseState({
      listing: listing({ sale_type: "auction", price_eur: null }),
      auction: a,
      currentBidCents: null,
      isSeller: false,
      isSignedIn: true,
    });
    expect(state).toMatchObject({ kind: "auction", currentBidCents: 5000, minimumNextBidCents: 5000 });
  });

  it("auction_with_buy_now: carries the Buy Now price alongside the bid state", () => {
    const a = auction({ buy_now_price_cents: 20000, ends_at: "2099-01-01T00:00:00.000Z" });
    const state = computeListingPurchaseState({
      listing: listing({ sale_type: "auction_with_buy_now", price_eur: null }),
      auction: a,
      currentBidCents: null,
      isSeller: false,
      isSignedIn: true,
    });
    expect(state).toMatchObject({ kind: "auction", buyNowPriceCents: 20000 });
  });

  it("marks an auction past its end time as ended even if nothing updated its status", () => {
    const a = auction({ ends_at: "2020-01-01T00:00:00.000Z", status: "live" });
    const state = computeListingPurchaseState({
      listing: listing({ sale_type: "auction", price_eur: null }),
      auction: a,
      currentBidCents: null,
      isSeller: false,
      isSignedIn: true,
    });
    expect(state).toMatchObject({ kind: "auction", ended: true });
  });
});
