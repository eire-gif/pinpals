// 0088_member_feed.sql.
//
// The feed is the first surface in PinPals where one member's content is
// shown to members they have never met, so the boundaries here are the
// whole feature: who can see a post, its photos, its likes and its comments;
// what a block does to each; and which columns a member can write. None of
// these is visible on a screen when it is wrong — a post leaking to a
// stranger looks exactly like a post — so they are asserted here.
//
// Cast, throughout:
//   seller1  the author
//   buyer1   connected to seller1 (seeded per test, rolled back)
//   buyer2   a member with no relationship to seller1
//   seller2  blocked by seller1 in the tests that need a block
//   moderator  staff — and staff get NO special read path here, by design:
//              moderation runs through the service role in the admin tools.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, expectRejected, expectZeroRows, closePool, pool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

async function asService<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

async function connect(c: PoolClient, a: string, b: string): Promise<void> {
  await asService(c, () =>
    c.query(
      `insert into public.connections (requester_id, recipient_id, status)
       values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
       do update set status = 'accepted'`,
      [a, b],
    ),
  );
}

async function block(c: PoolClient, blocker: string, blocked: string): Promise<void> {
  await asService(c, () =>
    c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2) on conflict do nothing", [
      blocker,
      blocked,
    ]),
  );
}

/** Posts as `author`, through the member's own grants and policy — so every
 *  test that uses this is also a test that authors can post. */
async function post(
  c: PoolClient,
  author: string,
  visibility: "members" | "connections" = "members",
  body = "Great day at Portmarnock",
): Promise<string> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [author]);
  const { rows } = await c.query<{ id: string }>(
    "insert into public.posts (author_id, body, visibility) values ($1, $2, $3) returning id",
    [author, body, visibility],
  );
  return rows[0].id;
}

/** expectRejected inside a savepoint, so one transaction can assert several
 *  refusals — a failed statement otherwise aborts everything after it. */
async function refused(c: PoolClient, sql: string, params: unknown[], pattern: RegExp): Promise<void> {
  await c.query("savepoint refusal");
  await expectRejected(c.query(sql, params), pattern);
  await c.query("rollback to savepoint refusal");
}

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

async function canSee(c: PoolClient, postId: string): Promise<boolean> {
  const viaPolicy = await c.query("select 1 from public.posts where id = $1", [postId]);
  const viaFn = await c.query<{ ok: boolean }>("select public.can_view_post($1) as ok", [postId]);
  // The inline SELECT policy and can_view_post() must say the same thing.
  // If they ever disagree, a member could read a post whose photos, likes
  // and comments are refused to them, or the reverse.
  expect(viaPolicy.rowCount === 1).toBe(viaFn.rows[0].ok);
  return viaFn.rows[0].ok;
}

// ---------------------------------------------------------------------------

describe("who can see a post", () => {
  it("a post to all members is visible to any signed-in member", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1, "members");
      for (const viewer of [USERS.seller1, USERS.buyer1, USERS.buyer2, USERS.moderator]) {
        await as(c, viewer);
        expect(await canSee(c, id)).toBe(true);
      }
    });
  });

  it("a connections-only post is visible to its author and their connections, and nobody else", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await connect(c, USERS.seller1, USERS.buyer1);
      const id = await post(c, USERS.seller1, "connections");

      await as(c, USERS.seller1);
      expect(await canSee(c, id)).toBe(true);
      await as(c, USERS.buyer1);
      expect(await canSee(c, id)).toBe(true);
      await as(c, USERS.buyer2);
      expect(await canSee(c, id)).toBe(false);
      // Staff are members here, not moderators: no bypass.
      await as(c, USERS.moderator);
      expect(await canSee(c, id)).toBe(false);
    });
  });

  it("a pending connection request is not a connection", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await asService(c, () =>
        c.query(
          "insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'pending')",
          [USERS.buyer2, USERS.seller1],
        ),
      );
      const id = await post(c, USERS.seller1, "connections");
      await as(c, USERS.buyer2);
      expect(await canSee(c, id)).toBe(false);
    });
  });

  it("a block hides posts in both directions, even posts to all members", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const mine = await post(c, USERS.seller1, "members");
      const theirs = await post(c, USERS.seller2, "members");
      await block(c, USERS.seller1, USERS.seller2);

      await as(c, USERS.seller2);
      expect(await canSee(c, mine)).toBe(false);
      await as(c, USERS.seller1);
      expect(await canSee(c, theirs)).toBe(false);
    });
  });

  it("a block outranks a connection", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await connect(c, USERS.seller1, USERS.buyer1);
      const id = await post(c, USERS.seller1, "connections");
      await block(c, USERS.buyer1, USERS.seller1);
      await as(c, USERS.buyer1);
      expect(await canSee(c, id)).toBe(false);
    });
  });

  it("a hidden post disappears for everyone except its author", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1, "members");
      await asService(c, () => c.query("update public.posts set hidden_at = now() where id = $1", [id]));

      await as(c, USERS.buyer2);
      expect(await canSee(c, id)).toBe(false);
      await as(c, USERS.seller1);
      expect(await canSee(c, id)).toBe(true);
    });
  });

  it("anonymous visitors see nothing and cannot ask", async () => {
    let id = "";
    await withRole("authenticated", USERS.seller1, async (c) => {
      id = await post(c, USERS.seller1, "members");
      await c.query("set local role anon");
      await expectRejected(c.query("select * from public.posts"), /permission denied/);
    });
    await withRole("anon", null, async (c) => {
      await expectRejected(c.query("select public.can_view_post($1)", [id || "1"]), /permission denied/);
    });
  });

  it("can_view_post() is false, never null, for a post that does not exist", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { rows } = await c.query<{ ok: boolean | null }>("select public.can_view_post(999999999) as ok");
      expect(rows[0].ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------

describe("writing posts", () => {
  it("a member cannot post as somebody else", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await refused(c, "insert into public.posts (author_id, body) values ($1, 'hi')", [USERS.seller1], /row-level security/);
    });
  });

  it("a member cannot write the counts or the moderation columns, on insert or update", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await refused(c, "insert into public.posts (author_id, body, like_count) values ($1, 'hi', 4000)", [USERS.seller1], /permission denied/);
      const id = await post(c, USERS.seller1);
      await refused(c, "update public.posts set like_count = 4000 where id = $1", [id], /permission denied/);
      await refused(c, "update public.posts set hidden_at = null where id = $1", [id], /permission denied/);
      await refused(c, "update public.posts set created_at = now() - interval '1 year' where id = $1", [id], /permission denied/);
    });
  });

  it("an author edits their own caption and audience; nobody else can", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      const own = await c.query(
        "update public.posts set body = 'edited', visibility = 'connections' where id = $1",
        [id],
      );
      expect(own.rowCount).toBe(1);

      await as(c, USERS.buyer2);
      // Not visible to buyer2 any more (connections-only), and not theirs
      // regardless — zero rows either way.
      expectZeroRows(await c.query("update public.posts set body = 'vandalised' where id = $1", [id]));
    });
  });

  it("an author can delete their own post; nobody else can", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      expectZeroRows(await c.query("delete from public.posts where id = $1", [id]));
      await as(c, USERS.seller1);
      expect((await c.query("delete from public.posts where id = $1", [id])).rowCount).toBe(1);
    });
  });

  it("visibility must be one of the two audiences", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await refused(c, "insert into public.posts (author_id, body, visibility) values ($1, 'x', 'public')", [USERS.seller1], /check constraint/);
    });
  });
});

// ---------------------------------------------------------------------------

describe("photos", () => {
  it("members cannot write post_images rows at all", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await refused(c, "insert into public.post_images (post_id, path, position) values ($1, $2, 0)", [id, `${id}/a.jpg`], /permission denied/);
    });
  });

  it("post_images and the storage objects follow the post's visibility", async () => {
    // Committed (not rolled back) so the storage rows are visible to the
    // assertion's transactions; removed again in the finally.
    const setup = await pool.connect();
    let postId = "";
    try {
      const { rows } = await setup.query<{ id: string }>(
        "insert into public.posts (author_id, body, visibility) values ($1, 'photo', 'connections') returning id",
        [USERS.seller1],
      );
      postId = rows[0].id;
      await setup.query("insert into public.post_images (post_id, path, position) values ($1, $2, 0)", [
        postId,
        `${postId}/one.jpg`,
      ]);
      await setup.query("insert into storage.objects (bucket_id, name) values ('post-images', $1)", [
        `${postId}/one.jpg`,
      ]);
      await setup.query(
        "insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')",
        [USERS.seller1, USERS.buyer1],
      );
    } finally {
      setup.release();
    }

    try {
      for (const [viewer, expected] of [
        [USERS.seller1, 1],
        [USERS.buyer1, 1],
        [USERS.buyer2, 0],
        [USERS.moderator, 0],
      ] as const) {
        await withRole("authenticated", viewer, async (c) => {
          const images = await c.query("select 1 from public.post_images where post_id = $1", [postId]);
          expect(images.rowCount).toBe(expected);
          const objects = await c.query(
            "select 1 from storage.objects where bucket_id = 'post-images' and name = $1",
            [`${postId}/one.jpg`],
          );
          expect(objects.rowCount).toBe(expected);
        });
      }

      await withRole("authenticated", USERS.seller1, async (c) => {
        await refused(c, "insert into storage.objects (bucket_id, name) values ('post-images', $1)", [`${postId}/two.jpg`], /row-level security/);
      });
    } finally {
      const cleanup = await pool.connect();
      try {
        await cleanup.query("delete from storage.objects where bucket_id = 'post-images' and name like $1", [
          `${postId}/%`,
        ]);
        await cleanup.query("delete from public.posts where id = $1", [postId]);
        await cleanup.query(
          "delete from public.connections where requester_id = $1 and recipient_id = $2",
          [USERS.seller1, USERS.buyer1],
        );
      } finally {
        cleanup.release();
      }
    }
  });

  it("a storage object whose folder is not a post id is refused, not an error", async () => {
    const setup = await pool.connect();
    try {
      await setup.query("insert into storage.objects (bucket_id, name) values ('post-images', 'not-a-number/x.jpg')");
    } finally {
      setup.release();
    }
    try {
      await withRole("authenticated", USERS.buyer1, async (c) => {
        const r = await c.query("select 1 from storage.objects where bucket_id = 'post-images'");
        expect(r.rowCount).toBe(0);
      });
    } finally {
      const cleanup = await pool.connect();
      try {
        await cleanup.query("delete from storage.objects where bucket_id = 'post-images' and name = 'not-a-number/x.jpg'");
      } finally {
        cleanup.release();
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe("likes", () => {
  it("liking increments the count and unliking decrements it", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      await c.query("insert into public.post_likes (post_id, user_id) values ($1, $2)", [id, USERS.buyer1]);
      await as(c, USERS.buyer2);
      await c.query("insert into public.post_likes (post_id, user_id) values ($1, $2)", [id, USERS.buyer2]);

      const count = async () =>
        (await c.query<{ like_count: number }>("select like_count from public.posts where id = $1", [id])).rows[0]
          .like_count;
      expect(await count()).toBe(2);

      await c.query("delete from public.post_likes where post_id = $1 and user_id = $2", [id, USERS.buyer2]);
      expect(await count()).toBe(1);
    });
  });

  it("you can like a post only once", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      await c.query("insert into public.post_likes (post_id, user_id) values ($1, $2)", [id, USERS.buyer1]);
      await refused(c, "insert into public.post_likes (post_id, user_id) values ($1, $2)", [id, USERS.buyer1], /duplicate key/);
    });
  });

  it("you cannot like a post you cannot see, or like as somebody else", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const hidden = await post(c, USERS.seller1, "connections");
      const open = await post(c, USERS.seller1, "members");
      await as(c, USERS.buyer2);
      await refused(c, "insert into public.post_likes (post_id, user_id) values ($1, $2)", [hidden, USERS.buyer2], /row-level security/);
      await refused(c, "insert into public.post_likes (post_id, user_id) values ($1, $2)", [open, USERS.buyer1], /row-level security/);
    });
  });

  it("you cannot remove somebody else's like", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      await c.query("insert into public.post_likes (post_id, user_id) values ($1, $2)", [id, USERS.buyer1]);
      await as(c, USERS.seller1);
      expectZeroRows(await c.query("delete from public.post_likes where post_id = $1 and user_id = $2", [id, USERS.buyer1]));
    });
  });

  it("likes on a post you cannot see are invisible to you", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await connect(c, USERS.seller1, USERS.buyer1);
      const id = await post(c, USERS.seller1, "connections");
      await as(c, USERS.buyer1);
      await c.query("insert into public.post_likes (post_id, user_id) values ($1, $2)", [id, USERS.buyer1]);
      await as(c, USERS.buyer2);
      expectZeroRows(await c.query("select 1 from public.post_likes where post_id = $1", [id]));
    });
  });
});

// ---------------------------------------------------------------------------

describe("comments", () => {
  it("a member comments on a post they can see, and the count follows", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      await c.query("insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'Shot!')", [
        id,
        USERS.buyer1,
      ]);
      const { rows } = await c.query<{ comment_count: number }>("select comment_count from public.posts where id = $1", [
        id,
      ]);
      expect(rows[0].comment_count).toBe(1);
    });
  });

  it("a member cannot comment on a post they cannot see, or as somebody else", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const hidden = await post(c, USERS.seller1, "connections");
      const open = await post(c, USERS.seller1);
      await as(c, USERS.buyer2);
      await refused(c, "insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'x')", [hidden, USERS.buyer2], /row-level security/);
      await refused(c, "insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'x')", [open, USERS.buyer1], /row-level security/);
    });
  });

  it("an empty or whitespace comment is refused", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await refused(c, "insert into public.post_comments (post_id, author_id, body) values ($1, $2, '   ')", [id, USERS.seller1], /check constraint/);
    });
  });

  it("members cannot edit comments or set their moderation flag", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      const { rows } = await c.query<{ id: string }>(
        "insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'first') returning id",
        [id, USERS.seller1],
      );
      await refused(c, "update public.post_comments set body = 'changed' where id = $1", [rows[0].id], /permission denied/);
      await refused(
        c,
        "insert into public.post_comments (post_id, author_id, body, hidden_at) values ($1, $2, 'x', now())",
        [id, USERS.seller1],
        /permission denied/,
      );
    });
  });

  it("a comment is deletable by its author and by the post's author, not by anyone else", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      const insert = async () =>
        (
          await c.query<{ id: string }>(
            "insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'hello') returning id",
            [id, USERS.buyer1],
          )
        ).rows[0].id;

      const a = await insert();
      const b = await insert();

      await as(c, USERS.buyer2);
      expectZeroRows(await c.query("delete from public.post_comments where id = $1", [a]));

      await as(c, USERS.buyer1);
      expect((await c.query("delete from public.post_comments where id = $1", [a])).rowCount).toBe(1);

      await as(c, USERS.seller1);
      expect((await c.query("delete from public.post_comments where id = $1", [b])).rowCount).toBe(1);

      const { rows } = await c.query<{ comment_count: number }>("select comment_count from public.posts where id = $1", [
        id,
      ]);
      expect(rows[0].comment_count).toBe(0);
    });
  });

  it("a comment by someone you have blocked is hidden from you, on a third member's post", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.buyer2, "members");
      await as(c, USERS.seller2);
      await c.query("insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'hi all')", [
        id,
        USERS.seller2,
      ]);
      await block(c, USERS.seller1, USERS.seller2);

      await as(c, USERS.seller1);
      expectZeroRows(await c.query("select 1 from public.post_comments where post_id = $1", [id]));
      // Everyone else still sees it.
      await as(c, USERS.buyer1);
      expect((await c.query("select 1 from public.post_comments where post_id = $1", [id])).rowCount).toBe(1);
    });
  });

  it("a hidden comment leaves the count, and is still visible to the person who wrote it", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      const { rows } = await c.query<{ id: string }>(
        "insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'rude') returning id",
        [id, USERS.buyer1],
      );
      await asService(c, () => c.query("update public.post_comments set hidden_at = now() where id = $1", [rows[0].id]));

      const count = await c.query<{ comment_count: number }>("select comment_count from public.posts where id = $1", [id]);
      expect(count.rows[0].comment_count).toBe(0);

      expect((await c.query("select 1 from public.post_comments where id = $1", [rows[0].id])).rowCount).toBe(1);
      await as(c, USERS.buyer2);
      expectZeroRows(await c.query("select 1 from public.post_comments where id = $1", [rows[0].id]));

      // Un-hiding puts it back on the count.
      await asService(c, () => c.query("update public.post_comments set hidden_at = null where id = $1", [rows[0].id]));
      const again = await c.query<{ comment_count: number }>("select comment_count from public.posts where id = $1", [id]);
      expect(again.rows[0].comment_count).toBe(1);
    });
  });

  it("deleting a post takes its likes and comments with it", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      await c.query("insert into public.post_likes (post_id, user_id) values ($1, $2)", [id, USERS.buyer1]);
      await c.query("insert into public.post_comments (post_id, author_id, body) values ($1, $2, 'x')", [id, USERS.buyer1]);
      await as(c, USERS.seller1);
      await c.query("delete from public.posts where id = $1", [id]);
      await asService(c, async () => {
        expect((await c.query("select 1 from public.post_likes where post_id = $1", [id])).rowCount).toBe(0);
        expect((await c.query("select 1 from public.post_comments where post_id = $1", [id])).rowCount).toBe(0);
      });
    });
  });
});

// ---------------------------------------------------------------------------

describe("reporting and preferences", () => {
  it("a post and a comment are reportable targets", async () => {
    await withRole("service_role", null, async (c) => {
      for (const target of ["post", "post_comment"]) {
        await c.query(
          `insert into public.reports (reporter_id, target_type, target_id, category)
           values ($1, $2, '1', 'other')`,
          [USERS.buyer1, target],
        );
      }
    });
  });

  it("'feed' is a notification preference a member can turn off", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await c.query(
        "insert into public.notification_preferences (user_id, category, email_enabled, push_enabled) values ($1, 'feed', false, false)",
        [USERS.buyer1],
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 0092 — replies to comments
// ---------------------------------------------------------------------------

async function comment(c: PoolClient, postId: string, author: string, body: string, parent: string | null = null) {
  await as(c, author);
  const { rows } = await c.query<{ id: string; parent_id: string | null }>(
    "insert into public.post_comments (post_id, author_id, body, parent_id) values ($1, $2, $3, $4) returning id, parent_id",
    [postId, author, body, parent],
  );
  return rows[0];
}

describe("replies to comments", () => {
  it("a member replies to a comment; the reply carries its parent and counts", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const p = await post(c, USERS.seller1);
      const top = await comment(c, p, USERS.buyer1, "Shot!");
      const reply = await comment(c, p, USERS.buyer2, "It was", top.id);
      expect(reply.parent_id).toBe(top.id);
      const { rows } = await c.query<{ comment_count: number }>("select comment_count from public.posts where id = $1", [p]);
      expect(rows[0].comment_count).toBe(2);
    });
  });

  it("a reply to a reply joins the same thread, one level deep", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const p = await post(c, USERS.seller1);
      const top = await comment(c, p, USERS.buyer1, "Shot!");
      const first = await comment(c, p, USERS.buyer2, "Agreed", top.id);
      const second = await comment(c, p, USERS.seller1, "Thanks both", first.id);
      expect(second.parent_id).toBe(top.id);
    });
  });

  it("refuses a parent on a different post", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const p1 = await post(c, USERS.seller1);
      const p2 = await post(c, USERS.seller1);
      const top = await comment(c, p1, USERS.buyer1, "On the first");
      await as(c, USERS.buyer2);
      await refused(
        c,
        "insert into public.post_comments (post_id, author_id, body, parent_id) values ($1, $2, 'x', $3)",
        [p2, USERS.buyer2, top.id],
        /no longer available/,
      );
    });
  });

  it("refuses replying to someone you have blocked or who blocked you", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const p = await post(c, USERS.seller1);
      const top = await comment(c, p, USERS.buyer1, "Shot!");
      await block(c, USERS.buyer1, USERS.buyer2);
      await as(c, USERS.buyer2);
      await refused(
        c,
        "insert into public.post_comments (post_id, author_id, body, parent_id) values ($1, $2, 'x', $3)",
        [p, USERS.buyer2, top.id],
        /no longer available/,
      );
    });
  });

  it("refuses replying to a comment a moderator has hidden", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const p = await post(c, USERS.seller1);
      const top = await comment(c, p, USERS.buyer1, "Shot!");
      await asService(c, () => c.query("update public.post_comments set hidden_at = now() where id = $1", [top.id]));
      await as(c, USERS.buyer2);
      await refused(
        c,
        "insert into public.post_comments (post_id, author_id, body, parent_id) values ($1, $2, 'x', $3)",
        [p, USERS.buyer2, top.id],
        /no longer available/,
      );
    });
  });

  it("deleting a comment takes its replies with it, and the count follows", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const p = await post(c, USERS.seller1);
      const top = await comment(c, p, USERS.buyer1, "Shot!");
      await comment(c, p, USERS.buyer2, "Agreed", top.id);
      await comment(c, p, USERS.seller1, "Cheers", top.id);
      await as(c, USERS.buyer1);
      await c.query("delete from public.post_comments where id = $1", [top.id]);
      const { rows } = await c.query<{ comment_count: number }>("select comment_count from public.posts where id = $1", [p]);
      expect(rows[0].comment_count).toBe(0);
    });
  });
});
