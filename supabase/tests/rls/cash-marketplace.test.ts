// 0160_cash_marketplace.sql — the used marketplace without payments:
// messaging a seller about a listing, marking it sold to a named buyer, and
// two-way feedback that stays hidden until both sides have spoken.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, expectRejected as expectRejectedRaw, setIdentity, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

/** A rejection inside a longer transaction: under a savepoint, so the
 *  transaction carries on afterwards. Plain promises (not a client) pass
 *  straight through to the harness's version. */
function expectRejected(promise: Promise<unknown>, pattern?: RegExp): Promise<void> {
  return expectRejectedRaw(promise, pattern);
}
async function rejects(c: PoolClient, sql: string, params: unknown[], pattern?: RegExp): Promise<void> {
  await c.query("savepoint attempt");
  await expectRejectedRaw(c.query(sql, params), pattern);
  await c.query("rollback to savepoint attempt");
}

afterAll(closePool);

describe("marketplace_settings", () => {
  it("anyone can read the switch, and payments start off", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select public.marketplace_payments_enabled() as on");
      expect(r.rows[0].on).toBe(false);
    });
  });

  it("members cannot flip it", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(c.query("update public.marketplace_settings set payments_enabled = true"));
    });
  });
});

describe("messaging a seller about their listing", () => {
  it("a stranger can start a thread with the seller about an on-sale listing", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const [a, b] = [USERS.buyer2, USERS.seller2].sort();
      const r = await c.query(
        "insert into public.conversations (user_a_id, user_b_id, listing_id) values ($1, $2, $3) returning id",
        [a, b, ids.listings.seller2Active],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("but not about a listing that isn't on sale", async () => {
    await withRole("authenticated", USERS.seller2, async (c) => {
      await c.query("update public.listings set status = 'removed' where id = $1", [ids.listings.seller2Active]);
      await setIdentity(c, USERS.buyer2);
      const [a, b] = [USERS.buyer2, USERS.seller2].sort();
      await expectRejected(
        c.query("insert into public.conversations (user_a_id, user_b_id, listing_id) values ($1, $2, $3)", [a, b, ids.listings.seller2Active]),
      );
    });
  });

  it("and not a plain thread with no listing, as before", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const [a, b] = [USERS.buyer2, USERS.seller2].sort();
      await expectRejected(
        c.query("insert into public.conversations (user_a_id, user_b_id, listing_id) values ($1, $2, null)", [a, b]),
      );
    });
  });

  it("nor about someone else's listing with a third member", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const [a, b] = [USERS.buyer2, USERS.buyer1].sort();
      await expectRejected(
        c.query("insert into public.conversations (user_a_id, user_b_id, listing_id) values ($1, $2, $3)", [a, b, ids.listings.active]),
      );
    });
  });
});

describe("mark_listing_sold", () => {
  it("only the seller can mark it sold", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(c.query("select public.mark_listing_sold($1, null, null)", [ids.listings.active]), /couldn't be found/);
    });
  });

  it("the buyer has to be someone the seller has messaged", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(c.query("select public.mark_listing_sold($1, $2, null)", [ids.listings.active, USERS.buyer2]), /messaged/);
    });
  });

  it("offers the people the seller has talked to, this listing's first", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("select member_id, about_listing from public.marketplace_possible_buyers($1)", [ids.listings.active]);
      expect(r.rows.map((x) => x.member_id)).toContain(USERS.buyer1);
      expect(r.rows.find((x) => x.member_id === USERS.buyer1)?.about_listing).toBe(true);
    });
  });

  it("nobody else can see who a seller has talked to", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const r = await c.query("select * from public.marketplace_possible_buyers($1)", [ids.listings.active]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("selling to a named buyer: listing sold, sale recorded, buyer told, buyer can see the listing", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const sale = await c.query("select public.mark_listing_sold($1, $2, 17000) as id", [ids.listings.active, USERS.buyer1]);
      const saleId = sale.rows[0].id;

      const listing = await c.query("select status from public.listings where id = $1", [ids.listings.active]);
      expect(listing.rows[0].status).toBe("sold");

      await setIdentity(c, USERS.buyer1);
      const mine = await c.query("select buyer_id, final_price_cents from public.marketplace_sales where id = $1", [saleId]);
      expect(mine.rows[0].buyer_id).toBe(USERS.buyer1);
      const seen = await c.query("select id from public.listings where id = $1", [ids.listings.active]);
      expect(seen.rowCount).toBe(1);
      const note = await c.query("select data from public.notifications where user_id = $1 and type = 'marketplace_feedback_due'", [USERS.buyer1]);
      expect(note.rowCount).toBe(1);
      expect(note.rows[0].data.href).toBe(`/marketplace/feedback/${saleId}`);

      await setIdentity(c, USERS.buyer2);
      const other = await c.query("select id from public.marketplace_sales where id = $1", [saleId]);
      expect(other.rowCount).toBe(0);
    });
  });

  it("can't be marked sold twice", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query("select public.mark_listing_sold($1, null, null)", [ids.listings.active]);
      await rejects(c, "select public.mark_listing_sold($1, null, null)", [ids.listings.active], /on sale/);
    });
  });

  it("members can't write sales directly", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("insert into public.marketplace_sales (listing_id, seller_id) values ($1, $2)", [ids.listings.active, USERS.seller1]),
      );
    });
  });
});

describe("feedback", () => {
  async function soldToBuyer1(c: import("pg").PoolClient): Promise<string> {
    await setIdentity(c, USERS.seller1);
    const r = await c.query("select public.mark_listing_sold($1, $2, null) as id", [ids.listings.active, USERS.buyer1]);
    return r.rows[0].id;
  }

  it("stays hidden until both sides have left theirs, then counts", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const saleId = await soldToBuyer1(c);

      await setIdentity(c, USERS.buyer1);
      await c.query("select public.leave_marketplace_feedback($1, true, array['as_described','on_time'], 'Met at the club, spot on.')", [saleId]);

      // The seller is told, but can't read it yet — not directly, not through the public read.
      await setIdentity(c, USERS.seller1);
      const direct = await c.query("select id from public.marketplace_feedback where sale_id = $1", [saleId]);
      expect(direct.rowCount).toBe(0);
      const early = await c.query("select * from public.marketplace_member_feedback($1)", [USERS.seller1]);
      expect(early.rowCount).toBe(0);
      const told = await c.query("select id from public.notifications where user_id = $1 and type = 'marketplace_feedback_received'", [USERS.seller1]);
      expect(told.rowCount).toBe(1);

      await c.query("select public.leave_marketplace_feedback($1, true, array['paid_promptly'], null)", [saleId]);

      const revealed = await c.query("select reviewer_name, body, reviewee_role from public.marketplace_member_feedback($1)", [USERS.seller1]);
      expect(revealed.rowCount).toBe(1);
      expect(revealed.rows[0].reviewee_role).toBe("seller");
      expect(revealed.rows[0].body).toBe("Met at the club, spot on.");

      const stats = await c.query("select positive, negative, sales, tag_counts from public.marketplace_member_stats($1)", [USERS.seller1]);
      expect(stats.rows[0].positive).toBe(1);
      expect(stats.rows[0].negative).toBe(0);
      expect(stats.rows[0].sales).toBeGreaterThanOrEqual(1);
      expect(stats.rows[0].tag_counts.as_described).toBe(1);
    });
  });

  it("only the seller and the named buyer can leave it, once each", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const saleId = await soldToBuyer1(c);
      await setIdentity(c, USERS.buyer2);
      await rejects(c, "select public.leave_marketplace_feedback($1, true, '{}', null)", [saleId], /couldn't be found/);
      await setIdentity(c, USERS.buyer1);
      await c.query("select public.leave_marketplace_feedback($1, false, '{}', null)", [saleId]);
      await rejects(c, "select public.leave_marketplace_feedback($1, true, '{}', null)", [saleId], /already/);
    });
  });

  it("rejects tags it doesn't know", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const saleId = await soldToBuyer1(c);
      await setIdentity(c, USERS.buyer1);
      await expectRejected(c.query("select public.leave_marketplace_feedback($1, true, array['brilliant'], null)", [saleId]));
    });
  });

  it("members can't write feedback directly", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const saleId = await soldToBuyer1(c);
      await setIdentity(c, USERS.buyer1);
      await expectRejected(
        c.query(
          "insert into public.marketplace_feedback (sale_id, reviewer_id, reviewee_id, reviewee_role, positive) values ($1, $2, $3, 'seller', true)",
          [saleId, USERS.buyer1, USERS.seller1],
        ),
      );
    });
  });

  it("a week on, one side's feedback shows without the other's", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const saleId = await soldToBuyer1(c);
      await setIdentity(c, USERS.buyer1);
      await c.query("select public.leave_marketplace_feedback($1, true, '{}', null)", [saleId]);
      // Age the sale as the table owner would; members can't.
      await c.query("reset role");
      await c.query("update public.marketplace_sales set created_at = now() - interval '8 days' where id = $1", [saleId]);
      await c.query("set local role anon");
      const r = await c.query("select id from public.marketplace_member_feedback($1)", [USERS.seller1]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("the named buyer can say it wasn't them: feedback withdrawn and closed", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const saleId = await soldToBuyer1(c);
      await c.query("select public.leave_marketplace_feedback($1, false, '{}', null)", [saleId]);
      await setIdentity(c, USERS.buyer1);
      await c.query("select public.decline_marketplace_sale($1)", [saleId]);
      await setIdentity(c, USERS.seller1);
      const left = await c.query("select id from public.marketplace_feedback where sale_id = $1", [saleId]);
      expect(left.rowCount).toBe(0);
      await expectRejected(c.query("select public.leave_marketplace_feedback($1, true, '{}', null)", [saleId]), /isn't open/);
    });
  });

  it("sold somewhere else: nobody to give feedback to", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("select public.mark_listing_sold($1, null, null) as id", [ids.listings.active]);
      await expectRejected(c.query("select public.leave_marketplace_feedback($1, true, '{}', null)", [r.rows[0].id]), /isn't open/);
    });
  });

  it("the sale summary is for the two of them only", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const saleId = await soldToBuyer1(c);
      const mine = await c.query("select my_role, other_id from public.marketplace_sale_summary($1)", [saleId]);
      expect(mine.rows[0]).toMatchObject({ my_role: "seller", other_id: USERS.buyer1 });
      await setIdentity(c, USERS.buyer1);
      const theirs = await c.query("select my_role, other_id, they_left from public.marketplace_sale_summary($1)", [saleId]);
      expect(theirs.rows[0]).toMatchObject({ my_role: "buyer", other_id: USERS.seller1, they_left: false });
      await setIdentity(c, USERS.buyer2);
      const nobody = await c.query("select * from public.marketplace_sale_summary($1)", [saleId]);
      expect(nobody.rowCount).toBe(0);
    });
  });
});
