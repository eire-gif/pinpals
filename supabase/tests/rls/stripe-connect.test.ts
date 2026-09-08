// Coverage for 0051_platform_fee_configuration.sql's platform_fee_rate() —
// the single server-side source of truth offer_action() and
// create_purchase_order() both now read from, replacing what used to be an
// inline `0.07` literal duplicated in each. See that migration's own header
// comment for why this exists as a function rather than a settings table.
import { describe, it, expect, afterAll } from "vitest";
import { pool, withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

describe("platform_fee_rate()", () => {
  it("returns the current 7% platform fee rate", async () => {
    const { rows } = await pool.query<{ platform_fee_rate: string }>("select public.platform_fee_rate()");
    expect(Number(rows[0].platform_fee_rate)).toBe(0.07);
  });

  it("neither anon nor an authenticated caller can call it directly", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expect(c.query("select public.platform_fee_rate()")).rejects.toThrow(/permission denied for function/);
    });
    await withRole("anon", null, async (c) => {
      await expect(c.query("select public.platform_fee_rate()")).rejects.toThrow(/permission denied for function/);
    });
  });
});

describe("offer_action() and create_purchase_order() still derive platform_fee_eur from platform_fee_rate()", () => {
  // Regression guard for the 0051 refactor itself: both functions used to
  // inline `0.07` — this confirms the centralized function produces the
  // exact same order-facing figures as before, on both order-creation paths.
  async function freshListing(sellerId: string, priceEur: number, saleType = "offers_allowed"): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.listings
         (seller_id, title, description, price_eur, price_cents, category, condition, county, status, sale_type,
          delivery_options)
       values ($1, 'Fee-rate fixture listing', 'x', $2, $3, 'irons', 'good', 'Kerry', 'active', $4, array['collection'])
       returning id`,
      [sellerId, priceEur, Math.round(priceEur * 100), saleType],
    );
    return rows[0].id;
  }

  async function dropListing(listingId: string) {
    await pool.query("delete from public.orders where listing_id = $1", [listingId]);
    await pool.query("delete from public.offers where listing_id = $1", [listingId]);
    await pool.query("delete from public.listings where id = $1", [listingId]);
  }

  it("offer_action(): a 200 EUR accepted offer snapshots a 14.00 EUR (7%) platform fee", async () => {
    const listingId = await freshListing(USERS.seller1, 200);
    try {
      const { rows: offerRows } = await pool.query<{ id: string }>(
        `insert into public.offers (listing_id, buyer_id, amount_eur, original_amount_eur, status, expires_at)
         values ($1, $2, 200, 200, 'pending', now() + interval '1 day')
         returning id`,
        [listingId, USERS.buyer1],
      );
      await pool.query("select * from public.offer_action($1, $2, 'accept')", [offerRows[0].id, USERS.seller1]);

      const { rows: orderRows } = await pool.query(
        "select platform_fee_eur from public.orders where listing_id = $1",
        [listingId],
      );
      expect(Number(orderRows[0].platform_fee_eur)).toBe(14);
    } finally {
      await dropListing(listingId);
    }
  });

  it("create_purchase_order(): a 300 EUR Buy Now snapshots a 21.00 EUR (7%) platform fee", async () => {
    const listingId = await freshListing(USERS.seller1, 300, "fixed_price");
    try {
      const { rows } = await pool.query<{ create_purchase_order: string }>(
        "select public.create_purchase_order($1, $2, $3, $4, $5)",
        [USERS.buyer1, listingId, "collection", null, 30],
      );
      const orderId = rows[0].create_purchase_order;
      const { rows: orderRows } = await pool.query("select platform_fee_eur from public.orders where id = $1", [
        orderId,
      ]);
      expect(Number(orderRows[0].platform_fee_eur)).toBe(21);
    } finally {
      await dropListing(listingId);
    }
  });
});
