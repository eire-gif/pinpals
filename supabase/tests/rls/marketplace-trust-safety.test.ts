// marketplace-trust-safety (0055_marketplace_trust_safety.sql) — covers the
// four genuinely new/changed RLS-relevant surfaces this migration adds:
// muted_users (owner-only CRUD, no cross-visibility needed), the
// block-aware offers INSERT policy + creation trigger, offer_action()'s new
// accept/counter block check, reports.target_type accepting 'order', and
// get_order_dispute_status()'s narrow buyer/seller-only visibility.
//
// Deliberately does NOT re-test everything messaging.test.ts's
// "blocked_users (0049)" describe block already covers (view/insert/delete
// your own block rows, is_blocked() symmetry) — that table and its RLS are
// unchanged by this migration.
import { describe, it, expect, afterAll } from "vitest";
import { withRole, setIdentity, expectRejected, expectZeroRows, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

describe("muted_users: owner-only CRUD, no symmetric visibility (unlike blocked_users)", () => {
  it("a member can mute another member", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const insert = await c.query("insert into public.muted_users (muter_id, muted_id) values ($1, $2)", [
        USERS.buyer2,
        USERS.seller2,
      ]);
      expect(insert.rowCount).toBe(1);
      const own = await c.query("select * from public.muted_users where muter_id = $1", [USERS.buyer2]);
      expect(own.rowCount).toBe(1);
    });
  });

  it("cannot mute yourself", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("insert into public.muted_users (muter_id, muted_id) values ($1, $1)", [USERS.buyer1]),
      );
    });
  });

  it("cannot insert a mute row on someone else's behalf", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("insert into public.muted_users (muter_id, muted_id) values ($1, $2)", [USERS.buyer2, USERS.seller1]),
      );
    });
  });

  it("the muted person cannot see that they've been muted (mute is private to the muter)", async () => {
    // One transaction, one connection — the row inserted here would be
    // rolled back (and so invisibly "gone" either way) if this used two
    // separate withRole() calls instead of setIdentity() mid-transaction.
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await c.query("insert into public.muted_users (muter_id, muted_id) values ($1, $2)", [
        USERS.buyer2,
        USERS.seller2,
      ]);

      await setIdentity(c, USERS.seller2);
      const asTarget = await c.query("select * from public.muted_users where muter_id = $1", [USERS.buyer2]);
      expectZeroRows(asTarget);
    });
  });

  it("a member can unmute (delete their own mute row)", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await c.query("insert into public.muted_users (muter_id, muted_id) values ($1, $2)", [
        USERS.buyer2,
        USERS.seller2,
      ]);
      const del = await c.query("delete from public.muted_users where muter_id = $1 and muted_id = $2", [
        USERS.buyer2,
        USERS.seller2,
      ]);
      expect(del.rowCount).toBe(1);
    });
  });

  it("anon cannot read, insert, or delete any mute row", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select * from public.muted_users");
      expectZeroRows(r);
      await expectRejected(
        c.query("insert into public.muted_users (muter_id, muted_id) values ($1, $2)", [USERS.buyer1, USERS.seller1]),
      );
    });
  });
});

describe("offers: block-aware INSERT (this migration's fix — 0048 predated blocking)", () => {
  it("a buyer can normally create an offer on an active, offers_allowed listing", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const insert = await c.query(
        "insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 50.00) returning id",
        [ids.listings.active, USERS.buyer2],
      );
      expect(insert.rowCount).toBe(1);
    });
  });

  it("a blocked buyer cannot create an offer on the blocking seller's listing", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [
        USERS.buyer2,
        USERS.seller1,
      ]);
      await expectRejected(
        c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 50.00)", [
          ids.listings.active,
          USERS.buyer2,
        ]),
        /blocked/,
      );
    });
  });

  it("blocking is symmetric here too — the SELLER blocking the buyer also prevents the buyer's offer", async () => {
    // One connection, one transaction — insert the block as seller1 (the
    // policy requires blocker_id = auth.uid()), then re-point identity to
    // buyer2 and attempt the offer, same setIdentity()-mid-transaction shape
    // messaging.test.ts's own cross-identity blocking test uses.
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [
        USERS.seller1,
        USERS.buyer2,
      ]);

      await setIdentity(c, USERS.buyer2);
      await expectRejected(
        c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 50.00)", [
          ids.listings.active,
          USERS.buyer2,
        ]),
        /blocked/,
      );
    });
  });
});

describe("offer_action(): accept/counter blocked between blocked parties, decline/withdraw still allowed", () => {
  // offer_action() is revoked from authenticated (0048) — only callable via
  // service_role, which also has BYPASSRLS, so the block row is inserted
  // through the same service_role connection rather than a separate
  // authenticated transaction (every withRole() call rolls back at the end,
  // so a block inserted in one call would never be visible to another).
  it("countering a pending offer fails once the seller has blocked the buyer", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [
        USERS.seller1,
        USERS.buyer1,
      ]);
      await expectRejected(
        c.query("select public.offer_action($1, $2, 'counter', 6000, 30)", [ids.offers.pendingOnActive, USERS.seller1]),
        /blocked/,
      );
    });
  });

  it("declining a pending offer still works even when blocked (closing out is always allowed)", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [
        USERS.seller1,
        USERS.buyer1,
      ]);
      const r = await c.query("select (public.offer_action($1, $2, 'decline', null, 30)).status as status", [
        ids.offers.pendingOnActive,
        USERS.seller1,
      ]);
      expect(r.rows[0].status).toBe("declined");
    });
  });
});

describe("reports.target_type accepts 'order' (this migration's fix)", () => {
  it("a service-role insert with target_type='order' succeeds", async () => {
    await withRole("service_role", null, async (c) => {
      const insert = await c.query(
        `insert into public.reports (reporter_id, target_type, target_id, category, description, status, wants_refund)
         values ($1, 'order', $2::text, 'item_not_received', 'Fixture order report', 'open', true)
         returning id, wants_refund`,
        [USERS.buyer1, ids.orderId],
      );
      expect(insert.rowCount).toBe(1);
      expect(insert.rows[0].wants_refund).toBe(true);
    });
  });

  it("an ordinary member still cannot insert a report directly (unchanged — service-role only)", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.reports (reporter_id, target_type, target_id, category)
           values ($1, 'order', $2::text, 'item_not_received')`,
          [USERS.buyer1, ids.orderId],
        ),
        /permission denied/,
      );
    });
  });
});

describe("get_order_dispute_status(): buyer/seller-only visibility into an otherwise staff-only table", () => {
  it("the order's buyer can see its dispute status", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select public.get_order_dispute_status($1) as status", [ids.orderId]);
      expect(r.rows[0].status).toBe("needs_response");
    });
  });

  it("the order's seller can see its dispute status", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("select public.get_order_dispute_status($1) as status", [ids.orderId]);
      expect(r.rows[0].status).toBe("needs_response");
    });
  });

  it("an unrelated member gets null, not the dispute's real status", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const r = await c.query("select public.get_order_dispute_status($1) as status", [ids.orderId]);
      expect(r.rows[0].status).toBeNull();
    });
  });

  it("anon cannot call this function at all (EXECUTE is revoked, not just RLS-empty)", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("select public.get_order_dispute_status($1) as status", [ids.orderId]),
        /permission denied/,
      );
    });
  });
});
