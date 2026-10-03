import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const rpc = vi.fn();
const adminFrom = vi.fn();

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  rateLimitMessage: () => "Too many attempts",
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, from: adminFrom }),
}));
vi.mock("@/lib/conversations-server", () => ({
  linkConversationToOrder: vi.fn(async () => undefined),
}));

import { buyNow, finishOfferCheckout, isDeliveryMethod, isOfferActionKind, makeOffer, placeBid, respondToOffer } from "./marketplace-operations";
import { checkRateLimit } from "@/lib/rate-limit";
import { linkConversationToOrder } from "@/lib/conversations-server";

const ME = "11111111-1111-4111-8111-111111111111";

/** A member's client: insert() resolves with `insertError`; select chains
 *  resolve maybeSingle() with `row`. */
function memberClient(opts: { insertError?: { code?: string; message: string } | null; row?: unknown } = {}) {
  const insert = vi.fn(async () => ({ error: opts.insertError ?? null }));
  const maybeSingle = vi.fn(async () => ({ data: opts.row ?? null }));
  const chain = { select: () => chain, eq: () => chain, maybeSingle };
  const from = vi.fn(() => ({ insert, ...chain }));
  return { supabase: { from } as unknown as SupabaseClient, insert, from };
}

function adminRows(row: unknown) {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row }) };
  adminFrom.mockReturnValue(chain);
}

beforeEach(() => {
  rpc.mockReset();
  adminFrom.mockReset();
  // Sweeps succeed quietly unless a test says otherwise.
  rpc.mockResolvedValue({ data: null, error: null });
  vi.mocked(linkConversationToOrder).mockClear();
});

describe("makeOffer", () => {
  it("inserts the offer as the caller", async () => {
    const c = memberClient();
    expect(await makeOffer({ supabase: c.supabase, userId: ME, listingId: 7, amountEur: 120 })).toEqual({ ok: true, value: null });
    expect(c.insert).toHaveBeenCalledWith({ listing_id: 7, buyer_id: ME, amount_eur: 120 });
  });

  it("refuses an amount under the floor before touching the table", async () => {
    const c = memberClient();
    const r = await makeOffer({ supabase: c.supabase, userId: ME, listingId: 7, amountEur: 0.5 });
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    expect(c.insert).not.toHaveBeenCalled();
  });

  it("explains a second active offer", async () => {
    const c = memberClient({ insertError: { code: "23505", message: "duplicate" } });
    const r = await makeOffer({ supabase: c.supabase, userId: ME, listingId: 7, amountEur: 50 });
    expect(r).toMatchObject({ ok: false, message: "You already have an active offer on this listing." });
  });

  it("passes the database's own message through when it is a known one", async () => {
    const c = memberClient({ insertError: { message: "Offer must be less than the asking price" } });
    const r = await makeOffer({ supabase: c.supabase, userId: ME, listingId: 7, amountEur: 500 });
    expect(r).toMatchObject({ ok: false, message: "Offer must be less than the asking price" });
  });

  it("never leaks an unexpected driver error", async () => {
    const c = memberClient({ insertError: { message: "connection reset by peer at 10.0.0.4" } });
    const r = await makeOffer({ supabase: c.supabase, userId: ME, listingId: 7, amountEur: 50 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).not.toContain("10.0.0.4");
  });

  it("is rate limited", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    const c = memberClient();
    expect(await makeOffer({ supabase: c.supabase, userId: ME, listingId: 7, amountEur: 50 })).toMatchObject({
      ok: false,
      reason: "rate_limited",
    });
    expect(c.insert).not.toHaveBeenCalled();
  });
});

describe("respondToOffer", () => {
  it("refuses an offer the caller cannot see, before the privileged call", async () => {
    const c = memberClient({ row: null });
    const r = await respondToOffer({ supabase: c.supabase, userId: ME, offerId: 3, action: "accept" });
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
    expect(rpc).not.toHaveBeenCalledWith("offer_action", expect.anything());
  });

  it("refuses an offer that belongs to a different listing than the one shown", async () => {
    const c = memberClient({ row: { id: 3, listing_id: 9 } });
    const r = await respondToOffer({ supabase: c.supabase, userId: ME, offerId: 3, listingId: 7, action: "decline" });
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("needs an amount to counter", async () => {
    const c = memberClient({ row: { id: 3, listing_id: 7 } });
    const r = await respondToOffer({ supabase: c.supabase, userId: ME, offerId: 3, action: "counter", counterAmountEur: null });
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("calls offer_action as the verified caller, with the counter in cents", async () => {
    const c = memberClient({ row: { id: 3, listing_id: 7 } });
    const r = await respondToOffer({ supabase: c.supabase, userId: ME, offerId: 3, action: "counter", counterAmountEur: 85.5 });
    expect(r).toEqual({ ok: true, value: { listingId: 7, orderId: null } });
    expect(rpc).toHaveBeenCalledWith("offer_action", expect.objectContaining({
      p_offer_id: 3,
      p_caller_id: ME,
      p_action: "counter",
      p_counter_amount_cents: 8550,
    }));
  });

  it("returns the order an accept created, and links the conversation", async () => {
    const c = memberClient({ row: { id: 3, listing_id: 7 } });
    adminRows({ id: 44, buyer_id: "b", seller_id: ME });
    const r = await respondToOffer({ supabase: c.supabase, userId: ME, offerId: 3, action: "accept" });
    expect(r).toEqual({ ok: true, value: { listingId: 7, orderId: 44 } });
    expect(linkConversationToOrder).toHaveBeenCalledWith({ listingId: 7, buyerId: "b", sellerId: ME, orderId: 44 });
  });
});

describe("placeBid", () => {
  it("finds the auction from the listing when the app sends only the listing", async () => {
    const c = memberClient({ row: { id: 12 } });
    expect(await placeBid({ supabase: c.supabase, userId: ME, listingId: 7, amountEur: 40 })).toEqual({ ok: true, value: null });
    expect(c.insert).toHaveBeenCalledWith({ auction_id: 12, bidder_id: ME, amount_cents: 4000 });
  });

  it("says so when the listing has no auction", async () => {
    const c = memberClient({ row: null });
    expect(await placeBid({ supabase: c.supabase, userId: ME, listingId: 7, amountEur: 40 })).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(c.insert).not.toHaveBeenCalled();
  });
});

describe("buyNow and finishOfferCheckout", () => {
  it("returns the new order id", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "create_purchase_order" ? { data: 55, error: null } : { data: null, error: null }
    );
    adminRows({ seller_id: "s" });
    const r = await buyNow({ userId: ME, listingId: 7, deliveryMethod: "post", addressId: 2 });
    expect(r).toEqual({ ok: true, value: { orderId: 55 } });
    expect(rpc).toHaveBeenCalledWith("create_purchase_order", expect.objectContaining({ p_caller_id: ME, p_address_id: 2 }));
  });

  it("surfaces create_purchase_order's own refusals", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "create_purchase_order"
        ? { data: null, error: { message: "This listing is no longer available" } }
        : { data: null, error: null }
    );
    const r = await buyNow({ userId: ME, listingId: 7, deliveryMethod: "collection", addressId: null });
    expect(r).toMatchObject({ ok: false, message: "This listing is no longer available" });
  });

  it("finishes an accepted offer's checkout as the caller", async () => {
    rpc.mockResolvedValue({ data: 44, error: null });
    expect(await finishOfferCheckout({ userId: ME, orderId: 44, deliveryMethod: "collection", addressId: null })).toEqual({
      ok: true,
      value: { orderId: 44 },
    });
    expect(rpc).toHaveBeenCalledWith("finalize_offer_checkout", expect.objectContaining({ p_caller_id: ME, p_order_id: 44 }));
  });
});

describe("input guards", () => {
  it("knows the delivery methods and offer actions", () => {
    expect(isDeliveryMethod("post")).toBe(true);
    expect(isDeliveryMethod("courier")).toBe(false);
    expect(isOfferActionKind("withdraw")).toBe(true);
    expect(isOfferActionKind("delete")).toBe(false);
  });
});
