// Rule 1 ("Anyone may read active public listings and their public images")
// and rule 2 ("Sellers may create and edit only their own draft/active
// listings, subject to valid status transitions") from the phase task.
import { describe, it, expect, afterAll } from "vitest";
import { withRole, expectRejected, expectZeroRows, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

describe("listings: SELECT (rule 1 — public visibility, extended for active participants)", () => {
  it("anon can read an active listing", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.listings where id = $1", [ids.listings.active]);
      expect(r.rowCount).toBe(1);
    });
  });

  it.each([
    ["draft", "draft"],
    ["pending_review", "pendingReview"],
    ["removed", "removed"],
    ["expired", "expired"],
    ["sold", "sold"],
    ["reserved", "reserved"],
  ] as const)("anon cannot read a %s listing it has no relationship to", async (_status, key) => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.listings where id = $1", [ids.listings[key]]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("an unrelated authenticated user cannot read a non-active listing either", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const r = await c.query("select id from public.listings where id = $1", [ids.listings.draft]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("the seller can read every one of their own listings regardless of status", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      for (const key of ["active", "draft", "reserved", "sold", "removed", "pendingReview", "expired"] as const) {
        const r = await c.query("select id from public.listings where id = $1", [ids.listings[key]]);
        expect(r.rowCount, `seller1 reading own ${key} listing`).toBe(1);
      }
    });
  });

  it("a buyer with a live offer can read the (non-active) listing it's on", async () => {
    // buyer1's accepted offer is on the reserved listing (L3) — this is the
    // deliberate extension beyond bare status='active' (see 0045's header
    // comment): without it, a buyer completing a purchase would 404 on the
    // listing page the moment it flips to 'reserved'.
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select id from public.listings where id = $1", [ids.listings.reserved]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("a buyer with no offer/order on a listing cannot see it once it's left active", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const r = await c.query("select id from public.listings where id = $1", [ids.listings.reserved]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("an active staff member (moderator) can read every listing, including removed/draft", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      for (const key of ["draft", "removed", "pendingReview"] as const) {
        const r = await c.query("select id from public.listings where id = $1", [ids.listings[key]]);
        expect(r.rowCount, `moderator reading ${key} listing`).toBe(1);
      }
    });
  });

  it("admin can read every listing too", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      const r = await c.query("select id from public.listings where id = $1", [ids.listings.removed]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("a disabled staff member gets no staff bypass at all", async () => {
    await withRole("authenticated", USERS.disabledStaff, async (c) => {
      const r = await c.query("select id from public.listings where id = $1", [ids.listings.draft]);
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("listings: INSERT (rule 2 — sellers create only under their own seller_id)", () => {
  it("a seller can insert a listing under their own seller_id", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query(
        `insert into public.listings (seller_id, title, price_eur, category, condition, status)
         values ($1, 'New driver', 200, 'drivers', 'good', 'draft')`,
        [USERS.seller1],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("a user cannot insert a listing under someone else's seller_id", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.listings (seller_id, title, price_eur, category, condition, status)
           values ($1, 'Fraudulent listing', 200, 'drivers', 'good', 'draft')`,
          [USERS.seller1],
        ),
      );
    });
  });

  it("anon cannot insert a listing at all", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.listings (seller_id, title, price_eur, category, condition, status)
           values ($1, 'Anon listing', 200, 'drivers', 'good', 'draft')`,
          [USERS.seller1],
        ),
      );
    });
  });
});

describe("listings: UPDATE (rule 2 — only own draft/active rows, valid transitions only)", () => {
  it("a seller can edit their own active listing", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("update public.listings set title = 'Edited' where id = $1", [ids.listings.active]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("a seller can edit their own draft listing", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("update public.listings set title = 'Edited draft' where id = $1", [
        ids.listings.draft,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it.each(["reserved", "sold", "removed", "pendingReview", "expired"] as const)(
    "a seller cannot edit their own %s listing (not draft/active)",
    async (key) => {
      await withRole("authenticated", USERS.seller1, async (c) => {
        const r = await c.query("update public.listings set title = 'Should not apply' where id = $1", [
          ids.listings[key],
        ]);
        expectZeroRows(r);
      });
    },
  );

  it("an unrelated seller cannot edit someone else's active listing", async () => {
    await withRole("authenticated", USERS.seller2, async (c) => {
      const r = await c.query("update public.listings set title = 'Hijacked' where id = $1", [ids.listings.active]);
      expectZeroRows(r);
    });
  });

  it("a valid status transition (active -> reserved) is accepted", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("update public.listings set status = 'reserved' where id = $1", [
        ids.listings.active,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("an invalid status transition (draft -> active, skipping moderation) is rejected by the trigger", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("update public.listings set status = 'active' where id = $1", [ids.listings.draft]),
        /Invalid listing status transition/,
      );
    });
  });

  it("a valid draft transition (draft -> pending_review) is accepted", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("update public.listings set status = 'pending_review' where id = $1", [
        ids.listings.draft,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("staff can update a listing in any status, bypassing the draft/active USING restriction", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const r = await c.query("update public.listings set title = 'Moderated' where id = $1", [
        ids.listings.removed,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("the service-role (admin Server Action) path can restore a removed listing to active", async () => {
    // This is the concrete app-code path this trigger design has to keep
    // working: src/app/admin/listings/[id]/actions.ts's restore action uses
    // createAdminClient() (service role), and 'removed' -> 'active' is not in
    // the ordinary seller-facing transition whitelist.
    await withRole("service_role", null, async (c) => {
      const r = await c.query("update public.listings set status = 'active' where id = $1", [ids.listings.removed]);
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("listings: DELETE (rule 2 — only own draft/active rows)", () => {
  it("a seller can delete their own draft listing", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("delete from public.listings where id = $1", [ids.listings.draft]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("a seller cannot delete their own reserved listing", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("delete from public.listings where id = $1", [ids.listings.reserved]);
      expectZeroRows(r);
    });
  });

  it("an unrelated user cannot delete someone else's listing", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("delete from public.listings where id = $1", [ids.listings.active]);
      expectZeroRows(r);
    });
  });

  it("anon cannot delete a listing", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("delete from public.listings where id = $1", [ids.listings.active]);
      expectZeroRows(r);
    });
  });

  it("staff can delete a listing in any status", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      const r = await c.query("delete from public.listings where id = $1", [ids.listings.sold]);
      expect(r.rowCount).toBe(1);
    });
  });
});
