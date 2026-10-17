// 0166_post_shares_and_reposts.sql — share counts and "Share to your feed".
//
// Shares are counted per member per channel, through record_post_share()
// only, for posts the caller can see; nobody reads anyone else's shares;
// reposts point at the original, only of posts shared with all members, and
// count as a 'feed' share that goes away with the repost.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

async function post(c: PoolClient, author: string, visibility = "members"): Promise<string> {
  await as(c, author);
  const { rows } = await c.query<{ id: string }>(
    "insert into public.posts (author_id, body, visibility) values ($1, 'The 10th at Ballybunion', $2) returning id",
    [author, visibility],
  );
  return rows[0].id;
}

async function shareCount(c: PoolClient, id: string): Promise<number> {
  const { rows } = await c.query<{ share_count: number }>("select share_count from public.posts where id = $1", [id]);
  return rows[0].share_count;
}

async function refused(c: PoolClient, sql: string, params: unknown[], pattern: RegExp): Promise<void> {
  await c.query("savepoint refusal");
  await expectRejected(c.query(sql, params), pattern);
  await c.query("rollback to savepoint refusal");
}

describe("post shares", () => {
  it("counts one share per member per channel, however often it's tapped", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      await c.query("select public.record_post_share($1, 'whatsapp')", [id]);
      await c.query("select public.record_post_share($1, 'whatsapp')", [id]);
      const { rows } = await c.query<{ n: number }>("select public.record_post_share($1, 'pinpals') as n", [id]);
      expect(rows[0].n).toBe(2);
      await as(c, USERS.buyer2);
      await c.query("select public.record_post_share($1, 'copy_link')", [id]);
      expect(await shareCount(c, id)).toBe(3);
    });
  });

  it("refuses an unknown channel, 'feed', and a post the caller can't see", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const open = await post(c, USERS.seller1);
      const closed = await post(c, USERS.seller1, "connections");
      await as(c, USERS.buyer1);
      await refused(c, "select public.record_post_share($1, 'carrier_pigeon')", [open], /isn't a way to share/);
      await refused(c, "select public.record_post_share($1, 'feed')", [open], /isn't a way to share/);
      // buyer1 and seller1 aren't connected in the fixtures.
      await refused(c, "select public.record_post_share($1, 'whatsapp')", [closed], /no longer available/);
      expect(await shareCount(c, open)).toBe(0);
    });
  });

  it("members can't write shares or the count directly, and only read their own", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      await refused(
        c,
        "insert into public.post_shares (post_id, user_id, channel) values ($1, $2, 'whatsapp')",
        [id, USERS.buyer1],
        /permission denied/,
      );
      await refused(c, "update public.posts set share_count = 99 where id = $1", [id], /permission denied/);
      await c.query("select public.record_post_share($1, 'email')", [id]);

      await as(c, USERS.seller1);
      const author = await c.query("select * from public.post_shares where post_id = $1", [id]);
      expect(author.rowCount).toBe(0);
      await as(c, USERS.buyer1);
      const mine = await c.query("select channel from public.post_shares where post_id = $1", [id]);
      expect(mine.rows.map((r) => r.channel)).toEqual(["email"]);
    });
  });
});

describe("reposts", () => {
  it("a repost counts as a 'feed' share, and deleting it takes the share back", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      const { rows } = await c.query<{ id: string }>(
        "insert into public.posts (author_id, body, shared_post_id) values ($1, 'Look at this', $2) returning id",
        [USERS.buyer1, id],
      );
      expect(await shareCount(c, id)).toBe(1);
      await c.query("delete from public.posts where id = $1", [rows[0].id]);
      expect(await shareCount(c, id)).toBe(0);
    });
  });

  it("members can't mark a post as a share themselves", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await as(c, USERS.buyer1);
      await refused(
        c,
        "insert into public.posts (author_id, body, is_repost) values ($1, 'x', true)",
        [USERS.buyer1],
        /permission denied/,
      );
    });
  });

  it("a repost of a repost points at the original", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      const first = await c.query<{ id: string }>(
        "insert into public.posts (author_id, body, shared_post_id) values ($1, '', $2) returning id",
        [USERS.buyer1, id],
      );
      await as(c, USERS.buyer2);
      const second = await c.query<{ shared_post_id: string }>(
        "insert into public.posts (author_id, body, shared_post_id) values ($1, '', $2) returning shared_post_id",
        [USERS.buyer2, first.rows[0].id],
      );
      expect(second.rows[0].shared_post_id).toBe(id);
      expect(await shareCount(c, id)).toBe(2);
    });
  });

  it("refuses connections-only and unseen posts, golf details, and changing it afterwards", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const closed = await post(c, USERS.seller1, "connections");
      const open = await post(c, USERS.seller1);
      // The author can see their own connections-only post, and still can't
      // push it to everyone.
      await refused(
        c,
        "insert into public.posts (author_id, body, shared_post_id) values ($1, '', $2)",
        [USERS.seller1, closed],
        /shared with all members/,
      );
      await as(c, USERS.buyer1);
      await refused(
        c,
        "insert into public.posts (author_id, body, shared_post_id) values ($1, '', $2)",
        [USERS.buyer1, closed],
        /no longer available/,
      );
      await refused(
        c,
        "insert into public.posts (author_id, body, kind, details, shared_post_id) values ($1, '', 'hole', '{\"hole\": 10, \"par\": 4, \"score\": 4}', $2)",
        [USERS.buyer1, open],
        /plain post/,
      );
      const { rows } = await c.query<{ id: string }>(
        "insert into public.posts (author_id, body, shared_post_id) values ($1, '', $2) returning id",
        [USERS.buyer1, open],
      );
      await refused(c, "update public.posts set shared_post_id = null where id = $1", [rows[0].id], /permission denied/);
    });
  });

  it("a share of a post the member can't see is refused before it's followed", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const open = await post(c, USERS.seller1);
      // seller2 shares it to their connections only; buyer1 isn't one.
      await as(c, USERS.seller2);
      const { rows } = await c.query<{ id: string }>(
        "insert into public.posts (author_id, body, visibility, shared_post_id) values ($1, 'x', 'connections', $2) returning id",
        [USERS.seller2, open],
      );
      await as(c, USERS.buyer1);
      await refused(
        c,
        "insert into public.posts (author_id, body, shared_post_id) values ($1, '', $2)",
        [USERS.buyer1, rows[0].id],
        /no longer available/,
      );
      await refused(
        c,
        "insert into public.posts (author_id, body, shared_post_id) values ($1, '', $2)",
        [USERS.buyer1, 999999999],
        /no longer available/,
      );
    });
  });

  it("deleting the original leaves the repost, pointing nowhere", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer1);
      const { rows } = await c.query<{ id: string }>(
        "insert into public.posts (author_id, body, shared_post_id) values ($1, 'Great hole', $2) returning id",
        [USERS.buyer1, id],
      );
      await as(c, USERS.seller1);
      await c.query("delete from public.posts where id = $1", [id]);
      await as(c, USERS.buyer1);
      const after = await c.query("select shared_post_id, is_repost from public.posts where id = $1", [rows[0].id]);
      expect(after.rows[0]).toEqual({ shared_post_id: null, is_repost: true });
    });
  });
});

describe("reactions and blocks", () => {
  it("a member on either side of a block doesn't see the other's reaction", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer2);
      await c.query("insert into public.post_likes (post_id, user_id) values ($1, $2)", [id, USERS.buyer2]);
      // buyer2 blocks buyer1.
      await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [USERS.buyer2, USERS.buyer1]);
      await as(c, USERS.buyer1);
      const hidden = await c.query("select user_id from public.post_likes where post_id = $1", [id]);
      expect(hidden.rowCount).toBe(0);
      await as(c, USERS.buyer2);
      const own = await c.query("select user_id from public.post_likes where post_id = $1", [id]);
      expect(own.rowCount).toBe(1);
      await as(c, USERS.seller1);
      const author = await c.query("select user_id from public.post_likes where post_id = $1", [id]);
      expect(author.rowCount).toBe(1);
    });
  });
});
