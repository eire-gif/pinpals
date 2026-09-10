// Rule 3 ("Buyers may read only their own private offers; sellers may read
// offers on their listings") plus the self-dealing guard 0044 hardened, plus
// (0048) the full private-offer negotiation workflow: creation is validated
// by a trigger (still an ordinary authenticated INSERT through RLS, like
// bids), but every status transition — accept/decline/counter/withdraw —
// goes through offer_action(), a SECURITY DEFINER function callable only via
// service_role (never directly by a buyer/seller's own session), so this
// file also covers offer_action() as the sole write path.
import { describe, it, expect, afterAll } from "vitest";
import { withRole, expectRejected, expectZeroRows, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

describe("offers: SELECT (rule 3)", () => {
  it("the buyer can read their own offer", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select id from public.offers where id = $1", [ids.offers.pendingOnActive]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("the seller of the listing can read an offer made on it", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("select id from public.offers where id = $1", [ids.offers.pendingOnActive]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("an unrelated user cannot read someone else's offer", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const r = await c.query("select id from public.offers where id = $1", [ids.offers.pendingOnActive]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("anon cannot read any offer", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.offers where id = $1", [ids.offers.pendingOnActive]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("staff have no special offers-read bypass (not required by the task, scope kept narrow)", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const r = await c.query("select id from public.offers where id = $1", [ids.offers.pendingOnActive]);
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("offers: INSERT (buyers create offers on others' active offers_allowed listings only)", () => {
  it("a buyer can make an offer below asking price on someone else's offers_allowed listing", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const r = await c.query(
        "insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 90)",
        [ids.listings.active, USERS.buyer2],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("the trigger stamps original_amount_eur/expires_at/status regardless of what the client tried to set", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const { rows } = await c.query(
        `insert into public.offers (listing_id, buyer_id, amount_eur, status, original_amount_eur)
         values ($1, $2, 90, 'accepted', 1)
         returning status, original_amount_eur, amount_eur, expires_at > now() as expires_in_future`,
        [ids.listings.active, USERS.buyer2],
      );
      expect(rows[0]).toMatchObject({ status: "pending", original_amount_eur: "90.00", expires_in_future: true });
    });
  });

  it("a seller cannot make an offer on their own listing (self-dealing, RLS layer)", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 90)", [
          ids.listings.active,
          USERS.seller1,
        ]),
      );
    });
  });

  it("a seller cannot make an offer on their own listing even via a service-role/direct write (trigger layer)", async () => {
    // The whole point of 0044's prevent_offer_self_dealing() trigger: it
    // fires for every INSERT regardless of role, closing the gap the RLS
    // policy alone leaves open for a service-role/superuser connection. Runs
    // independently of 0048's own privileged-caller bypass (which only
    // skips amount/status/expiry validation, never the self-dealing check).
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 90)", [
          ids.listings.active,
          USERS.seller1,
        ]),
        /cannot make offers on their own listing/,
      );
    });
  });

  it("cannot make an offer under someone else's buyer_id", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 90)", [
          ids.listings.seller2Active,
          USERS.buyer2,
        ]),
      );
    });
  });

  it("anon cannot make an offer", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 90)", [
          ids.listings.active,
          USERS.buyer1,
        ]),
      );
    });
  });

  it("rejects an offer on a listing that isn't offers_allowed (RLS policy)", async () => {
    // seller2Active is fixed_price by default in the fixture.
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 90)", [
          ids.listings.seller2Active,
          USERS.buyer1,
        ]),
      );
    });
  });

  it("rejects an offer at or above the listing's asking price (trigger — server-defined limit)", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await expectRejected(
        c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 120)", [
          ids.listings.active,
          USERS.buyer2,
        ]),
        /less than the asking price/,
      );
    });
  });

  it("rejects an offer below the minimum amount (trigger — server-defined limit)", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await expectRejected(
        c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 0.50)", [
          ids.listings.active,
          USERS.buyer2,
        ]),
        /at least EUR 1/,
      );
    });
  });

  it("a second active offer from the same buyer on the same listing is rejected (one active chain — unique index)", async () => {
    // buyer1 already has ids.offers.pendingOnActive open on listings.active.
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 95)", [
          ids.listings.active,
          USERS.buyer1,
        ]),
        /duplicate key value violates unique constraint/,
      );
    });
  });
});

describe("offers: UPDATE (no direct client path — everything goes through offer_action())", () => {
  it("the seller cannot update an offer on their listing directly", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("update public.offers set status = 'declined' where id = $1", [ids.offers.pendingOnActive]),
        /permission denied/,
      );
    });
  });

  it("the buyer cannot update their own offer directly", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("update public.offers set status = 'withdrawn' where id = $1", [ids.offers.pendingOnActive]),
        /permission denied/,
      );
    });
  });
});

describe("offers: DELETE (no client role has a delete path)", () => {
  it("neither the buyer nor the seller can delete an offer", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("delete from public.offers where id = $1", [ids.offers.pendingOnActive]);
      expectZeroRows(r);
    });
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("delete from public.offers where id = $1", [ids.offers.pendingOnActive]);
      expectZeroRows(r);
    });
  });
});

describe("offer_action(): not callable directly by buyer/seller sessions", () => {
  it("an authenticated user cannot call offer_action() themselves", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'decline')", [
          ids.offers.pendingOnActive,
          USERS.seller1,
        ]),
        /permission denied for function/,
      );
    });
  });

  it("anon cannot call offer_action()", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'decline')", [
          ids.offers.pendingOnActive,
          USERS.seller1,
        ]),
        /permission denied for function/,
      );
    });
  });
});

describe("offer_action(): seller responds to a pending offer", () => {
  it("the seller can decline a pending offer", async () => {
    await withRole("service_role", null, async (c) => {
      const { rows } = await c.query("select * from public.offer_action($1, $2, 'decline')", [
        ids.offers.pendingOnActive,
        USERS.seller1,
      ]);
      expect(rows[0].status).toBe("declined");
    });
  });

  it("the buyer cannot decline their own pending offer as if they were the seller", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'decline')", [ids.offers.pendingOnActive, USERS.buyer1]),
        /Only the seller can respond/,
      );
    });
  });

  it("an unrelated user gets a clear rejection, not a silent no-op", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'decline')", [ids.offers.pendingOnActive, USERS.buyer2]),
        /not a party to this offer/,
      );
    });
  });

  it("the seller can counter a pending offer — status becomes 'countered' and amount_eur becomes the counter", async () => {
    await withRole("service_role", null, async (c) => {
      const { rows } = await c.query(
        "select * from public.offer_action($1, $2, 'counter', $3) as offer",
        [ids.offers.pendingOnActive, USERS.seller1, 11000],
      );
      expect(rows[0].status).toBe("countered");
      expect(rows[0].amount_eur).toBe("110.00");
      expect(rows[0].original_amount_eur).toBe("100.00");
    });
  });

  it("a counter at or below the current offer is rejected", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'counter', $3)", [
          ids.offers.pendingOnActive,
          USERS.seller1,
          10000,
        ]),
        /must be higher than the current offer/,
      );
    });
  });

  it("a counter above the asking price is rejected", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'counter', $3)", [
          ids.offers.pendingOnActive,
          USERS.seller1,
          12500,
        ]),
        /cannot exceed the asking price/,
      );
    });
  });

  it("the buyer cannot counter their own pending offer", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'counter', $3)", [
          ids.offers.pendingOnActive,
          USERS.buyer1,
          11000,
        ]),
        /Only the seller can respond/,
      );
    });
  });
});

describe("offer_action(): accepting a pending offer is transactional", () => {
  it("accepting reserves the listing, snapshots an order, and declines competing offers", async () => {
    await withRole("service_role", null, async (c) => {
      // A second, competing offer on the same listing from buyer2, seeded
      // fresh (bypasses trigger validation as service_role — see
      // fixtures.ts's own offers for the same reasoning).
      const { rows: competing } = await c.query(
        `insert into public.offers (listing_id, buyer_id, amount_eur, original_amount_eur, status, expires_at)
         values ($1, $2, 95, 95, 'pending', now() + interval '1 day')
         returning id`,
        [ids.listings.active, USERS.buyer2],
      );

      const { rows } = await c.query("select * from public.offer_action($1, $2, 'accept')", [
        ids.offers.pendingOnActive,
        USERS.seller1,
      ]);
      expect(rows[0].status).toBe("accepted");

      const listing = await c.query("select status from public.listings where id = $1", [ids.listings.active]);
      expect(listing.rows[0].status).toBe("reserved");

      const order = await c.query(
        "select buyer_id, seller_id, amount_eur, total_eur, reservation_expires_at > now() as window_open from public.orders where offer_id = $1",
        [ids.offers.pendingOnActive],
      );
      expect(order.rowCount).toBe(1);
      expect(order.rows[0]).toMatchObject({ buyer_id: USERS.buyer1, seller_id: USERS.seller1, amount_eur: "100.00", window_open: true });

      const competingAfter = await c.query("select status from public.offers where id = $1", [competing[0].id]);
      expect(competingAfter.rows[0].status).toBe("declined");
    });
  });

  it("cannot accept an offer whose listing is no longer active", async () => {
    await withRole("service_role", null, async (c) => {
      const { rows: freshListing } = await c.query<{ id: string }>(
        `insert into public.listings (seller_id, title, description, price_eur, price_cents, category, condition, county, status, sale_type)
         values ($1, 'Race fixture listing', 'x', 100, 10000, 'Irons', 'good', 'Kerry', 'active', 'offers_allowed')
         returning id`,
        [USERS.seller1],
      );
      const { rows: freshOffer } = await c.query<{ id: string }>(
        `insert into public.offers (listing_id, buyer_id, amount_eur, original_amount_eur, status, expires_at)
         values ($1, $2, 80, 80, 'pending', now() + interval '1 day')
         returning id`,
        [freshListing[0].id, USERS.buyer1],
      );
      await c.query("update public.listings set status = 'removed' where id = $1", [freshListing[0].id]);

      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'accept')", [freshOffer[0].id, USERS.seller1]),
        /no longer available/,
      );
    });
  });

  it("cannot accept an offer past its own expiry, even before the sweep has caught up", async () => {
    await withRole("service_role", null, async (c) => {
      const { rows: freshOffer } = await c.query<{ id: string }>(
        `insert into public.offers (listing_id, buyer_id, amount_eur, original_amount_eur, status, expires_at)
         values ($1, $2, 80, 80, 'pending', now() - interval '1 hour')
         returning id`,
        [ids.listings.active, USERS.buyer2],
      );

      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'accept')", [freshOffer[0].id, USERS.seller1]),
        /has expired/,
      );
    });
  });
});

describe("offer_action(): buyer responds to a countered offer", () => {
  it("the buyer can accept a counter, which is transactional the same way", async () => {
    await withRole("service_role", null, async (c) => {
      const { rows: countered } = await c.query(
        "select * from public.offer_action($1, $2, 'counter', $3)",
        [ids.offers.pendingOnActive, USERS.seller1, 11500],
      );
      expect(countered[0].status).toBe("countered");

      const { rows: accepted } = await c.query("select * from public.offer_action($1, $2, 'accept')", [
        ids.offers.pendingOnActive,
        USERS.buyer1,
      ]);
      expect(accepted[0].status).toBe("accepted");

      const order = await c.query("select amount_eur from public.orders where offer_id = $1", [
        ids.offers.pendingOnActive,
      ]);
      expect(order.rows[0].amount_eur).toBe("115.00");
    });
  });

  it("the seller cannot accept their own counter as if they were the buyer", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query("select * from public.offer_action($1, $2, 'counter', $3)", [
        ids.offers.pendingOnActive,
        USERS.seller1,
        11500,
      ]);
      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'accept')", [ids.offers.pendingOnActive, USERS.seller1]),
        /Only the buyer can respond/,
      );
    });
  });

  it("the buyer can decline a counter", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query("select * from public.offer_action($1, $2, 'counter', $3)", [
        ids.offers.pendingOnActive,
        USERS.seller1,
        11500,
      ]);
      const { rows } = await c.query("select * from public.offer_action($1, $2, 'decline')", [
        ids.offers.pendingOnActive,
        USERS.buyer1,
      ]);
      expect(rows[0].status).toBe("declined");
    });
  });

  it("the buyer cannot re-counter a counter", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query("select * from public.offer_action($1, $2, 'counter', $3)", [
        ids.offers.pendingOnActive,
        USERS.seller1,
        11500,
      ]);
      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'counter', $3)", [
          ids.offers.pendingOnActive,
          USERS.buyer1,
          11800,
        ]),
        /Only the seller can counter/,
      );
    });
  });
});

describe("offer_action(): withdraw", () => {
  it("the buyer can withdraw a pending offer", async () => {
    await withRole("service_role", null, async (c) => {
      const { rows } = await c.query("select * from public.offer_action($1, $2, 'withdraw')", [
        ids.offers.pendingOnActive,
        USERS.buyer1,
      ]);
      expect(rows[0].status).toBe("withdrawn");
    });
  });

  it("the seller cannot withdraw a buyer's offer", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'withdraw')", [
          ids.offers.pendingOnActive,
          USERS.seller1,
        ]),
        /Only the buyer can withdraw/,
      );
    });
  });

  it("a countered offer can no longer be withdrawn (only accept/decline apply once it's the buyer's turn)", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query("select * from public.offer_action($1, $2, 'counter', $3)", [
        ids.offers.pendingOnActive,
        USERS.seller1,
        11500,
      ]);
      await expectRejected(
        c.query("select * from public.offer_action($1, $2, 'withdraw')", [
          ids.offers.pendingOnActive,
          USERS.buyer1,
        ]),
        /Only a pending offer can be withdrawn/,
      );
    });
  });
});

describe("offer_action(): notifications are written for the right party only", () => {
  it("declining a pending offer notifies the buyer, not any other user", async () => {
    await withRole("service_role", null, async (c) => {
      // Scoped by a captured cutoff, not a bare "did the count go up by
      // one" — other test files in this suite (offer-workflow-race.test.ts
      // in particular) genuinely commit their own offer_declined
      // notifications for these same fixture users, since that file
      // exercises real cross-transaction locking and can't use this
      // harness's always-rollback withRole() for its setup steps.
      const { rows: cutoffRows } = await c.query<{ now: string }>("select now() as now");
      const cutoff = cutoffRows[0].now;

      await c.query("select * from public.offer_action($1, $2, 'decline')", [
        ids.offers.pendingOnActive,
        USERS.seller1,
      ]);
      const after = await c.query(
        "select count(*)::int from public.notifications where user_id = $1 and type = 'offer_declined' and created_at >= $2",
        [USERS.buyer1, cutoff],
      );
      expect(after.rows[0].count).toBe(1);

      const otherBuyer = await c.query(
        "select count(*)::int from public.notifications where user_id = $1 and type = 'offer_declined' and created_at >= $2",
        [USERS.buyer2, cutoff],
      );
      expect(otherBuyer.rows[0].count).toBe(0);
    });
  });
});
