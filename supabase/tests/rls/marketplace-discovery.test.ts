// Phase: marketplace-discovery. Covers public.search_marketplace_listings()
// (0047_marketplace_discovery.sql) — the RPC /marketplace's discovery grid
// now runs through instead of a plain `.eq/.order/.limit()` query. This
// deliberately exercises the function through real anon/authenticated
// connections (like every other file in this suite) rather than as a
// superuser, since the whole point is confirming both layers of "only
// active listings show up" agree: the function's own explicit
// `status = 'active'` filter, AND the underlying listings SELECT policy it
// runs under (this function is NOT security definer — see its header
// comment on why that's deliberate).
import { describe, it, expect, afterAll } from "vitest";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

type Row = { id: string; title: string; status: string; price_cents: string | null };

describe("search_marketplace_listings()", () => {
  it("anon can call it (execute is granted) and gets rows back", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query<Row>("select * from public.search_marketplace_listings()");
      expect(r.rowCount).toBeGreaterThan(0);
    });
  });

  it("only ever returns active listings, never draft/removed/reserved/sold/etc.", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query<Row>("select id, status from public.search_marketplace_listings(p_limit := 60)");
      const ids2 = r.rows.map((row) => row.id);
      expect(r.rows.every((row) => row.status === "active")).toBe(true);
      expect(ids2).toContain(ids.listings.active);
      expect(ids2).not.toContain(ids.listings.draft);
      expect(ids2).not.toContain(ids.listings.removed);
      expect(ids2).not.toContain(ids.listings.reserved);
      expect(ids2).not.toContain(ids.listings.sold);
      expect(ids2).not.toContain(ids.listings.pendingReview);
      expect(ids2).not.toContain(ids.listings.expired);
    });
  });

  it("even the owner doesn't see their own draft through discovery search (unlike a direct table read)", async () => {
    // listing_is_visible() would let seller1 read L2 (their own draft)
    // directly — this function's own explicit status='active' filter
    // deliberately doesn't extend that here: My Listings, not the public
    // search grid, is where a seller checks on a draft.
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query<Row>("select id from public.search_marketplace_listings(p_limit := 60)");
      expect(r.rows.map((row) => row.id)).not.toContain(ids.listings.draft);
    });
  });

  it("filters by category", async () => {
    await withRole("anon", null, async (c) => {
      const match = await c.query<Row>("select id from public.search_marketplace_listings(p_category := 'Irons')");
      expect(match.rows.map((row) => row.id)).toContain(ids.listings.active);

      const noMatch = await c.query<Row>(
        "select id from public.search_marketplace_listings(p_category := 'Putters')"
      );
      expect(noMatch.rows.map((row) => row.id)).not.toContain(ids.listings.active);
    });
  });

  it("free-text search matches title/description case-insensitively", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query<Row>(
        "select id from public.search_marketplace_listings(p_query := 'PENDING OFFER')"
      );
      expect(r.rows.map((row) => row.id)).toContain(ids.listings.active);
    });
  });

  it("respects p_limit", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query<Row>("select id from public.search_marketplace_listings(p_limit := 1)");
      expect(r.rowCount).toBe(1);
    });
  });

  it("price sort puts the null-priced auction listing last in both directions", async () => {
    await withRole("anon", null, async (c) => {
      const low = await c.query<Row>(
        "select id, price_cents from public.search_marketplace_listings(p_sort := 'price_low', p_limit := 60)"
      );
      const lowIds = low.rows.map((r) => r.id);
      const auctionIdx = lowIds.indexOf(ids.listings.auction);
      expect(auctionIdx).toBe(lowIds.length - 1);

      const high = await c.query<Row>(
        "select id, price_cents from public.search_marketplace_listings(p_sort := 'price_high', p_limit := 60)"
      );
      const highIds = high.rows.map((r) => r.id);
      expect(highIds.indexOf(ids.listings.auction)).toBe(highIds.length - 1);
    });
  });

  it("keyset cursor pagination doesn't repeat or skip rows across two pages", async () => {
    await withRole("anon", null, async (c) => {
      // created_at::text (not the bare column) — node-postgres's own type
      // parser turns timestamptz into a JS Date, which only holds
      // millisecond precision and would silently round two fixture rows
      // created microseconds apart down to the same millisecond, corrupting
      // the cursor this test feeds back in. The app's real path
      // (marketplace-discovery.ts, via supabase-js/PostgREST) doesn't have
      // this problem — PostgREST serialises timestamptz to full-precision
      // JSON text, never through node-postgres's Date parsing — so this
      // cast is purely working around this test harness's own driver choice
      // (see harness.ts's header comment on why it's plain `pg`), not
      // something the real code path needs.
      const all = await c.query<Row & { created_at: string }>(
        "select id, created_at::text from public.search_marketplace_listings(p_sort := 'newest', p_limit := 60)"
      );
      const page1 = await c.query<Row & { created_at: string }>(
        "select id, created_at::text from public.search_marketplace_listings(p_sort := 'newest', p_limit := 1)"
      );
      expect(page1.rowCount).toBe(1);
      const cursorRow = page1.rows[0];

      const page2 = await c.query<Row>(
        `select id from public.search_marketplace_listings(
           p_sort := 'newest', p_limit := 60,
           p_cursor_created_at := $1, p_cursor_id := $2
         )`,
        [cursorRow.created_at, cursorRow.id]
      );

      // page1's row never reappears on page2, and together they account for
      // every row the unlimited query returned.
      expect(page2.rows.map((r) => r.id)).not.toContain(cursorRow.id);
      expect(page2.rowCount).toBe(all.rowCount! - 1);
    });
  });
});
