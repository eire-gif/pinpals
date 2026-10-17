// 0163_marketplace_catalogue_top_picks.sql — the model catalogue, brand
// logos, search by model, the finder's counts, and Top picks.
//
// What must hold:
//   - anyone reads the catalogue; nobody but the service role writes it
//   - a listing's model must be its own brand's, in its own category
//   - the search narrows by model; the counts follow club → brand → model
//   - members can't put themselves in Top picks; paying does — Premium for
//     3 days, Premium Plus for 7 (and Featured)
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, setIdentity, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const SELLER = USERS.seller1;

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

async function driver(c: PoolClient, title: string, model: string | null, price = 25000): Promise<string> {
  return asService(c, async () => {
    const { rows } = await c.query<{ id: string }>(
      `insert into public.listings (seller_id, title, description, price_eur, price_cents, category, condition, county, status, sale_type,
                                    delivery_options, collection_notes, brand, model_id)
       values ($1, $2, 'x', $3 / 100.0, $3, 'Drivers', 'Excellent', 'Dublin', 'active', 'fixed_price', '{collection}', 'At the club', 'taylormade', $4)
       returning id`,
      [SELLER, title, price, model],
    );
    return rows[0].id;
  });
}

describe("the model catalogue", () => {
  it("is readable by anyone and written by nobody else", async () => {
    await withRole("anon", null, async (c) => {
      const { rows } = await c.query("select family, versions from public.marketplace_models where id = 'taylormade-qi10'");
      expect(rows[0].family).toBe("Qi10");
      expect(rows[0].versions).toContain("Qi10 LS");
      await rejects(c, "insert into public.marketplace_models (id, brand_id, category, family) values ('x', 'ping', 'Drivers', 'X')", [], /permission denied/);
      await rejects(c, "update public.marketplace_brands set logo_url = 'https://evil.example/x.png' where id = 'ping'", [], /permission denied/);
    });
    await withRole("authenticated", SELLER, async (c) => {
      await rejects(c, "delete from public.marketplace_models where id = 'taylormade-qi10'", [], /permission denied/);
    });
  });

  it("keeps a listing's model to its own brand and category", async () => {
    await withRole("authenticated", SELLER, async (c) => {
      const id = await driver(c, "Qi10 10.5", "taylormade-qi10");
      await setIdentity(c, SELLER);
      // A PING model on a TaylorMade driver.
      await rejects(c, "update public.listings set model_id = 'ping-g430' where id = $1", [id], /isn't one of this brand/);
      // An iron model on a driver.
      await rejects(c, "update public.listings set model_id = 'taylormade-p790' where id = $1", [id], /isn't one of this brand/);
      // Changing the brand drops a model that no longer fits, rather than refusing the save.
      await c.query("update public.listings set brand = 'ping' where id = $1", [id]);
      const row = (await asService(c, () => c.query("select brand, model_id from public.listings where id = $1", [id]))).rows[0];
      expect(row).toEqual({ brand: "ping", model_id: null });
    });
  });
});

describe("search by model and the finder's counts", () => {
  it("narrows club → brand → model", async () => {
    await withRole("authenticated", SELLER, async (c) => {
      const qi10 = await driver(c, "Qi10 LS 9", "taylormade-qi10", 23000);
      const stealth = await driver(c, "Stealth 2 driver", "taylormade-stealth-2", 16000);
      await c.query("set local role anon");
      const found = await c.query<{ id: string }>(
        "select id from public.search_marketplace_listings(p_category => 'Drivers', p_brands => array['taylormade'], p_model => 'taylormade-qi10', p_limit => 60)",
      );
      const ids = found.rows.map((r) => String(r.id));
      expect(ids).toContain(String(qi10));
      expect(ids).not.toContain(String(stealth));
      // Existing callers (no p_model) are unchanged.
      const all = await c.query("select id from public.search_marketplace_listings(p_category => 'Drivers', p_limit => 60)");
      expect(all.rows.map((r) => String(r.id))).toEqual(expect.arrayContaining([String(qi10), String(stealth)]));

      const counts = await c.query<{ level: string; key: string; listing_count: string; min_price_cents: number }>(
        "select * from public.marketplace_finder_counts('Drivers', 'taylormade')",
      );
      const get = (level: string, key: string) => counts.rows.find((r) => r.level === level && r.key === key);
      expect(Number(get("category", "Drivers")?.listing_count)).toBeGreaterThanOrEqual(2);
      expect(Number(get("brand", "taylormade")?.listing_count)).toBeGreaterThanOrEqual(2);
      expect(Number(get("model", "taylormade-qi10")?.listing_count)).toBeGreaterThanOrEqual(1);
      expect(get("model", "taylormade-stealth-2")?.min_price_cents).toBeLessThanOrEqual(16000);
      // No brand picked → no model rows.
      const top = await c.query("select * from public.marketplace_finder_counts('Drivers', null) where level = 'model'");
      expect(top.rowCount).toBe(0);
    });
  });
});

describe("Top picks", () => {
  it("can't be self-served; Premium buys 3 days and Premium Plus 7", async () => {
    await withRole("authenticated", SELLER, async (c) => {
      const a = await driver(c, "Qi10 Max 12", "taylormade-qi10");
      const b = await driver(c, "Qi10 10.5 stiff", "taylormade-qi10");
      await setIdentity(c, SELLER);
      await c.query("update public.listings set top_pick_until = now() + interval '1 year' where id = $1", [a]);
      expect((await asService(c, () => c.query("select top_pick_until from public.listings where id = $1", [a]))).rows[0].top_pick_until).toBeNull();

      const [premium, plus] = await asService(c, async () => {
        const p1 = await c.query<{ id: string }>("insert into public.listing_promotions (listing_id, seller_id, kind, amount_eur) values ($1, $2, 'bump', 1.99) returning id", [a, SELLER]);
        const p2 = await c.query<{ id: string }>("insert into public.listing_promotions (listing_id, seller_id, kind, amount_eur) values ($1, $2, 'featured', 4.99) returning id", [b, SELLER]);
        return [p1.rows[0].id, p2.rows[0].id];
      });
      await rejects(c, "select public.activate_listing_promotion($1, 'pi_a')", [premium], /permission denied/);
      await asService(c, async () => {
        await c.query("select public.activate_listing_promotion($1, 'pi_a')", [premium]);
        await c.query("select public.activate_listing_promotion($1, 'pi_b')", [plus]);
      });
      const rows = (
        await asService(c, () =>
          c.query(
            `select id,
                    top_pick_until between now() + interval '2 days 23 hours' and now() + interval '3 days 1 hour' as three,
                    top_pick_until between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour' as seven,
                    featured_until is not null as featured
               from public.listings where id in ($1, $2) order by id`,
            [a, b],
          ),
        )
      ).rows;
      expect(rows.find((r) => String(r.id) === String(a))).toMatchObject({ three: true, featured: false });
      expect(rows.find((r) => String(r.id) === String(b))).toMatchObject({ seven: true, featured: true });

      // Anyone browsing sees them.
      await c.query("set local role anon");
      const seen = await c.query("select id from public.listings where top_pick_until > now() and model_id = 'taylormade-qi10' and status = 'active'");
      expect(seen.rows.map((r) => String(r.id))).toEqual(expect.arrayContaining([String(a), String(b)]));
    });
  });
});
