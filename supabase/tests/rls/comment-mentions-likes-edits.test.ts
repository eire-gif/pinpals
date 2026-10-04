// 0097_comment_mentions_likes_edits.sql.
//
// Mentions are cleaned by the database (only people the commenter may name,
// who can see the post), comment likes follow comment visibility, and edits
// are the author's alone, mark the comment edited, and never touch a hidden
// comment or any column but the body.
//
// Cast:
//   seller1  the post's author
//   buyer1   a commenter, connected to seller2 in the tests that need it
//   buyer2   a stranger to everyone
//   seller2  buyer1's connection
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

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
    c.query("insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')", [a, b]),
  );
}

async function post(c: PoolClient, visibility = "members"): Promise<string> {
  await as(c, USERS.seller1);
  const { rows } = await c.query<{ id: string }>(
    "insert into public.posts (author_id, body, visibility) values ($1, 'Back nine at Old Head', $2) returning id",
    [USERS.seller1, visibility],
  );
  return rows[0].id;
}

async function comment(c: PoolClient, postId: string, author: string, mentions: string[] = [], body = "Great shot") {
  await as(c, author);
  const { rows } = await c.query<{ id: string; mentions: string[] }>(
    "insert into public.post_comments (post_id, author_id, body, mentions) values ($1, $2, $3, $4::uuid[]) returning id, mentions",
    [postId, author, body, mentions],
  );
  return rows[0];
}

async function refused(c: PoolClient, sql: string, params: unknown[], pattern: RegExp): Promise<void> {
  await c.query("savepoint refusal");
  await expectRejected(c.query(sql, params), pattern);
  await c.query("rollback to savepoint refusal");
}

describe("comment mentions", () => {
  it("keeps the post's author, a connection and someone in the thread; drops a stranger and yourself", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      await connect(c, USERS.buyer1, USERS.seller2);
      await comment(c, id, USERS.seller2, [], "First!");
      const mine = await comment(c, id, USERS.buyer1, [USERS.seller1, USERS.seller2, USERS.buyer2, USERS.buyer1, USERS.seller1]);
      expect(mine.mentions).toEqual([USERS.seller1, USERS.seller2]);
    });
  });

  it("a connection who can't see a connections-only post isn't kept", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await connect(c, USERS.seller1, USERS.buyer1);
      await connect(c, USERS.buyer1, USERS.buyer2);
      const id = await post(c, "connections");
      const mine = await comment(c, id, USERS.buyer1, [USERS.buyer2, USERS.seller1]);
      expect(mine.mentions).toEqual([USERS.seller1]);
    });
  });

  it("nobody blocked either way is kept", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      await asService(c, () =>
        c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [USERS.seller1, USERS.buyer1]),
      );
      // buyer1 can't see the post now, so comments as someone else instead:
      await connect(c, USERS.buyer2, USERS.buyer1);
      const mine = await comment(c, id, USERS.buyer2, [USERS.buyer1, USERS.seller1]);
      expect(mine.mentions).toEqual([USERS.seller1]);
    });
  });

  it("mentions can't be changed after posting", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      const mine = await comment(c, id, USERS.buyer1, [USERS.seller1]);
      await refused(c, "update public.post_comments set mentions = '{}' where id = $1", [mine.id], /permission denied/);
    });
  });
});

describe("editing comments", () => {
  it("the author can change the body, and it's marked edited", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      const mine = await comment(c, id, USERS.buyer1);
      const before = await c.query("select edited_at from public.post_comments where id = $1", [mine.id]);
      expect(before.rows[0].edited_at).toBeNull();
      const done = await c.query("update public.post_comments set body = 'Great shot — what club?' where id = $1", [mine.id]);
      expect(done.rowCount).toBe(1);
      const after = await c.query("select body, edited_at from public.post_comments where id = $1", [mine.id]);
      expect(after.rows[0].body).toBe("Great shot — what club?");
      expect(after.rows[0].edited_at).not.toBeNull();
    });
  });

  it("nobody else can, the post's author included", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      const mine = await comment(c, id, USERS.buyer1);
      await as(c, USERS.seller1);
      const r = await c.query("update public.post_comments set body = 'rewritten' where id = $1", [mine.id]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("a hidden comment can't be edited, and only the body is editable", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      const mine = await comment(c, id, USERS.buyer1);
      await refused(c, "update public.post_comments set like_count = 99 where id = $1", [mine.id], /permission denied/);
      await refused(c, "update public.post_comments set edited_at = null where id = $1", [mine.id], /permission denied/);
      await asService(c, () => c.query("update public.post_comments set hidden_at = now() where id = $1", [mine.id]));
      await as(c, USERS.buyer1);
      const r = await c.query("update public.post_comments set body = 'innocent now' where id = $1", [mine.id]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("an edit still has to be a real comment", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      const mine = await comment(c, id, USERS.buyer1);
      await refused(c, "update public.post_comments set body = '   ' where id = $1", [mine.id], /check constraint/);
    });
  });
});

describe("comment likes", () => {
  it("anyone who can see a comment can like it once, and the count follows", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      const mine = await comment(c, id, USERS.buyer1);
      for (const who of [USERS.seller1, USERS.buyer2]) {
        await as(c, who);
        await c.query("insert into public.post_comment_likes (comment_id, user_id) values ($1, $2)", [mine.id, who]);
      }
      await refused(
        c,
        "insert into public.post_comment_likes (comment_id, user_id) values ($1, $2)",
        [mine.id, USERS.buyer2],
        /duplicate key/,
      );
      const { rows } = await c.query("select like_count from public.post_comments where id = $1", [mine.id]);
      expect(rows[0].like_count).toBe(2);

      await c.query("delete from public.post_comment_likes where comment_id = $1 and user_id = $2", [mine.id, USERS.buyer2]);
      const after = await c.query("select like_count from public.post_comments where id = $1", [mine.id]);
      expect(after.rows[0].like_count).toBe(1);
    });
  });

  it("can't like as someone else, or a comment you can't see", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, "connections");
      const own = await comment(c, id, USERS.seller1);
      await as(c, USERS.buyer2);
      await refused(
        c,
        "insert into public.post_comment_likes (comment_id, user_id) values ($1, $2)",
        [own.id, USERS.buyer2],
        /row-level security/,
      );
      await as(c, USERS.seller1);
      await refused(
        c,
        "insert into public.post_comment_likes (comment_id, user_id) values ($1, $2)",
        [own.id, USERS.buyer1],
        /row-level security/,
      );
    });
  });

  it("likes on a comment you can't see are invisible to you", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, "connections");
      const own = await comment(c, id, USERS.seller1);
      await c.query("insert into public.post_comment_likes (comment_id, user_id) values ($1, $2)", [own.id, USERS.seller1]);
      await as(c, USERS.buyer2);
      const { rowCount } = await c.query("select 1 from public.post_comment_likes where comment_id = $1", [own.id]);
      expect(rowCount).toBe(0);
    });
  });

  it("anon has no access", async () => {
    await withRole("anon", null, async (c) => {
      await refused(c, "select 1 from public.post_comment_likes", [], /permission denied/);
    });
  });
});
