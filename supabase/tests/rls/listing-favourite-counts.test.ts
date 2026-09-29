// listing_favourite_counts() — 0085.
//
// The function exists because listing_favourites (0037) is readable only by
// the member who saved the listing, so a seller counting saves on their own
// listings counts only their own and gets zero. It is SECURITY DEFINER, which
// means RLS does not apply to it at all: the grant and the `seller_id`
// predicate inside the body ARE the boundary, and both are tested here.
//
// Every case seeds and asserts inside ONE withRole transaction, because
// withRole always rolls back — a row inserted in one call is gone by the
// next. Where a case needs two different members, setIdentity() re-points
// auth.uid() on the same connection rather than opening a second one that
// could not see the first's uncommitted rows.
import { describe, it, expect, afterAll } from "vitest";
import { pool, withRole, setIdentity, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

/** The fixtures' seller1 owns `active`; seller2 owns `seller2Active`. */
const MINE = () => ids.listings.active;
const THEIRS = () => ids.listings.seller2Active;

async function countsFor(client: Parameters<Parameters<typeof withRole>[2]>[0], listingIds: string[]) {
  const r = await client.query(
    "select listing_id, favourites from public.listing_favourite_counts($1::bigint[]) order by listing_id",
    [listingIds],
  );
  return r.rows as { listing_id: string; favourites: string }[];
}

describe("listing_favourite_counts: a seller sees saves on their own listings", () => {
  it("counts other members' saves, which a direct read cannot", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      // Two different members save seller1's listing. Neither is seller1, so
      // neither of these rows is visible to seller1 under the table's own
      // policy — which is the entire point of the function.
      await c.query(
        "insert into public.listing_favourites (listing_id, user_id) values ($1, $2)",
        [MINE(), USERS.buyer1],
      );
      await setIdentity(c, USERS.buyer2);
      await c.query(
        "insert into public.listing_favourites (listing_id, user_id) values ($1, $2)",
        [MINE(), USERS.buyer2],
      );

      await setIdentity(c, USERS.seller1);

      // The bug this function fixes, demonstrated first: counting the table
      // directly as the seller finds nothing at all.
      const direct = await c.query(
        "select count(*)::int as n from public.listing_favourites where listing_id = $1",
        [MINE()],
      );
      expect(direct.rows[0].n).toBe(0);

      // And the function, on the same rows, in the same transaction.
      const rows = await countsFor(c, [MINE()]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].favourites)).toBe(2);
    });
  });

  it("returns no row for a listing nobody has saved, rather than a zero", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      expect(await countsFor(c, [MINE()])).toEqual([]);
    });
  });
});

describe("listing_favourite_counts: the seller_id predicate is the boundary", () => {
  it("a seller passing someone else's listing id gets nothing back", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await c.query(
        "insert into public.listing_favourites (listing_id, user_id) values ($1, $2)",
        [THEIRS(), USERS.buyer1],
      );

      // seller1 asks about seller2's listing. The function runs as its owner,
      // so nothing stops it reading the row — except the predicate.
      await setIdentity(c, USERS.seller1);
      expect(await countsFor(c, [THEIRS()])).toEqual([]);
    });
  });

  it("a mixed array returns only the caller's own listings", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await c.query(
        "insert into public.listing_favourites (listing_id, user_id) values ($1, $2), ($3, $2)",
        [MINE(), USERS.buyer1, THEIRS()],
      );

      await setIdentity(c, USERS.seller1);
      const rows = await countsFor(c, [MINE(), THEIRS()]);
      expect(rows).toHaveLength(1);
      expect(rows[0].listing_id).toBe(String(MINE()));
    });
  });

  it("seller2 sees their own listing's saves, so this isn't just 'always empty'", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await c.query(
        "insert into public.listing_favourites (listing_id, user_id) values ($1, $2)",
        [THEIRS(), USERS.buyer1],
      );

      await setIdentity(c, USERS.seller2);
      const rows = await countsFor(c, [THEIRS()]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].favourites)).toBe(1);
    });
  });
});

describe("listing_favourite_counts: grants", () => {
  // function-grants.test.ts snapshots this too; asserted here as well because
  // that file tests the whole schema's ACLs and this tests one function's
  // behaviour — a reader of either should see the boundary.
  it("anon cannot execute it", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("select * from public.listing_favourite_counts(array[1]::bigint[])"),
        /permission denied/i,
      );
    });
  });

  it("an authenticated caller with no rows of their own gets an empty result, not an error", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      expect(await countsFor(c, [MINE(), THEIRS()])).toEqual([]);
    });
  });
});
