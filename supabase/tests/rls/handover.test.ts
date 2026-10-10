// 0114_marketplace_handover.sql — Buyer Protection, held money, the handover.
//
// What must hold:
//   - the fee is €0.70 + 5% of the item price
//   - paying an order holds the money and starts the handover; a collection
//     gets a 4-digit code that only the buyer can read
//   - only the seller can confirm a handover, only with the right code, and
//     five wrong tries lock it
//   - post: seller marks posted (release in 14 days), buyer confirms
//     received (release now)
//   - a problem from the buyer freezes the release
//   - orders_due_for_release() is service-role only and returns what's due
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { pool, withRole, setIdentity, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const BUYER = USERS.buyer1;
const SELLER = USERS.seller1;
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

/** A pending order, then paid — as the Stripe webhook would. */
async function paidOrder(c: PoolClient, delivery: "collection" | "post"): Promise<string> {
  return asService(c, async () => {
    const { rows } = await c.query<{ id: string }>(
      `insert into public.orders (buyer_id, seller_id, listing_title, listing_category, listing_condition,
                                  amount_eur, platform_fee_eur, total_eur, status, delivery_method)
       values ($1, $2, 'Driver', 'Drivers', 'good', 100, 5.7, 105.7, 'pending', $3) returning id`,
      [BUYER, SELLER, delivery],
    );
    await c.query("update public.orders set payment_status = 'paid', status = 'completed' where id = $1", [rows[0].id]);
    return rows[0].id;
  });
}

const order = (c: PoolClient, id: string) =>
  asService(c, async () => (await c.query("select * from public.orders where id = $1", [id])).rows[0]);

describe("Buyer Protection fee", () => {
  it("is €0.70 + 5%", async () => {
    const { rows } = await pool.query("select public.platform_fee_eur(100) a, public.platform_fee_eur(185) b, public.platform_fee_eur(20) c");
    expect(rows[0]).toEqual({ a: "5.70", b: "9.95", c: "1.70" });
  });
});

describe("collection: the handover code", () => {
  it("paying holds the money and gives the buyer — only the buyer — a code", async () => {
    await withRole("authenticated", BUYER, async (c) => {
      const id = await paidOrder(c, "collection");
      const o = await order(c, id);
      expect(o.fulfilment_status).toBe("awaiting_handover");
      expect(o.payout_status).toBe("held");

      await setIdentity(c, BUYER);
      const mine = await c.query("select code from public.order_handover_codes where order_id = $1", [id]);
      expect(mine.rows[0].code).toMatch(/^\d{4}$/);

      await setIdentity(c, SELLER);
      expect((await c.query("select 1 from public.order_handover_codes where order_id = $1", [id])).rowCount).toBe(0);
      await setIdentity(c, STRANGER);
      expect((await c.query("select 1 from public.order_handover_codes where order_id = $1", [id])).rowCount).toBe(0);
    });
  });

  it("the seller confirms with the right code; wrong codes count; five lock it", async () => {
    await withRole("authenticated", BUYER, async (c) => {
      const id = await paidOrder(c, "collection");
      const code = (await asService(c, () => c.query("select code from public.order_handover_codes where order_id = $1", [id]))).rows[0].code as string;
      const wrong = code === "0000" ? "1111" : "0000";
      const confirm = "select public.order_confirm_handover($1, $2) as r";

      await setIdentity(c, BUYER);
      await rejects(c, confirm, [id, code], /Order not found/);

      await setIdentity(c, SELLER);
      expect((await c.query(confirm, [id, wrong])).rows[0].r).toBe("wrong");
      expect((await c.query(confirm, [id, code])).rows[0].r).toBe("ok");
      const o = await order(c, id);
      expect(o.fulfilment_status).toBe("completed");
      expect(new Date(o.release_due_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });
    await withRole("authenticated", SELLER, async (c) => {
      const id = await paidOrder(c, "collection");
      const code = (await asService(c, () => c.query("select code from public.order_handover_codes where order_id = $1", [id]))).rows[0].code as string;
      const wrong = code === "0000" ? "1111" : "0000";
      await setIdentity(c, SELLER);
      const results: string[] = [];
      for (let i = 0; i < 5; i++) results.push((await c.query("select public.order_confirm_handover($1, $2) as r", [id, wrong])).rows[0].r);
      expect(results).toEqual(["wrong", "wrong", "wrong", "wrong", "locked"]);
      // Even the right code is refused now.
      expect((await c.query("select public.order_confirm_handover($1, $2) as r", [id, code])).rows[0].r).toBe("locked");
      expect((await order(c, id)).fulfilment_status).toBe("awaiting_handover");
    });
  });

  it("a meet-up sets the automatic release three days later; strangers can't", async () => {
    await withRole("authenticated", BUYER, async (c) => {
      const id = await paidOrder(c, "collection");
      await setIdentity(c, BUYER);
      await c.query("select public.order_set_meetup($1, now() + interval '2 days', 'Portmarnock GC car park')", [id]);
      const o = await order(c, id);
      expect(o.meetup_place).toBe("Portmarnock GC car park");
      expect(new Date(o.release_due_at).getTime() - new Date(o.meetup_at).getTime()).toBe(3 * 24 * 3600 * 1000);
      await setIdentity(c, STRANGER);
      await rejects(c, "select public.order_set_meetup($1, now() + interval '2 days', 'x')", [id], /Order not found/);
    });
  });
});

describe("post", () => {
  it("posted: release in 14 days; received: release now", async () => {
    await withRole("authenticated", SELLER, async (c) => {
      const id = await paidOrder(c, "post");
      expect((await order(c, id)).fulfilment_status).toBe("awaiting_post");
      await setIdentity(c, BUYER);
      await rejects(c, "select public.order_mark_posted($1, 'RR123')", [id], /Order not found/);
      await setIdentity(c, SELLER);
      await c.query("select public.order_mark_posted($1, 'RR123IE')", [id]);
      let o = await order(c, id);
      expect(o.fulfilment_status).toBe("posted");
      expect(o.tracking_ref).toBe("RR123IE");
      expect(new Date(o.release_due_at).getTime()).toBeGreaterThan(Date.now() + 13 * 24 * 3600 * 1000);
      await rejects(c, "select public.order_confirm_received($1)", [id], /Order not found/);
      await setIdentity(c, BUYER);
      await c.query("select public.order_confirm_received($1)", [id]);
      o = await order(c, id);
      expect(o.fulfilment_status).toBe("received");
    });
  });
});

describe("problems and release", () => {
  it("a problem freezes the release; due orders are listed for the service role only", async () => {
    await withRole("authenticated", BUYER, async (c) => {
      const frozen = await paidOrder(c, "post");
      const due = await paidOrder(c, "post");
      await setIdentity(c, BUYER);
      await c.query("select public.order_confirm_received($1)", [due]);
      await c.query("select public.order_flag_problem($1)", [frozen]);
      expect((await order(c, frozen)).fulfilment_status).toBe("problem");
      await rejects(c, "select * from public.orders_due_for_release()", [], /permission denied/);
      const listed = await asService(c, () => c.query<{ id: string }>("select id from public.orders_due_for_release()"));
      const ids = listed.rows.map((r) => String(r.id));
      expect(ids).toContain(String(due));
      expect(ids).not.toContain(String(frozen));
    });
  });
});
