// Reviews aren't named as one of the 8 explicit rules, but 0045 tightened
// their INSERT policy as defense-in-depth alongside validate_review() (the
// same self-dealing-guard-at-both-layers pattern as offers/bids), so it's
// covered here for completeness.
import { describe, it, expect, afterAll } from "vitest";
import { pool, withRole, setIdentity, expectRejected, expectZeroRows, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

describe("reviews: SELECT (public reputation info)", () => {
  it("anon can read reviews (none exist yet in fixtures, but the policy itself is public)", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select 1 from public.reviews limit 1");
      expect(r.rowCount).toBe(0); // no fixture reviews seeded — asserts no permission error, not content
    });
  });
});

describe("reviews: INSERT (only a participant of a completed order, about the other participant)", () => {
  it("the buyer of the completed order can review the seller", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query(
        "insert into public.reviews (order_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 5)",
        [ids.orderId, USERS.buyer1, USERS.seller1],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("the seller of the completed order can review the buyer", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query(
        "insert into public.reviews (order_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 4)",
        [ids.orderId, USERS.seller1, USERS.buyer1],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("an unrelated user cannot review an order they weren't party to", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await expectRejected(
        c.query("insert into public.reviews (order_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 5)", [
          ids.orderId,
          USERS.buyer2,
          USERS.seller1,
        ]),
      );
    });
  });

  it("cannot mis-pair reviewer/reviewee (claiming to be the buyer while reviewing the buyer)", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("insert into public.reviews (order_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 5)", [
          ids.orderId,
          USERS.buyer1,
          USERS.buyer1,
        ]),
      );
    });
  });

  it("cannot review an order that hasn't completed yet", async () => {
    // orders has no client-writable INSERT path at all (0019), and the
    // pending order this needs must be visible in the SAME transaction as
    // the review attempt (withRole's always-rollback means it can't persist
    // across two separate calls) — so this one test drives the connection by
    // hand: create the order as service_role (mirroring respondToOffer()),
    // then switch the same connection to authenticated/buyer1 and confirm
    // validate_review()'s "order is not completed yet" guard fires.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      const { rows } = await client.query<{ id: string }>(
        `insert into public.orders (
           buyer_id, seller_id, listing_title, listing_category, listing_condition,
           amount_eur, platform_fee_eur, total_eur, status
         ) values ($1, $2, 'Pending sale', 'irons', 'good', 50, 2.5, 52.5, 'pending')
         returning id`,
        [USERS.buyer1, USERS.seller1],
      );
      const pendingOrderId = rows[0].id;

      await client.query("set local role authenticated");
      await setIdentity(client, USERS.buyer1);
      await expectRejected(
        client.query("insert into public.reviews (order_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 5)", [
          pendingOrderId,
          USERS.buyer1,
          USERS.seller1,
        ]),
        /not completed yet/,
      );
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  });

  it("anon cannot insert a review", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("insert into public.reviews (order_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 5)", [
          ids.orderId,
          USERS.buyer1,
          USERS.seller1,
        ]),
      );
    });
  });
});

describe("reviews: UPDATE/DELETE (only the reviewer)", () => {
  it("the reviewer can update or delete their own review; nobody else can", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.reviews (order_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 3) returning id",
        [ids.orderId, USERS.buyer1, USERS.seller1],
      );
      const reviewId = rows[0].id;

      const ownUpdate = await c.query("update public.reviews set rating = 4 where id = $1", [reviewId]);
      expect(ownUpdate.rowCount).toBe(1);

      await setIdentity(c, USERS.seller1);
      const otherUpdate = await c.query("update public.reviews set rating = 1 where id = $1", [reviewId]);
      expectZeroRows(otherUpdate);
      const otherDelete = await c.query("delete from public.reviews where id = $1", [reviewId]);
      expectZeroRows(otherDelete);
    });
  });
});
