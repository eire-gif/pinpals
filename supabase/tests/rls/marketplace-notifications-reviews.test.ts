// marketplace-notifications-reviews (0056_marketplace_notifications_reviews.sql)
// — covers everything genuinely new in that migration's RLS/trigger surface:
// notification_preferences (own-row CRUD, category CHECK constraint),
// notifications.dedupe_key (partial unique index + notify_user()'s ON
// CONFLICT DO NOTHING), reviews' hidden-review visibility + the new
// prevent_review_moderation_tampering() trigger, reports.target_type
// accepting 'review', and the seller_rating_summaries view. The offer/
// auction/payment notification-firing FUNCTIONS themselves (offer_action(),
// run_auction_sweeps(), apply_new_bid()'s outbid branch) are business logic
// covered by their own call sites' existing tests (offers.test.ts,
// marketplace-discovery.test.ts, etc.) plus this phase's TypeScript unit
// tests (src/lib/notifications.test.ts) — this file is RLS/constraint
// surface only, matching every other file in this directory.
import { describe, it, expect, afterAll } from "vitest";
import { pool, withRole, setIdentity, expectRejected, expectZeroRows, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

describe("notification_preferences: SELECT/INSERT/UPDATE/DELETE (own rows only)", () => {
  it("a member can insert, read, update and delete their own preference row", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const insert = await c.query(
        "insert into public.notification_preferences (user_id, category, email_enabled) values ($1, 'messages', false)",
        [USERS.buyer1],
      );
      expect(insert.rowCount).toBe(1);

      const select = await c.query(
        "select email_enabled from public.notification_preferences where user_id = $1 and category = 'messages'",
        [USERS.buyer1],
      );
      expect(select.rows[0].email_enabled).toBe(false);

      const update = await c.query(
        "update public.notification_preferences set email_enabled = true where user_id = $1 and category = 'messages'",
        [USERS.buyer1],
      );
      expect(update.rowCount).toBe(1);

      const del = await c.query(
        "delete from public.notification_preferences where user_id = $1 and category = 'messages'",
        [USERS.buyer1],
      );
      expect(del.rowCount).toBe(1);
    });
  });

  it("a member cannot insert a preference row for someone else", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query(
          "insert into public.notification_preferences (user_id, category, email_enabled) values ($1, 'offers', false)",
          [USERS.seller1],
        ),
      );
    });
  });

  it("a member cannot read or update another member's preference row", async () => {
    // Single connection/transaction — a separately-opened withRole() call
    // wouldn't see this transaction's still-uncommitted insert (withRole()
    // always rolls back at the end of its own callback), so the row is
    // created and then probed by a different identity on the same
    // connection, same shape as the reviews visibility test above.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      await client.query(
        "insert into public.notification_preferences (user_id, category, email_enabled) values ($1, 'auctions', false)",
        [USERS.seller1],
      );

      await client.query("set local role authenticated");
      await setIdentity(client, USERS.buyer1);

      const select = await client.query(
        "select 1 from public.notification_preferences where user_id = $1 and category = 'auctions'",
        [USERS.seller1],
      );
      expectZeroRows(select);

      const update = await client.query(
        "update public.notification_preferences set email_enabled = true where user_id = $1 and category = 'auctions'",
        [USERS.seller1],
      );
      expectZeroRows(update);
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  });

  it("rejects a category outside the four optional ones (payments/disputes_refunds can never be silenced)", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query(
          "insert into public.notification_preferences (user_id, category, email_enabled) values ($1, 'payments', false)",
          [USERS.buyer1],
        ),
      );
      await expectRejected(
        c.query(
          "insert into public.notification_preferences (user_id, category, email_enabled) values ($1, 'disputes_refunds', false)",
          [USERS.buyer1],
        ),
      );
    });
  });

  it("anon has no access at all", async () => {
    // `revoke all on public.notification_preferences from anon` (0056) —
    // unlike a table anon can SELECT-but-see-nothing-via-RLS, anon has no
    // table-level grant here at all, so even a bare SELECT is a hard
    // "permission denied" rather than a filtered zero-row result. Two
    // separate withRole() calls (two transactions) — a permission-denied
    // error aborts the transaction, so a second statement on the same
    // connection would just fail with "current transaction is aborted"
    // rather than its own permission-denied error.
    await withRole("anon", null, async (c) => {
      await expectRejected(c.query("select 1 from public.notification_preferences limit 1"), /permission denied/);
    });
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query(
          "insert into public.notification_preferences (user_id, category, email_enabled) values ($1, 'messages', false)",
          [USERS.buyer2],
        ),
        /permission denied/,
      );
    });
  });
});

describe("notifications.dedupe_key: partial unique index + notify_user() ON CONFLICT", () => {
  it("notify_user() silently no-ops a repeat call with the same (user_id, dedupe_key)", async () => {
    await withRole("service_role", null, async (c) => {
      // notify_user() `returns void` — nothing to assert about its own
      // return value, only about the row(s) it did or didn't insert below.
      await c.query(
        `select public.notify_user($1, 'offer_received', 'New offer', 'body', '{}'::jsonb, 'dedupe-test-key')`,
        [USERS.buyer2],
      );

      const countAfterFirst = await c.query(
        "select count(*)::int as n from public.notifications where user_id = $1 and dedupe_key = 'dedupe-test-key'",
        [USERS.buyer2],
      );
      expect(countAfterFirst.rows[0].n).toBe(1);

      // Second call, same user + same dedupe_key — must not insert a second row.
      await c.query(
        `select public.notify_user($1, 'offer_received', 'New offer again', 'body2', '{}'::jsonb, 'dedupe-test-key')`,
        [USERS.buyer2],
      );
      const countAfterSecond = await c.query(
        "select count(*)::int as n from public.notifications where user_id = $1 and dedupe_key = 'dedupe-test-key'",
        [USERS.buyer2],
      );
      expect(countAfterSecond.rows[0].n).toBe(1);
    });
  });

  it("the same dedupe_key is independent per user (no cross-user collision)", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query(
        `select public.notify_user($1, 'offer_received', 'New offer', 'body', '{}'::jsonb, 'shared-dedupe-key')`,
        [USERS.buyer1],
      );
      await c.query(
        `select public.notify_user($1, 'offer_received', 'New offer', 'body', '{}'::jsonb, 'shared-dedupe-key')`,
        [USERS.buyer2],
      );
      const rows = await c.query(
        "select user_id from public.notifications where dedupe_key = 'shared-dedupe-key'",
      );
      expect(rows.rowCount).toBe(2);
    });
  });

  it("a null dedupe_key never triggers the partial unique index (repeat calls both insert)", async () => {
    await withRole("service_role", null, async (c) => {
      const before = await c.query(
        "select count(*)::int as n from public.notifications where user_id = $1 and dedupe_key is null",
        [USERS.buyer1],
      );
      await c.query(`select public.notify_user($1, 'offer_received', 'No dedupe', 'body', '{}'::jsonb, null)`, [
        USERS.buyer1,
      ]);
      await c.query(`select public.notify_user($1, 'offer_received', 'No dedupe', 'body', '{}'::jsonb, null)`, [
        USERS.buyer1,
      ]);
      const after = await c.query(
        "select count(*)::int as n from public.notifications where user_id = $1 and dedupe_key is null",
        [USERS.buyer1],
      );
      expect(after.rows[0].n).toBe(before.rows[0].n + 2);
    });
  });
});

describe("reviews: hidden-review visibility", () => {
  it("a hidden review is invisible to a stranger but visible to its reviewer, reviewee, and staff", async () => {
    // One connection/transaction throughout, switching role + identity at
    // each step — withRole() always rolls back at the end of its own
    // callback, so a separately-opened withRole() call later wouldn't see
    // an insert made (and never committed) by an earlier one. Same
    // reasoning as the "staff can hide and restore" test above.
    const client = await pool.connect();
    try {
      await client.query("begin");

      await client.query("set local role authenticated");
      await setIdentity(client, USERS.buyer1);
      const { rows } = await client.query<{ id: string }>(
        "insert into public.reviews (order_id, reviewer_id, reviewee_id, rating, body) values ($1, $2, $3, 2, 'Not great') returning id",
        [ids.orderId, USERS.buyer1, USERS.seller1],
      );
      const reviewId = rows[0].id;

      // Reset request.jwt.claim.sub before switching to service_role — it's
      // set_config(..., true) (transaction-local), so it otherwise stays
      // pinned to buyer1 for the rest of this transaction even after the
      // role switch below, which would make prevent_review_moderation_
      // tampering() see a non-null, non-staff auth.uid() and block this
      // exact update. Mirrors what withRole(role, null, ...) does for a
      // fresh service_role/anon connection.
      await client.query("select set_config('request.jwt.claim.sub', '', true)");
      await client.query("set local role service_role");
      await client.query(
        "update public.reviews set hidden_at = now(), hidden_by = $2, hidden_reason = 'Reported as abusive' where id = $1",
        [reviewId, USERS.moderator],
      );

      await client.query("set local role authenticated");
      await setIdentity(client, USERS.buyer2);
      expectZeroRows(await client.query("select id from public.reviews where id = $1", [reviewId]));

      await client.query("set local role anon");
      expectZeroRows(await client.query("select id from public.reviews where id = $1", [reviewId]));

      await client.query("set local role authenticated");
      await setIdentity(client, USERS.buyer1);
      expect((await client.query("select id from public.reviews where id = $1", [reviewId])).rowCount).toBe(1);

      await setIdentity(client, USERS.seller1);
      expect((await client.query("select id from public.reviews where id = $1", [reviewId])).rowCount).toBe(1);

      await setIdentity(client, USERS.moderator);
      expect((await client.query("select id from public.reviews where id = $1", [reviewId])).rowCount).toBe(1);
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  });
});

describe("reviews: prevent_review_moderation_tampering()", () => {
  it("the reviewer can still edit their own rating/body after this phase", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.reviews (order_id, reviewer_id, reviewee_id, rating, body) values ($1, $2, $3, 3, 'Fine') returning id",
        [ids.orderId, USERS.buyer1, USERS.seller1],
      );
      const reviewId = rows[0].id;

      const update = await c.query("update public.reviews set rating = 5, body = 'Actually great' where id = $1", [
        reviewId,
      ]);
      expect(update.rowCount).toBe(1);
    });
  });

  it("a non-staff caller cannot set hidden_at/hidden_by/hidden_reason on their own review via the ordinary UPDATE policy", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.reviews (order_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 4) returning id",
        [ids.orderId, USERS.buyer1, USERS.seller1],
      );
      const reviewId = rows[0].id;

      await expectRejected(
        c.query("update public.reviews set hidden_at = now(), hidden_reason = 'self-hidden' where id = $1", [
          reviewId,
        ]),
      );
    });
  });

  it("staff (service-role path) can hide and restore a review", async () => {
    // Single connection, switching roles mid-transaction — same shape as
    // reviews.test.ts's "cannot review an order that hasn't completed yet"
    // test. A second, separately-opened withRole() connection wouldn't see
    // this transaction's still-uncommitted insert, so the role switch has
    // to happen on the same client/transaction, not a nested withRole().
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await setIdentity(client, USERS.buyer1);
      const { rows } = await client.query<{ id: string }>(
        "insert into public.reviews (order_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 1) returning id",
        [ids.orderId, USERS.buyer1, USERS.seller1],
      );
      const reviewId = rows[0].id;

      // Moderation itself goes through the service-role client in the real
      // app (see src/app/admin/reviews/actions.ts). Reset the jwt claim
      // first — see the identical comment in the "hidden-review visibility"
      // test above for why it can't just be left pointing at buyer1.
      await client.query("select set_config('request.jwt.claim.sub', '', true)");
      await client.query("set local role service_role");
      const hide = await client.query(
        "update public.reviews set hidden_at = now(), hidden_by = $2, hidden_reason = 'Policy violation' where id = $1",
        [reviewId, USERS.moderator],
      );
      expect(hide.rowCount).toBe(1);

      const restore = await client.query(
        "update public.reviews set hidden_at = null, hidden_by = null, hidden_reason = null where id = $1",
        [reviewId],
      );
      expect(restore.rowCount).toBe(1);
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  });
});

describe("reports.target_type accepts 'review'", () => {
  // `reports` has no authenticated-level INSERT policy at all (0016) —
  // every member-facing report action (reportListing(), reportReview(),
  // etc.) writes through the service-role client after its own participancy/
  // existence check, never a directly RLS-checked client insert. These
  // tests exercise that same path, not an authenticated insert.
  it("the service-role write path can file a report targeting a review", async () => {
    await withRole("service_role", null, async (c) => {
      const r = await c.query(
        "insert into public.reports (reporter_id, target_type, target_id, category, description) values ($1, 'review', '1', 'harassment', 'Fixture review report')",
        [USERS.buyer2],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("still rejects a target_type outside the closed list", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          "insert into public.reports (reporter_id, target_type, target_id, category) values ($1, 'not_a_real_type', '1', 'other')",
          [USERS.buyer2],
        ),
        /reports_target_type_check/,
      );
    });
  });
});

describe("seller_rating_summaries: correctness + public readability", () => {
  it("excludes hidden reviews from the average/count", async () => {
    // validate_review() (0041) requires reviewer/reviewee to actually be
    // the order's own buyer/seller, with no privileged-caller carve-out —
    // unlike offers' prepare_and_validate_offer(), it enforces this even
    // for service_role. Two reviews "of seller2" therefore need two
    // separate completed orders (one review per (order, reviewer) — see
    // reviews' own unique constraint), not one order reused twice.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");

      const newCompletedOrder = async (buyerId: string, sellerId: string): Promise<string> => {
        const { rows } = await client.query<{ id: string }>(
          `insert into public.orders (
             buyer_id, seller_id, listing_title, listing_category, listing_condition,
             amount_eur, platform_fee_eur, total_eur, status, completed_at
           ) values ($1, $2, 'Fixture order for rating summary', 'Irons', 'good', 80, 4, 84, 'completed', now())
           returning id`,
          [buyerId, sellerId],
        );
        return rows[0].id;
      };

      const orderA = await newCompletedOrder(USERS.buyer1, USERS.seller2);
      const orderB = await newCompletedOrder(USERS.buyer2, USERS.seller2);

      const { rows: visibleReview } = await client.query<{ id: string }>(
        "insert into public.reviews (order_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 5) returning id",
        [orderA, USERS.buyer1, USERS.seller2],
      );
      const { rows: hiddenReview } = await client.query<{ id: string }>(
        `insert into public.reviews (order_id, reviewer_id, reviewee_id, rating, hidden_at, hidden_by)
         values ($1, $2, $3, 1, now(), $4) returning id`,
        [orderB, USERS.buyer2, USERS.seller2, USERS.moderator],
      );
      expect(visibleReview[0].id).toBeTruthy();
      expect(hiddenReview[0].id).toBeTruthy();

      // `count(*)` comes back as a bigint, which `pg` renders as a string
      // (not a JS number, which can't safely hold the full bigint range) —
      // same reasoning fixtures.ts documents for bigint identity columns.
      const summary = await client.query<{ average_rating: string; review_count: string }>(
        "select average_rating, review_count from public.seller_rating_summaries where user_id = $1",
        [USERS.seller2],
      );
      expect(summary.rowCount).toBe(1);
      expect(Number(summary.rows[0].review_count)).toBe(1);
      expect(Number(summary.rows[0].average_rating)).toBe(5);
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  });

  it("is readable by anon (public reputation data, same as reviews itself)", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select user_id from public.seller_rating_summaries limit 1");
      // Asserts no permission error is raised — content depends on whatever
      // committed review fixtures exist, which this suite doesn't rely on.
      expect(r.rowCount).not.toBeNull();
    });
  });
});
