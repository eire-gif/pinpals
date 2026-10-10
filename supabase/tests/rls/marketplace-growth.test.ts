// 0115_marketplace_growth.sql — pro shops, stock, shop pricing, promotions,
// affiliates, banners.
//
// What must hold:
//   - a member applies for a shop (pending); only an ACTIVE shop's owner can
//     list for it; strangers can't see a pending shop
//   - a shop item with stock stays on sale while units are left; a
//     cancelled order gives its unit back
//   - a shop sale charges no Buyer Protection and snapshots the commission
//   - promotions: only the service role activates; activation features/bumps
//     the listing; sellers read only their own
//   - affiliate/banner counters work for members; tables take no writes
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, setIdentity, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const OWNER = USERS.seller1;
const BUYER = USERS.buyer1;
const STRANGER = USERS.buyer2;

async function asService<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

async function rejects(c: PoolClient, sql: string, params: unknown[], pattern?: RegExp): Promise<void> {
  await c.query("savepoint attempt");
  let message: string | null = null;
  try {
    await c.query(sql, params);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  await c.query("rollback to savepoint attempt");
  if (message == null) throw new Error(`Expected to be rejected: ${sql}`);
  if (pattern && !pattern.test(message)) throw new Error(`Rejected with "${message}", expected ${pattern}`);
}

async function shop(c: PoolClient, approve = true): Promise<string> {
  await setIdentity(c, OWNER);
  const { rows } = await c.query<{ id: string }>("select public.store_apply('Portmarnock Pro Shop', null, 'Fittings daily', null, null, true) as id");
  if (approve) await asService(c, () => c.query("update public.stores set status = 'active' where id = $1", [rows[0].id]));
  await setIdentity(c, OWNER);
  return rows[0].id;
}

async function shopListing(c: PoolClient, storeId: string, stock: number, price = 100): Promise<string> {
  return asService(c, async () => {
    const { rows } = await c.query<{ id: string }>(
      `insert into public.listings (seller_id, title, description, price_eur, price_cents, category, condition, county, status, sale_type,
                                    delivery_options, collection_notes, store_id, is_new, stock_quantity)
       values ($1, 'Pro V1 dozen', 'x', $2, $3, 'Balls & accessories', 'New / unused', 'Dublin', 'active', 'fixed_price', '{collection,post}', 'Pro shop', $4, true, $5)
       returning id`,
      [OWNER, price, price * 100, storeId, stock],
    );
    return rows[0].id;
  });
}

describe("pro shops", () => {
  it("apply → pending; only the active shop's owner lists for it; strangers don't see a pending shop", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const id = await shop(c, false);
      expect((await c.query("select status, slug from public.stores where id = $1", [id])).rows[0]).toEqual({ status: "pending", slug: "portmarnock-pro-shop" });
      await setIdentity(c, STRANGER);
      expect((await c.query("select 1 from public.stores where id = $1", [id])).rowCount).toBe(0);
      // Pending: even the owner can't list for it yet.
      await rejects(
        c,
        `insert into public.listings (seller_id, title, description, price_eur, price_cents, category, condition, county, status, sale_type, store_id)
         values ($1, 'x', 'x', 10, 1000, 'Balls & accessories', 'New / unused', 'Dublin', 'active', 'fixed_price', $2)`,
        [OWNER, id],
      );
      await asService(c, () => c.query("update public.stores set status = 'active' where id = $1", [id]));
      await setIdentity(c, STRANGER);
      expect((await c.query("select 1 from public.stores where id = $1", [id])).rowCount).toBe(1);
      // Someone else can't list for it.
      await asService(c, async () => {
        await rejects(
          c,
          `insert into public.listings (seller_id, title, description, price_eur, price_cents, category, condition, county, status, sale_type, store_id)
           values ($1, 'x', 'x', 10, 1000, 'Balls & accessories', 'New / unused', 'Dublin', 'active', 'fixed_price', $2)`,
          [STRANGER, id],
          /approved shop/,
        );
      });
    });
  });

  it("stock keeps a shop item on sale; a cancelled order returns its unit", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const storeId = await shop(c);
      const listing = await shopListing(c, storeId, 2);
      await asService(c, () => c.query("update public.listings set status = 'reserved' where id = $1", [listing]));
      let l = (await asService(c, () => c.query("select status, stock_quantity from public.listings where id = $1", [listing]))).rows[0];
      expect(l).toEqual({ status: "active", stock_quantity: 1 });
      await asService(c, () => c.query("update public.listings set status = 'reserved' where id = $1", [listing]));
      l = (await asService(c, () => c.query("select status, stock_quantity from public.listings where id = $1", [listing]))).rows[0];
      expect(l).toEqual({ status: "reserved", stock_quantity: 0 });
      // An order for it is cancelled: the unit comes back.
      await asService(c, async () => {
        const { rows } = await c.query<{ id: string }>(
          `insert into public.orders (buyer_id, seller_id, listing_id, listing_title, listing_category, listing_condition, amount_eur, platform_fee_eur, total_eur, status)
           values ($1, $2, $3, 'x', 'Balls', 'new', 100, 5.7, 105.7, 'pending') returning id`,
          [BUYER, OWNER, listing],
        );
        await c.query("update public.orders set status = 'cancelled' where id = $1", [rows[0].id]);
      });
      l = (await asService(c, () => c.query("select status, stock_quantity from public.listings where id = $1", [listing]))).rows[0];
      expect(l).toEqual({ status: "active", stock_quantity: 1 });
    });
  });

  it("a shop sale charges no Buyer Protection and snapshots 8% commission", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const storeId = await shop(c);
      const listing = await shopListing(c, storeId, 5, 200);
      const o = await asService(c, async () => {
        const { rows } = await c.query(
          `insert into public.orders (buyer_id, seller_id, listing_id, listing_title, listing_category, listing_condition, amount_eur, platform_fee_eur, total_eur, status)
           values ($1, $2, $3, 'x', 'Balls', 'new', 200, 10.7, 210.7, 'pending') returning platform_fee_eur, total_eur, seller_commission_eur, store_id`,
          [BUYER, OWNER, listing],
        );
        return rows[0];
      });
      expect({ fee: Number(o.platform_fee_eur), total: Number(o.total_eur), commission: Number(o.seller_commission_eur), store: String(o.store_id) }).toEqual({
        fee: 0,
        total: 200,
        commission: 16,
        store: String(storeId),
      });
    });
  });
});

describe("promotions", () => {
  it("only the service role activates; a featured promotion features the listing", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const storeId = await shop(c);
      const listing = await shopListing(c, storeId, 1);
      const promo = await asService(c, async () => {
        const { rows } = await c.query<{ id: string }>(
          "insert into public.listing_promotions (listing_id, seller_id, kind, amount_eur) values ($1, $2, 'featured', 4.99) returning id",
          [listing, OWNER],
        );
        return rows[0].id;
      });
      await rejects(c, "select public.activate_listing_promotion($1, 'pi_x')", [promo], /permission denied/);
      await asService(c, () => c.query("select public.activate_listing_promotion($1, 'pi_x')", [promo]));
      const l = (await asService(c, () => c.query("select featured_until > now() + interval '6 days' as f, bumped_at is not null as b from public.listings where id = $1", [listing]))).rows[0];
      expect(l).toEqual({ f: true, b: true });
      await setIdentity(c, OWNER);
      expect((await c.query("select status from public.listing_promotions where id = $1", [promo])).rows[0].status).toBe("active");
      await setIdentity(c, STRANGER);
      expect((await c.query("select 1 from public.listing_promotions where id = $1", [promo])).rowCount).toBe(0);
      await rejects(c, "insert into public.listing_promotions (listing_id, seller_id, kind, amount_eur) values ($1, $2, 'bump', 0)", [listing, STRANGER], /permission denied/);
    });
  });
});

describe("promotions can't be self-served (0117)", () => {
  it("a seller writing featured_until or bumped_at directly changes nothing", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const storeId = await shop(c);
      const listing = await shopListing(c, storeId, 1);
      await setIdentity(c, OWNER);
      await c.query("update public.listings set featured_until = now() + interval '1 year', bumped_at = now() where id = $1", [listing]);
      const row = (await asService(c, () => c.query("select featured_until, bumped_at from public.listings where id = $1", [listing]))).rows[0];
      expect(row).toEqual({ featured_until: null, bumped_at: null });
      // The webhook path still works.
      await asService(c, () => c.query("update public.listings set bumped_at = now() where id = $1", [listing]));
      expect((await asService(c, () => c.query("select bumped_at is not null as b from public.listings where id = $1", [listing]))).rows[0].b).toBe(true);
      // ...and an ordinary edit by the seller keeps it.
      await setIdentity(c, OWNER);
      await c.query("update public.listings set title = 'Pro V1 dozen (2026)' where id = $1", [listing]);
      expect((await asService(c, () => c.query("select bumped_at is not null as b from public.listings where id = $1", [listing]))).rows[0].b).toBe(true);
    });
  });
});

describe("affiliates and banners", () => {
  it("counters work for members; the tables take no direct writes", async () => {
    await withRole("authenticated", BUYER, async (c) => {
      const ids = await asService(c, async () => {
        const p = await c.query<{ id: string }>(
          "insert into public.affiliate_products (title, retailer, url) values ('Rangefinder', 'Golf Shop', 'https://example.com/x?tag=pinpals') returning id",
        );
        const b = await c.query<{ id: string }>(
          "insert into public.marketplace_banners (title, link_url, sponsor) values ('2027 drivers', 'https://brand.example/drivers', 'Brand') returning id",
        );
        return { product: p.rows[0].id, banner: b.rows[0].id };
      });
      await setIdentity(c, BUYER);
      expect((await c.query("select public.affiliate_clicked($1, 'app') as u", [ids.product])).rows[0].u).toBe("https://example.com/x?tag=pinpals");
      await c.query("select public.banner_seen($1)", [ids.banner]);
      expect((await c.query("select public.banner_clicked($1) as u", [ids.banner])).rows[0].u).toBe("https://brand.example/drivers");
      const counts = await asService(c, () =>
        c.query(
          "select (select clicks from public.affiliate_products where id = $1) a, (select impressions from public.marketplace_banners where id = $2) i, (select clicks from public.marketplace_banners where id = $2) b, (select count(*)::int from public.affiliate_clicks where product_id = $1) log",
          [ids.product, ids.banner],
        ),
      );
      expect(counts.rows[0]).toEqual({ a: 1, i: 1, b: 1, log: 1 });
      await rejects(c, "update public.affiliate_products set clicks = 999 where id = $1", [ids.product], /permission denied/);
      await rejects(c, "insert into public.marketplace_banners (title, link_url, sponsor) values ('x', 'https://x.example', 'X')", [], /permission denied/);
    });
  });
});
