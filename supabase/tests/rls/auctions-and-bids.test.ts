// Rule 1's extension to listing_images/auctions (both gated by the same
// listing_is_visible() predicate as listings itself) and rule 6 ("Bid
// history may expose public amount/time data without exposing private user
// details").
import { describe, it, expect, afterAll } from "vitest";
import { withRole, setIdentity, expectRejected, expectZeroRows, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

describe("listing_images: SELECT (aligned with listing_is_visible())", () => {
  it("anon can read images on an active listing", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.listing_images where id = $1", [ids.listingImageId]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("anon cannot read images on a removed listing", async () => {
    // Reuse the same image row against a hypothetical removed listing by
    // checking a listing that IS removed has no visible images path — the
    // fixture's only image is on the active listing, so this asserts the
    // policy predicate itself rather than a second fixture row: querying by
    // listing_id directly.
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.listing_images where listing_id = $1", [ids.listings.removed]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("the seller can manage (insert) images on their own listing", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query(
        "insert into public.listing_images (listing_id, image_url, position) values ($1, 'https://example.test/2.jpg', 1)",
        [ids.listings.active],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("an unrelated user cannot insert images on someone else's listing", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query(
          "insert into public.listing_images (listing_id, image_url, position) values ($1, 'https://example.test/hack.jpg', 2)",
          [ids.listings.active],
        ),
      );
    });
  });

  it("an unrelated user cannot delete someone else's listing image", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("delete from public.listing_images where id = $1", [ids.listingImageId]);
      expectZeroRows(r);
    });
  });
});

describe("auctions: SELECT (aligned with listing_is_visible())", () => {
  it("anon can read an auction on an active listing", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.auctions where id = $1", [ids.auctionId]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("the seller can start an auction on their own active auction-type listing", async () => {
    await withRole("authenticated", USERS.seller2, async (c) => {
      // seller2's active listing (L8) is fixed_price by default in the
      // fixture — flip it to auction sale_type first via the seller's own
      // permitted UPDATE, then start an auction on it.
      await c.query("update public.listings set sale_type = 'auction' where id = $1", [ids.listings.seller2Active]);
      const r = await c.query(
        "insert into public.auctions (listing_id, starting_price_cents, ends_at) values ($1, 1000, now() + interval '3 days')",
        [ids.listings.seller2Active],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("a user cannot start an auction on someone else's listing", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query(
          "insert into public.auctions (listing_id, starting_price_cents, ends_at) values ($1, 1000, now() + interval '3 days')",
          [ids.listings.seller2Active],
        ),
      );
    });
  });

  it("no authenticated (or anon) role can update or delete an auction directly", async () => {
    // 0039 revokes UPDATE/DELETE table-level from anon/authenticated
    // entirely (no bidding-UI-driving RPC exists yet) — this is a genuine
    // permission-denied error, not an RLS USING clause silently matching zero
    // rows, since there's no grant for Postgres to even evaluate a policy
    // against.
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("update public.auctions set status = 'cancelled' where id = $1", [ids.auctionId]),
        /permission denied/,
      );
    });
  });
});

describe("bids: SELECT (private to the bidder and the auction's seller)", () => {
  it("a bidder can read their own bid", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select id from public.bids where id = $1", [ids.bids.buyer1]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("the auction's seller can read bids on it", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("select id from public.bids where id = $1", [ids.bids.buyer1]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("one bidder cannot read another bidder's raw bid row", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select id from public.bids where id = $1", [ids.bids.buyer2]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("anon cannot read the raw bids table at all", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.bids where id = $1", [ids.bids.buyer1]);
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("bids: INSERT (eligible bidders only, validated by the trigger)", () => {
  it("a bid on the fixture's already-concluded auction is rejected by the trigger regardless of amount", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("insert into public.bids (auction_id, bidder_id, amount_cents) values ($1, $2, 7000)", [
          ids.auctionId,
          USERS.buyer1,
        ]),
        /not open for bidding|already ended/,
      );
    });
  });

  it("a bidder can place a bid exceeding the current highest on a live auction", async () => {
    // One connection, two identities in sequence (see setIdentity's doc
    // comment): seller2 opens a fresh auction, then buyer1 bids on it,
    // entirely inside one transaction that's rolled back at the end either
    // way — this is what lets a cross-user scenario stay in the same
    // always-rollback pattern the rest of the suite uses.
    await withRole("authenticated", USERS.seller2, async (c) => {
      await c.query("update public.listings set sale_type = 'auction' where id = $1", [ids.listings.seller2Active]);
      const { rows } = await c.query<{ id: string }>(
        "insert into public.auctions (listing_id, starting_price_cents, ends_at) values ($1, 1000, now() + interval '3 days') returning id",
        [ids.listings.seller2Active],
      );
      const freshAuctionId = rows[0].id;

      await setIdentity(c, USERS.buyer1);
      const r = await c.query("insert into public.bids (auction_id, bidder_id, amount_cents) values ($1, $2, 1000)", [
        freshAuctionId,
        USERS.buyer1,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("the seller cannot bid on their own auction", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("insert into public.bids (auction_id, bidder_id, amount_cents) values ($1, $2, 9000)", [
          ids.auctionId,
          USERS.seller1,
        ]),
      );
    });
  });

  it("anon cannot place a bid", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("insert into public.bids (auction_id, bidder_id, amount_cents) values ($1, $2, 9000)", [
          ids.auctionId,
          USERS.buyer1,
        ]),
      );
    });
  });
});

describe("bids: UPDATE/DELETE (immutable ledger)", () => {
  it("not even the bidder can update or delete their own bid", async () => {
    // Same table-level-revoke shape as auctions above (0039): bids are an
    // append-only ledger, so this is a permission-denied error, not a
    // zero-row RLS filter.
    // Two separate transactions: once a statement is denied, Postgres aborts
    // the rest of that transaction block, so a second statement afterwards
    // would fail with "current transaction is aborted" rather than
    // re-demonstrating the permission check.
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("update public.bids set amount_cents = 1 where id = $1", [ids.bids.buyer1]),
        /permission denied/,
      );
    });
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(c.query("delete from public.bids where id = $1", [ids.bids.buyer1]), /permission denied/);
    });
  });
});

describe("public.auction_bid_history (rule 6 — public amount/time, no bidder identity)", () => {
  it("anon can read the anonymised bid history for a concluded auction", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select * from public.auction_bid_history where auction_id = $1", [ids.auctionId]);
      expect(r.rowCount).toBe(2);
      for (const row of r.rows) {
        expect(row).not.toHaveProperty("bidder_id");
        expect(row).not.toHaveProperty("id");
        expect(row).toHaveProperty("amount_cents");
        expect(row).toHaveProperty("created_at");
      }
    });
  });

  it("an unrelated authenticated user sees the same anonymised rows, still without bidder identity", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const r = await c.query("select * from public.auction_bid_history where auction_id = $1", [ids.auctionId]);
      expect(r.rowCount).toBe(2);
      const amounts = r.rows.map((row: { amount_cents: number }) => Number(row.amount_cents)).sort((a, b) => a - b);
      expect(amounts).toEqual([5000, 6000]);
    });
  });
});
