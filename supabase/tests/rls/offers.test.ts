// Rule 3 ("Buyers may read only their own private offers; sellers may read
// offers on their listings") plus the self-dealing guard 0044 hardened.
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

describe("offers: INSERT (buyers create offers on others' active listings only)", () => {
  it("a buyer can make an offer on someone else's active listing", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const r = await c.query(
        "insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 90)",
        [ids.listings.active, USERS.buyer2],
      );
      expect(r.rowCount).toBe(1);
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
    // policy alone leaves open for a service-role/superuser connection.
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
});

describe("offers: UPDATE (only the listing's seller may respond)", () => {
  it("the seller can update (respond to) an offer on their listing", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("update public.offers set status = 'declined' where id = $1", [
        ids.offers.pendingOnActive,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("the buyer cannot update their own offer (only the seller responds)", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("update public.offers set status = 'withdrawn' where id = $1", [
        ids.offers.pendingOnActive,
      ]);
      expectZeroRows(r);
    });
  });

  it("an unrelated user cannot update someone else's offer", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const r = await c.query("update public.offers set status = 'declined' where id = $1", [
        ids.offers.pendingOnActive,
      ]);
      expectZeroRows(r);
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
