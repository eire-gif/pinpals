// 0203_wanted_ads.sql — wanted ads.
//
// Cast:
//   buyer1   posts a wanted ad
//   seller1  lists clubs
//   buyer2   another member
//
// What must hold:
//   - a member posts and changes their own wanted ads, ten open at a time; nobody else's
//   - open, unexpired ads are seen by members (not across a block); closed ones only by their owner
//   - a listing going live that fits tells the wanted ad's owner once; one that doesn't fit doesn't
//   - only the seller sees who's looking for their listing, and sends it; never twice
//   - no direct writes
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const BUYER = USERS.buyer1;
const SELLER = USERS.seller1;
const OTHER = USERS.buyer2;

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
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

const SAVE = "select public.wanted_save($1, $2::jsonb) as id";
const ad = (x: object = {}) => JSON.stringify({ category: "Woods & hybrids", details: "3-wood, 15°", shaft_flex: "Stiff", max_price_cents: 10000, county: "Dublin", ...x });

async function list(c: PoolClient, x: { price?: number; flex?: string | null; county?: string; status?: string; category?: string } = {}): Promise<string> {
  await c.query("set local role service_role");
  const { rows } = await c.query<{ id: string }>(
    `insert into public.listings (seller_id, title, description, price_eur, price_cents, category, condition, county, status, sale_type, shaft_flex)
     values ($1, '3-wood, 15°, stiff', 'x', $2, $3, $4, 'good', $5, $6, 'fixed_price', $7) returning id`,
    [SELLER, (x.price ?? 8000) / 100, x.price ?? 8000, x.category ?? "Woods & hybrids", x.county ?? "Dublin", x.status ?? "active", x.flex === undefined ? "Stiff" : x.flex]
  );
  await c.query("set local role authenticated");
  return rows[0].id;
}

/** The buyer's notifications for this ad and listing, read as the service (the caller may be the seller). */
async function told(c: PoolClient, wanted: string, listing: string): Promise<number> {
  await c.query("set local role service_role");
  try {
    const r = await c.query("select count(*)::int as n from public.notifications where user_id = $1 and dedupe_key = $2", [BUYER, `wanted-${wanted}-${listing}`]);
    return r.rows[0].n as number;
  } finally {
    await c.query("set local role authenticated");
  }
}

describe("wanted ads", () => {
  it("are the member's own to post, change and close; ten at a time", async () => {
    await withRole("authenticated", BUYER, async (c) => {
      await as(c, BUYER);
      const id = (await c.query<{ id: string }>(SAVE, [null, ad()])).rows[0].id;
      await rejects(c, SAVE, [null, ad({ category: "Clubs" })], /Pick what you're looking for/);
      await rejects(c, SAVE, [null, ad({ shaft_flex: "Floppy" })], /shaft flex/);
      await c.query(SAVE, [id, ad({ max_price_cents: 12000 })]);
      await as(c, OTHER);
      await rejects(c, SAVE, [id, ad()], /isn't yours/);
      await rejects(c, "select public.wanted_close($1)", [id], /isn't yours/);
      await as(c, BUYER);
      for (let i = 0; i < 9; i++) await c.query(SAVE, [null, ad()]);
      await rejects(c, SAVE, [null, ad()], /ten wanted ads/);
      await c.query("select public.wanted_close($1)", [id]);
      await c.query(SAVE, [null, ad()]);
    });
  });

  it("open ones are seen by members, not across a block; closed ones only by their owner", async () => {
    await withRole("authenticated", BUYER, async (c) => {
      await as(c, BUYER);
      const id = (await c.query<{ id: string }>(SAVE, [null, ad()])).rows[0].id;
      await as(c, OTHER);
      expect((await c.query("select 1 from public.wanted_ads where id = $1", [id])).rowCount).toBe(1);
      await c.query("set local role service_role");
      await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [BUYER, OTHER]);
      await c.query("set local role authenticated");
      expect((await c.query("select 1 from public.wanted_ads where id = $1", [id])).rowCount).toBe(0);
      await as(c, SELLER);
      await as(c, BUYER);
      await c.query("select public.wanted_close($1)", [id]);
      expect((await c.query("select status from public.wanted_ads where id = $1", [id])).rows[0].status).toBe("closed");
      await as(c, SELLER);
      expect((await c.query("select 1 from public.wanted_ads where id = $1", [id])).rowCount).toBe(0);
    });
  });

  it("a listing that fits tells them when it goes live, once; one that doesn't, doesn't", async () => {
    await withRole("authenticated", BUYER, async (c) => {
      await as(c, BUYER);
      const id = (await c.query<{ id: string }>(SAVE, [null, ad()])).rows[0].id;
      const fits = await list(c);
      expect(await told(c, id, fits)).toBe(1);
      const regular = await list(c, { flex: "Regular" });
      const cork = await list(c, { county: "Cork" });
      const dear = await list(c, { price: 12000 });
      const putter = await list(c, { category: "Putters" });
      for (const l of [regular, cork, dear, putter]) expect(await told(c, id, l)).toBe(0);
      // One waiting for review is matched when it goes live.
      const waiting = await list(c, { status: "pending_review" });
      expect(await told(c, id, waiting)).toBe(0);
      // As a moderator would (no member signed in: 0045 lets staff move it on).
      await as(c, "");
      await c.query("set local role service_role");
      await c.query("update public.listings set status = 'active' where id = $1", [waiting]);
      await c.query("set local role authenticated");
      await as(c, BUYER);
      expect(await told(c, id, waiting)).toBe(1);
    });
  });

  it("only the seller sees who's looking and sends their ad; the close ones too", async () => {
    await withRole("authenticated", BUYER, async (c) => {
      await as(c, BUYER);
      const id = (await c.query<{ id: string }>(SAVE, [null, ad()])).rows[0].id;
      const dear = await list(c, { price: 12000 }); // a fifth over: close
      const MATCHES = "select wanted_id, member_id, first_name, fit, told from public.wanted_matches_for_listing($1)";
      await as(c, OTHER);
      expect((await c.query(MATCHES, [dear])).rows).toEqual([]);
      await rejects(c, "select public.wanted_send_listing($1, $2)", [id, dear], /Only the seller/);
      await as(c, SELLER);
      const before = (await c.query(MATCHES, [dear])).rows;
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({ wanted_id: id, member_id: BUYER, fit: "close", told: false });
      await c.query("select public.wanted_send_listing($1, $2)", [id, dear]);
      await c.query("select public.wanted_send_listing($1, $2)", [id, dear]);
      expect(await told(c, id, dear)).toBe(1);
      expect((await c.query(MATCHES, [dear])).rows[0].told).toBe(true);
      // Far over their price: not a match at all.
      const far = await list(c, { price: 20000 });
      expect((await c.query(MATCHES, [far])).rows).toEqual([]);
      await rejects(c, "select public.wanted_send_listing($1, $2)", [id, far], /doesn't fit/);
    });
  });

  it("can't be written directly", async () => {
    await withRole("authenticated", BUYER, async (c) => {
      await rejects(c, "insert into public.wanted_ads (member_id, category) values ($1, 'Drivers')", [BUYER], /permission denied/);
    });
  });
});
