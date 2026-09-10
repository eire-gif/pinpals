// Genuine concurrency + the two lazy-sweep/invalidation mechanisms from
// 0048_marketplace_offer_workflow.sql that don't fit harness.ts's
// always-rollback withRole() pattern, because the whole point is exercising
// real lock contention between two transactions that both actually commit —
// each one on its own connection, each committing (or rolling back) on its
// own, exactly like two independent concurrent Server Action requests would.
//
// Every row this file creates is its own throwaway fixture (never the
// shared global-setup.ts seed), deleted again at the end of each test —
// global-setup.ts only seeds once for the whole run, so a committed leftover
// here would otherwise leak into every test file that runs after this one.
import { describe, it, expect, afterAll } from "vitest";
import { pool, withRole, closePool } from "./harness";
import { USERS } from "./fixtures";
import type { PoolClient } from "pg";

afterAll(closePool);

/** Runs `fn` inside its own begin/commit (rollback on throw) on a fresh
 * connection — deliberately NOT the harness's always-rollback withRole():
 * two calls to this, fired together via Promise.allSettled, behave like two
 * independent concurrent requests that each commit as soon as their own
 * work finishes, which is what actually lets one unblock the other's row
 * lock rather than both waiting on each other forever. */
async function runAsTx<T>(
  role: "authenticated" | "service_role",
  userId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    await client.query(`set local role ${role}`);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function freshListing(sellerId: string, priceEur = 200): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.listings
       (seller_id, title, description, price_eur, price_cents, category, condition, county, status, sale_type)
     values ($1, 'Race fixture listing', 'x', $2, $3, 'Irons', 'good', 'Kerry', 'active', 'offers_allowed')
     returning id`,
    [sellerId, priceEur, Math.round(priceEur * 100)],
  );
  return rows[0].id;
}

async function freshOffer(listingId: string, buyerId: string, amountEur: number): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.offers (listing_id, buyer_id, amount_eur, original_amount_eur, status, expires_at)
     values ($1, $2, $3, $3, 'pending', now() + interval '1 day')
     returning id`,
    [listingId, buyerId, amountEur],
  );
  return rows[0].id;
}

async function dropListing(listingId: string) {
  // Notifications aren't FK-linked to a listing/offer (by design — they
  // outlive whatever they're about), so the cascade-delete below doesn't
  // reach them. This file is the only one whose fixtures use this exact
  // title, so cleaning up by it is safe and keeps this file's genuinely
  // committed writes from lingering in the shared local test DB for good.
  await pool.query("delete from public.notifications where body like '%Race fixture listing%'");
  await pool.query("delete from public.listings where id = $1", [listingId]);
}

/** Calls offer_action() as the postgres superuser (auto-commits, unlike
 * withRole() which always rolls back) — for setup steps in a test where a
 * later, separate connection needs to actually observe the effect. Every
 * grant/revoke on offer_action() is irrelevant to a superuser anyway (a
 * REVOKE never applies to one), so this is a safe, direct way to get a real
 * committed accept/decline/counter/withdraw on the books. */
async function callOfferAction(
  offerId: string,
  callerId: string,
  action: "accept" | "decline" | "counter" | "withdraw",
  counterAmountCents: number | null = null,
) {
  return pool.query("select * from public.offer_action($1, $2, $3, $4)", [offerId, callerId, action, counterAmountCents]);
}

describe("race conditions: concurrent offer creation", () => {
  it("two concurrent create-offer attempts from the same buyer on the same listing: exactly one succeeds", async () => {
    const listingId = await freshListing(USERS.seller1);
    try {
      const insertOffer = () =>
        runAsTx("authenticated", USERS.buyer1, (c) =>
          c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 150) returning id", [
            listingId,
            USERS.buyer1,
          ]),
        );

      // Fired together, not one-at-a-time — both transactions are genuinely
      // in flight at once, so this exercises the unique index's real
      // concurrency handling rather than just "the second sequential
      // attempt sees the first's already-committed row".
      const outcomes = await Promise.allSettled([insertOffer(), insertOffer()]);

      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failure = outcomes.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(String(failure.reason)).toMatch(/duplicate key value violates unique constraint/);
    } finally {
      await dropListing(listingId);
    }
  });

  it("a second offer succeeds once the first is no longer active (declined) — not a permanent lock-out", async () => {
    const listingId = await freshListing(USERS.seller1);
    try {
      const firstOfferId = await freshOffer(listingId, USERS.buyer1, 150);
      await callOfferAction(firstOfferId, USERS.seller1, "decline");

      const result = await runAsTx("authenticated", USERS.buyer1, (c) =>
        c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 140) returning id", [
          listingId,
          USERS.buyer1,
        ]),
      );
      expect(result.rowCount).toBe(1);
    } finally {
      await dropListing(listingId);
    }
  });
});

describe("race conditions: concurrent acceptance of two different offers on the same listing", () => {
  it("exactly one accept succeeds; the other is rejected once it sees the now-reserved listing", async () => {
    const listingId = await freshListing(USERS.seller1);
    try {
      const offerA = await freshOffer(listingId, USERS.buyer1, 150);
      const offerB = await freshOffer(listingId, USERS.buyer2, 160);

      // offer_action() locks the LISTING before either offer row (see that
      // function's own header comment on why) — specifically so this can't
      // deadlock: whichever call reaches the listing lock first runs to
      // completion (including declining the other buyer's offer) and
      // commits before the second call ever proceeds past its own listing
      // lock.
      const outcomes = await Promise.allSettled([
        runAsTx("service_role", null, (c) =>
          c.query("select * from public.offer_action($1, $2, 'accept')", [offerA, USERS.seller1]),
        ),
        runAsTx("service_role", null, (c) =>
          c.query("select * from public.offer_action($1, $2, 'accept')", [offerB, USERS.seller1]),
        ),
      ]);

      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failure = outcomes.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(String(failure.reason)).toMatch(/no longer available|not in a state that allows/);

      const order = await pool.query("select count(*)::int from public.orders where listing_id = $1", [listingId]);
      expect(order.rows[0].count).toBe(1);
    } finally {
      await dropListing(listingId);
    }
  });
});

describe("expire_stale_offers(): the timer-based sweep", () => {
  it("flips a past-deadline pending offer to expired, and leaves a live one alone", async () => {
    const listingId = await freshListing(USERS.seller1);
    try {
      const staleOfferId = await freshOffer(listingId, USERS.buyer1, 150);
      const liveOfferId = await freshOffer(listingId, USERS.buyer2, 160);
      await pool.query("update public.offers set expires_at = now() - interval '1 hour' where id = $1", [
        staleOfferId,
      ]);

      await withRole("service_role", null, async (c) => {
        await c.query("select public.expire_stale_offers()");
        const stale = await c.query("select status from public.offers where id = $1", [staleOfferId]);
        expect(stale.rows[0].status).toBe("expired");
        const live = await c.query("select status from public.offers where id = $1", [liveOfferId]);
        expect(live.rows[0].status).toBe("pending");
      });
    } finally {
      await dropListing(listingId);
    }
  });

  it("neither anon nor an authenticated user can call the sweep directly", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expect(c.query("select public.expire_stale_offers()")).rejects.toThrow(/permission denied for function/);
    });
    await withRole("anon", null, async (c) => {
      await expect(c.query("select public.expire_stale_offers()")).rejects.toThrow(/permission denied for function/);
    });
  });
});

describe("release_expired_offer_reservations(): the checkout-window sweep", () => {
  it("cancels an order whose reservation window lapsed, and hands the listing back to active", async () => {
    const listingId = await freshListing(USERS.seller1);
    try {
      const offerId = await freshOffer(listingId, USERS.buyer1, 150);
      await callOfferAction(offerId, USERS.seller1, "accept");

      // Simulate the checkout window having already lapsed.
      await pool.query(
        `update public.orders set reservation_expires_at = now() - interval '1 minute' where offer_id = $1`,
        [offerId],
      );

      await withRole("service_role", null, async (c) => {
        await c.query("select public.release_expired_offer_reservations()");

        const order = await c.query("select status from public.orders where offer_id = $1", [offerId]);
        expect(order.rows[0].status).toBe("cancelled");

        const listing = await c.query("select status from public.listings where id = $1", [listingId]);
        expect(listing.rows[0].status).toBe("active");

        const notifiedBuyer = await c.query(
          "select count(*)::int from public.notifications where user_id = $1 and type = 'reservation_expired'",
          [USERS.buyer1],
        );
        expect(notifiedBuyer.rows[0].count).toBe(1);
      });
    } finally {
      await dropListing(listingId);
    }
  });

  it("never touches an order that already got paid, even if its window lapsed", async () => {
    const listingId = await freshListing(USERS.seller1);
    try {
      const offerId = await freshOffer(listingId, USERS.buyer1, 150);
      await callOfferAction(offerId, USERS.seller1, "accept");
      await pool.query(
        `update public.orders
           set payment_status = 'paid', reservation_expires_at = now() - interval '1 minute'
         where offer_id = $1`,
        [offerId],
      );

      await withRole("service_role", null, async (c) => {
        await c.query("select public.release_expired_offer_reservations()");
        const order = await c.query("select status, payment_status from public.orders where offer_id = $1", [
          offerId,
        ]);
        expect(order.rows[0]).toMatchObject({ status: "pending", payment_status: "paid" });

        const listing = await c.query("select status from public.listings where id = $1", [listingId]);
        expect(listing.rows[0].status).toBe("reserved");
      });
    } finally {
      await dropListing(listingId);
    }
  });
});

describe("listings trigger: dangling offers are invalidated when a listing leaves 'active'", () => {
  it("a pending offer on a listing that gets removed is auto-expired, with a notification", async () => {
    const listingId = await freshListing(USERS.seller1);
    try {
      const offerId = await freshOffer(listingId, USERS.buyer1, 150);

      await withRole("service_role", null, async (c) => {
        await c.query("update public.listings set status = 'removed' where id = $1", [listingId]);

        const offer = await c.query("select status from public.offers where id = $1", [offerId]);
        expect(offer.rows[0].status).toBe("expired");

        const notified = await c.query(
          "select count(*)::int from public.notifications where user_id = $1 and type = 'offer_invalidated'",
          [USERS.buyer1],
        );
        expect(notified.rows[0].count).toBe(1);
      });
    } finally {
      await dropListing(listingId);
    }
  });

  it("does not fire for a transition that isn't AWAY FROM active (old.status must be 'active')", async () => {
    // Seeded directly at 'reserved' (bypassing the creation trigger the same
    // way fixtures.ts/freshOffer() already do) so the only transition this
    // test makes is reserved -> sold — old.status is never 'active', so the
    // trigger's own guard condition should leave this offer untouched.
    const listingId = await freshListing(USERS.seller1);
    try {
      await pool.query("update public.listings set status = 'reserved' where id = $1", [listingId]);
      const offerId = await freshOffer(listingId, USERS.buyer1, 150);

      await withRole("service_role", null, async (c) => {
        await c.query("update public.listings set status = 'sold' where id = $1", [listingId]);

        const offer = await c.query("select status from public.offers where id = $1", [offerId]);
        expect(offer.rows[0].status).toBe("pending");
      });
    } finally {
      await dropListing(listingId);
    }
  });
});
