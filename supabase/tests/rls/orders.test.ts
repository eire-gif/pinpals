// Rule 5 ("Buyers and sellers may read only orders in which they
// participate") plus rule 7's boundary as it touches `orders` itself (the
// buyer/seller's own transaction is not "payment/payout internals").
import { describe, it, expect, afterAll } from "vitest";
import { withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

describe("orders: SELECT (rule 5)", () => {
  it("the buyer can read their own order", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select id from public.orders where id = $1", [ids.orderId]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("the seller can read their own order", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("select id from public.orders where id = $1", [ids.orderId]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("an unrelated user cannot read someone else's order", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const r = await c.query("select id from public.orders where id = $1", [ids.orderId]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("anon cannot read any order", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.orders where id = $1", [ids.orderId]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("staff (moderator or admin) can read any order — gated further at the app layer, not RLS", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const r = await c.query("select id from public.orders where id = $1", [ids.orderId]);
      expect(r.rowCount).toBe(1);
    });
    await withRole("authenticated", USERS.admin, async (c) => {
      const r = await c.query("select id from public.orders where id = $1", [ids.orderId]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("a disabled staff member has no staff read bypass", async () => {
    await withRole("authenticated", USERS.disabledStaff, async (c) => {
      const r = await c.query("select id from public.orders where id = $1", [ids.orderId]);
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("orders: INSERT/UPDATE/DELETE (no client-writable path — service-role only)", () => {
  it("neither the buyer nor the seller can insert an order directly", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      // orders explicitly revokes insert/update/delete table-level from
      // anon/authenticated (0019) — order creation only ever happens via
      // respondToOffer()'s service-role client.
      await expectRejected(
        c.query(
          `insert into public.orders (
             buyer_id, seller_id, listing_title, listing_category, listing_condition,
             amount_eur, platform_fee_eur, total_eur
           ) values ($1, $2, 'x', 'Irons', 'good', 10, 1, 11)`,
          [USERS.buyer1, USERS.seller1],
        ),
        /permission denied/,
      );
    });
  });

  it("the buyer cannot update their own order", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("update public.orders set status = 'cancelled' where id = $1", [ids.orderId]),
        /permission denied/,
      );
    });
  });

  it("staff cannot write to orders directly either — every mutation goes through service-role functions", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      await expectRejected(
        c.query("update public.orders set status = 'cancelled' where id = $1", [ids.orderId]),
        /permission denied/,
      );
    });
  });

  it("the service-role path can update an order (what respondToOffer()/webhooks actually use)", async () => {
    await withRole("service_role", null, async (c) => {
      const r = await c.query("update public.orders set payout_status = 'held' where id = $1", [ids.orderId]);
      expect(r.rowCount).toBe(1);
    });
  });
});
