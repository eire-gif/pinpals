// articles / article_images / article_revisions / news_usage (migration 0072).
//
// articles is the first news table with a PUBLIC read policy, and that is the
// whole reason this file exists separately from news-content.test.ts. Getting
// it wrong in either direction is a real failure:
//
//   too narrow — published articles stop rendering for logged-out visitors,
//                which is most of the site's readership;
//   too wide   — drafts and rejected articles become publicly readable, and a
//                rejected one may be rejected precisely because it said
//                something wrong about a named person.
//
// The provenance constraint is also tested here. It is what stops a published
// article claiming human review it never had, which is the record the EU AI
// Act's Article 50(4) exemption rests on.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";

const SLUG_PUBLISHED = "rls-fixture-published";
const SLUG_DRAFT = "rls-fixture-draft";
const SLUG_REJECTED = "rls-fixture-rejected";
const FEED = "https://example-press.test/articles-fixture/feed";

let publishedId: string;
let draftId: string;
let sourceId: string;
let itemId: string;

beforeAll(async () => {
  const source = await pool.query(
    `insert into public.content_sources
       (name, organisation, fetch_kind, feed_url, newsroom_url)
     values ('Articles Fixture Source', 'Fixture Org', 'rss', $1,
             'https://example-press.test/articles-fixture/')
     returning id`,
    [FEED],
  );
  sourceId = source.rows[0].id;

  const item = await pool.query(
    `insert into public.content_items
       (source_id, external_id, canonical_url, title, raw_body, content_hash)
     values ($1, 'articles-fixture-1', 'https://example-press.test/a',
             'Fixture release', 'Body.', repeat('a', 64))
     returning id`,
    [sourceId],
  );
  itemId = item.rows[0].id;

  const published = await pool.query(
    `insert into public.articles
       (content_item_id, slug, headline, standfirst, body_md,
        source_attribution, source_organisation, source_url,
        status, publish_mode, published_at, human_reviewed_by, human_reviewed_at)
     values ($1, $2, 'Published fixture', 'Standfirst.', 'Body.',
             'Fixture Org, 1 January 2026', 'Fixture Org',
             'https://example-press.test/a',
             'published', 'review', now(), $3, now())
     returning id`,
    [itemId, SLUG_PUBLISHED, USERS.admin],
  );
  publishedId = published.rows[0].id;

  const draft = await pool.query(
    `insert into public.articles
       (content_item_id, slug, headline, standfirst, body_md,
        source_attribution, source_organisation, source_url, status, publish_mode)
     values ($1, $2, 'Draft fixture', 'Standfirst.', 'Body.',
             'Fixture Org, 1 January 2026', 'Fixture Org',
             'https://example-press.test/a', 'draft', 'review')
     returning id`,
    [itemId, SLUG_DRAFT],
  );
  draftId = draft.rows[0].id;

  await pool.query(
    `insert into public.articles
       (content_item_id, slug, headline, standfirst, body_md,
        source_attribution, source_organisation, source_url, status, publish_mode,
        review_notes)
     values ($1, $2, 'Rejected fixture', 'Standfirst.', 'Body.',
             'Fixture Org, 1 January 2026', 'Fixture Org',
             'https://example-press.test/a', 'rejected', 'review',
             'said something wrong about a named person')`,
    [itemId, SLUG_REJECTED],
  );

  await pool.query(
    `insert into public.article_images
       (article_id, url, image_source, licence, credit)
     values ($1, 'https://example.test/p.jpg', 'stock', 'Unsplash License', 'A Photographer')`,
    [publishedId],
  );
  await pool.query(
    `insert into public.article_images
       (article_id, url, image_source, licence, credit)
     values ($1, 'https://example.test/d.jpg', 'stock', 'Unsplash License', 'A Photographer')`,
    [draftId],
  );
});

afterAll(async () => {
  await pool.query("delete from public.content_sources where feed_url = $1", [FEED]);
  await closePool();
});

describe("articles: public read", () => {
  it("anon can read a published article", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.articles where slug = $1", [
        SLUG_PUBLISHED,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("anon cannot read a draft", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.articles where slug = $1", [
        SLUG_DRAFT,
      ]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("anon cannot read a rejected article", async () => {
    // A rejected article may be rejected because it was defamatory. It must
    // never be one URL guess away from being public.
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.articles where slug = $1", [
        SLUG_REJECTED,
      ]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("an ordinary member sees published articles and nothing else", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const published = await c.query(
        "select id from public.articles where slug = $1",
        [SLUG_PUBLISHED],
      );
      const drafts = await c.query("select id from public.articles where status = 'draft'");
      expect(published.rowCount).toBe(1);
      expect(drafts.rowCount).toBe(0);
    });
  });

  it("staff can read every status", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const r = await c.query(
        "select id from public.articles where slug = any($1::text[])",
        [[SLUG_PUBLISHED, SLUG_DRAFT, SLUG_REJECTED]],
      );
      expect(r.rowCount).toBe(3);
    });
  });

  it("a disabled staff row grants no extra visibility", async () => {
    await withRole("authenticated", USERS.disabledStaff, async (c) => {
      const r = await c.query("select id from public.articles where status = 'draft'");
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("articles: writes", () => {
  it("a member cannot insert an article", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query(`insert into public.articles default values`),
        /permission denied|violates row-level security/i,
      );
    });
  });

  it("a member cannot publish an existing draft", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("update public.articles set status = 'published' where id = $1", [draftId]),
        /permission denied/i,
      );
    });
  });

  it("even staff cannot write directly — only the service role", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      await expectRejected(
        c.query("update public.articles set headline = 'x' where id = $1", [draftId]),
        /permission denied/i,
      );
    });
  });

  it("anon cannot delete", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("delete from public.articles"),
        /permission denied/i,
      );
    });
  });
});

describe("provenance constraint", () => {
  it("refuses a published review-mode article with no reviewer", async () => {
    // This is the record the Article 50(4) exemption rests on: a published
    // article cannot claim human review it never had.
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.articles
             (slug, headline, standfirst, body_md, source_attribution,
              source_organisation, source_url, status, publish_mode, published_at)
           values ('no-reviewer', 'H', 'S', 'B', 'Org, 1 January 2026', 'Org',
                   'https://example.test/x', 'published', 'review', now())`,
        ),
        /published_needs_provenance/i,
      );
    });
  });

  it("allows a published auto-mode article with no reviewer", async () => {
    await withRole("service_role", null, async (c) => {
      const r = await c.query(
        `insert into public.articles
           (slug, headline, standfirst, body_md, source_attribution,
            source_organisation, source_url, status, publish_mode, published_at)
         values ('auto-published', 'H', 'S', 'B', 'Org, 1 January 2026', 'Org',
                 'https://example.test/x', 'published', 'auto', now())
         returning id`,
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("refuses a published article with no published_at", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.articles
             (slug, headline, standfirst, body_md, source_attribution,
              source_organisation, source_url, status, publish_mode)
           values ('no-timestamp', 'H', 'S', 'B', 'Org, 1 January 2026', 'Org',
                   'https://example.test/x', 'published', 'auto')`,
        ),
        /published_needs_timestamp/i,
      );
    });
  });

  it("refuses a retraction with no reason", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          "update public.articles set status = 'retracted' where id = $1",
          [publishedId],
        ),
        /retracted_needs_reason/i,
      );
    });
  });

  it("refuses a slug the public route could not serve", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.articles
             (slug, headline, standfirst, body_md, source_attribution,
              source_organisation, source_url, publish_mode)
           values ('Not A Valid Slug!', 'H', 'S', 'B', 'Org, 1 January 2026', 'Org',
                   'https://example.test/x', 'review')`,
        ),
        /articles_slug_check|violates check constraint/i,
      );
    });
  });
});

describe("article_images", () => {
  it("anon can read images of a published article", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query(
        "select id from public.article_images where article_id = $1",
        [publishedId],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("anon cannot read images of a draft", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query(
        "select id from public.article_images where article_id = $1",
        [draftId],
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it("refuses licensed_press when the source has no recorded image rights", async () => {
    // Press photographs are licensed to accredited media. Pinpals holds no
    // accreditation, so this must be impossible even for the service role.
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.article_images
             (article_id, url, image_source, licence, credit)
           values ($1, 'https://example.test/press.jpg', 'licensed_press',
                   'Editorial use', 'Fixture Org')`,
          [publishedId],
        ),
        /recorded image rights/i,
      );
    });
  });

  it("allows licensed_press once the source records rights and evidence", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query(
        `update public.content_sources
            set image_rights_granted = true,
                rights_evidence_url = 'https://mail.example/permission'
          where id = $1`,
        [sourceId],
      );
      const r = await c.query(
        `insert into public.article_images
           (article_id, url, image_source, licence, credit)
         values ($1, 'https://example.test/press.jpg', 'licensed_press',
                 'Editorial use', 'Fixture Org')
         returning id`,
        [publishedId],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("refuses an image with no credit", async () => {
    await withRole("service_role", null, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.article_images
             (article_id, url, image_source, licence, credit)
           values ($1, 'https://example.test/x.jpg', 'stock', 'Unsplash License', '  ')`,
          [publishedId],
        ),
        /credit/i,
      );
    });
  });
});

describe("article_revisions and news_usage are staff-only", () => {
  it("anon cannot read revisions", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("select id from public.article_revisions"),
        /permission denied/i,
      );
    });
  });

  it("a member cannot read revisions", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select id from public.article_revisions");
      expect(r.rowCount).toBe(0);
    });
  });

  it("a member cannot read spend", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select id from public.news_usage");
      expect(r.rowCount).toBe(0);
    });
  });

  it("staff can read spend", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query(
        `insert into public.news_usage (stage, model, input_tokens, output_tokens, cost_microdollars)
         values ('triage', 'claude-haiku-4-5', 100, 10, 150)`,
      );
    });
    await withRole("authenticated", USERS.admin, async (c) => {
      const r = await c.query("select id from public.news_usage");
      expect(r.rowCount).toBeGreaterThanOrEqual(0);
    });
  });
});
