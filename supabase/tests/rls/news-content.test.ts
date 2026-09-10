// content_sources / content_items (migration 0068).
//
// Both follow the "staff can read, only service-role can write" shape that
// admin_user_notes and the payment internals already use, so most of this
// mirrors admin-only-tables.test.ts. Two things here are specific to news
// and are the reason this file exists separately:
//
//   - content_items holds other organisations' press releases IN FULL. A
//     public read policy would be republishing them by the back door, which
//     is exactly what the whole pipeline design avoids. The "anon cannot
//     read" case below is a copyright control, not just tidiness.
//
//   - image_rights_granted must be impossible to set without recorded
//     evidence. That is enforced by a check constraint rather than by
//     application code, so it is tested against the database itself —
//     including against service_role, which bypasses RLS but not constraints.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";

const FEED = "https://example-press.test/rls-fixture/feed";
let sourceId: string;
let itemId: string;

beforeAll(async () => {
  const source = await pool.query(
    `insert into public.content_sources
       (name, organisation, fetch_kind, feed_url, newsroom_url, enabled, robots_allows)
     values ('RLS Fixture Source', 'Fixture Org', 'rss', $1,
             'https://example-press.test/rls-fixture/', true, true)
     returning id`,
    [FEED],
  );
  sourceId = source.rows[0].id;

  const item = await pool.query(
    `insert into public.content_items
       (source_id, external_id, canonical_url, title, raw_body, content_hash)
     values ($1, 'rls-fixture-1', 'https://example-press.test/rls-fixture/a',
             'Fixture release', 'Body text of the release.', repeat('a', 64))
     returning id`,
    [sourceId],
  );
  itemId = item.rows[0].id;
});

afterAll(async () => {
  // content_items cascades from the source.
  await pool.query("delete from public.content_sources where feed_url = $1", [FEED]);
  await closePool();
});

describe("content_sources: SELECT", () => {
  it("staff can read sources", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const r = await c.query("select id from public.content_sources where id = $1", [sourceId]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("an ordinary member cannot read sources", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select id from public.content_sources where id = $1", [sourceId]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("anon cannot read sources", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("select id from public.content_sources where id = $1", [sourceId]),
        /permission denied/i,
      );
    });
  });

  it("a disabled staff row grants nothing", async () => {
    await withRole("authenticated", USERS.disabledStaff, async (c) => {
      const r = await c.query("select id from public.content_sources where id = $1", [sourceId]);
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("content_items: SELECT", () => {
  it("staff can read collected items", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      const r = await c.query("select id from public.content_items where id = $1", [itemId]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("an ordinary member cannot read collected items", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select id from public.content_items where id = $1", [itemId]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("anon cannot read collected items — these are other people's press releases held in full", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("select id from public.content_items where id = $1", [itemId]),
        /permission denied/i,
      );
    });
  });
});

describe.each(["content_sources", "content_items"] as const)("%s: writes", (table) => {
  it("a member cannot insert", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query(`insert into public.${table} default values`),
        /permission denied|violates row-level security/i,
      );
    });
  });

  it("a member cannot update", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query(`update public.${table} set created_at = now()`),
        /permission denied/i,
      );
    });
  });

  it("a member cannot delete", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(c.query(`delete from public.${table}`), /permission denied/i);
    });
  });

  it("even staff cannot write — there is no policy, only the service role", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      await expectRejected(
        c.query(`delete from public.${table}`),
        /permission denied|violates row-level security/i,
      );
    });
  });
});

describe("image rights constraint", () => {
  it("rejects granting image rights with no recorded evidence, even as service_role", async () => {
    // RLS is bypassed by service_role; a CHECK constraint is not. That is the
    // point of putting this rule in the database rather than in the app.
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          "update public.content_sources set image_rights_granted = true where id = $1",
          [sourceId],
        ),
        /image_rights_need_evidence/i,
      );
    });
  });

  it("allows it once an evidence link is recorded", async () => {
    await withRole("service_role", null, async (c) => {
      const r = await c.query(
        `update public.content_sources
            set image_rights_granted = true,
                rights_evidence_url = 'https://mail.example/permission-thread'
          where id = $1
        returning image_rights_granted`,
        [sourceId],
      );
      expect(r.rows[0].image_rights_granted).toBe(true);
    });
  });

  it("rejects clearing the evidence while the grant still stands", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query(
        `update public.content_sources
            set image_rights_granted = true,
                rights_evidence_url = 'https://mail.example/permission-thread'
          where id = $1`,
        [sourceId],
      );
      await expectRejected(
        c.query(
          "update public.content_sources set rights_evidence_url = null where id = $1",
          [sourceId],
        ),
        /image_rights_need_evidence/i,
      );
    });
  });
});

describe("collection integrity", () => {
  it("refuses a second item with the same external id from the same source", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.content_items
             (source_id, external_id, canonical_url, title, raw_body, content_hash)
           values ($1, 'rls-fixture-1', 'https://example-press.test/rls-fixture/a',
                   'Fixture release', 'Body.', repeat('b', 64))`,
          [sourceId],
        ),
        /content_items_source_external_id_key/i,
      );
    });
  });

  it("allows the same external id from a different source", async () => {
    await withRole("service_role", null, async (c) => {
      const other = await c.query(
        `insert into public.content_sources
           (name, organisation, fetch_kind, feed_url, newsroom_url)
         values ('Other', 'Other Org', 'rss', 'https://other.test/feed',
                 'https://other.test/news')
         returning id`,
      );
      const r = await c.query(
        `insert into public.content_items
           (source_id, external_id, canonical_url, title, raw_body, content_hash)
         values ($1, 'rls-fixture-1', 'https://other.test/a', 'T', 'B', repeat('c', 64))
         returning id`,
        [other.rows[0].id],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("refuses an item with no raw body — we cannot draft from what we did not store", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.content_items
             (source_id, external_id, canonical_url, title, content_hash)
           values ($1, 'no-body', 'https://example-press.test/b', 'T', repeat('d', 64))`,
          [sourceId],
        ),
        /raw_body/i,
      );
    });
  });

  it("refuses a malformed content hash", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.content_items
             (source_id, external_id, canonical_url, title, raw_body, content_hash)
           values ($1, 'bad-hash', 'https://example-press.test/c', 'T', 'B', 'too-short')`,
          [sourceId],
        ),
        /content_hash/i,
      );
    });
  });

  it("refuses a non-https feed url", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.content_sources
             (name, organisation, fetch_kind, feed_url, newsroom_url)
           values ('Insecure', 'Org', 'rss', 'http://insecure.test/feed',
                   'https://insecure.test/news')`,
        ),
        /feed_url/i,
      );
    });
  });

  it("refuses a tier other than A — journalism sites are not representable here", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.content_sources
             (name, organisation, tier, fetch_kind, feed_url, newsroom_url)
           values ('Some Magazine', 'Org', 'B', 'rss', 'https://mag.test/feed',
                   'https://mag.test/news')`,
        ),
        /tier/i,
      );
    });
  });

  it("starts new sources disabled, so adding a row never begins fetching", async () => {
    await withRole("service_role", null, async (c) => {
      const r = await c.query(
        `insert into public.content_sources
           (name, organisation, fetch_kind, feed_url, newsroom_url)
         values ('Fresh', 'Org', 'rss', 'https://fresh.test/feed', 'https://fresh.test/news')
         returning enabled, status, robots_allows`,
      );
      expect(r.rows[0].enabled).toBe(false);
      expect(r.rows[0].robots_allows).toBeNull();
    });
  });
});
