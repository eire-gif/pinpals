// 0102_post_videos.sql: one short video on a post.
//
// The same rules as post photos: members can't write the rows or put files
// in the bucket; the row and the file are readable exactly when the post is
// (audience, blocks, moderation); a staged file under pending/ is readable
// by nobody; one video per post.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, expectRejected, closePool, pool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

async function refused(c: PoolClient, sql: string, params: unknown[], pattern: RegExp): Promise<void> {
  await c.query("savepoint refusal");
  await expectRejected(c.query(sql, params), pattern);
  await c.query("rollback to savepoint refusal");
}

describe("post_videos", () => {
  it("the bucket exists, private, 50 MB, MP4 and QuickTime only", async () => {
    const c = await pool.connect();
    try {
      const { rows } = await c.query(
        "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'post-videos'",
      );
      expect(rows).toEqual([{ public: false, file_size_limit: "52428800", allowed_mime_types: ["video/mp4", "video/quicktime"] }]);
    } finally {
      c.release();
    }
  });

  it("members cannot write post_videos rows or upload into the bucket themselves", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "insert into public.posts (author_id, body, visibility) values ($1, 'video', 'members') returning id",
        [USERS.seller1],
      );
      const id = rows[0].id;
      await refused(c, "insert into public.post_videos (post_id, path) values ($1, $2)", [id, `${id}/a.mp4`], /permission denied/);
      await refused(
        c,
        "insert into storage.objects (bucket_id, name) values ('post-videos', $1)",
        [`pending/${USERS.seller1}/a.mp4`],
        /row-level security/,
      );
    });
  });

  it("the row and the file follow the post's visibility; staged files are nobody's", async () => {
    // Committed so the assertions' own transactions see it; removed in finally.
    const setup = await pool.connect();
    let postId = "";
    const staged = `pending/${USERS.seller1}/00000000-0000-0000-0000-00000000000a.mp4`;
    try {
      const { rows } = await setup.query<{ id: string }>(
        "insert into public.posts (author_id, body, visibility) values ($1, 'swing', 'connections') returning id",
        [USERS.seller1],
      );
      postId = rows[0].id;
      await setup.query("insert into public.post_videos (post_id, path, duration_ms) values ($1, $2, 24000)", [postId, `${postId}/one.mp4`]);
      await setup.query("insert into storage.objects (bucket_id, name) values ('post-videos', $1), ('post-videos', $2)", [
        `${postId}/one.mp4`,
        staged,
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
      ] as const) {
        await withRole("authenticated", viewer, async (c) => {
          const rows = await c.query("select 1 from public.post_videos where post_id = $1", [postId]);
          expect(rows.rowCount).toBe(expected);
          const file = await c.query("select 1 from storage.objects where bucket_id = 'post-videos' and name = $1", [`${postId}/one.mp4`]);
          expect(file.rowCount).toBe(expected);
          // Not even its uploader can read a staged file through the API.
          const pending = await c.query("select 1 from storage.objects where bucket_id = 'post-videos' and name = $1", [staged]);
          expect(pending.rowCount).toBe(0);
        });
      }

      // Hidden by moderation: gone for everyone but the author.
      const mod = await pool.connect();
      try {
        await mod.query("update public.posts set hidden_at = now() where id = $1", [postId]);
      } finally {
        mod.release();
      }
      await withRole("authenticated", USERS.buyer1, async (c) => {
        const rows = await c.query("select 1 from public.post_videos where post_id = $1", [postId]);
        expect(rows.rowCount).toBe(0);
      });
    } finally {
      const cleanup = await pool.connect();
      try {
        await cleanup.query("delete from storage.objects where bucket_id = 'post-videos' and (name like $1 or name = $2)", [`${postId}/%`, staged]);
        await cleanup.query("delete from public.posts where id = $1", [postId]);
        await cleanup.query("delete from public.connections where requester_id = $1 and recipient_id = $2", [USERS.seller1, USERS.buyer1]);
      } finally {
        cleanup.release();
      }
    }
  });

  it("one video per post, and no more than 31 seconds", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const { rows } = await c.query<{ id: string }>(
        "insert into public.posts (author_id, body, visibility) values ($1, 'x', 'members') returning id",
        [USERS.seller1],
      );
      const id = rows[0].id;
      await c.query("insert into public.post_videos (post_id, path, duration_ms) values ($1, $2, 30000)", [id, `${id}/a.mp4`]);
      await c.query("savepoint s");
      await expectRejected(c.query("insert into public.post_videos (post_id, path) values ($1, $2)", [id, `${id}/b.mp4`]), /duplicate key|unique/);
      await c.query("rollback to savepoint s");
      await expectRejected(
        c.query("update public.post_videos set duration_ms = 45000 where post_id = $1", [id]),
        /check constraint/,
      );
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});
