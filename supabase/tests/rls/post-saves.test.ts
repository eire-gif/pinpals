// 0094_post_saves.sql — the feed card's Save action.
//
// A save is a private bookmark: only its owner can read or remove it, nobody
// can save as someone else, and nobody can save a post they cannot see. The
// last one matters most — an insert that succeeded for a connections-only
// post would at least confirm the post exists.
//
// Cast:
//   seller1  the author
//   buyer1   connected to seller1 when a test needs it
//   buyer2   no relationship to seller1
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

async function post(c: PoolClient, author: string, visibility: "members" | "connections" = "members"): Promise<string> {
  await as(c, author);
  const { rows } = await c.query<{ id: string }>(
    "insert into public.posts (author_id, body, visibility) values ($1, 'Back nine at Old Head', $2) returning id",
    [author, visibility],
  );
  return rows[0].id;
}

async function refused(c: PoolClient, sql: string, params: unknown[], pattern: RegExp): Promise<void> {
  await c.query("savepoint refusal");
  await expectRejected(c.query(sql, params), pattern);
  await c.query("rollback to savepoint refusal");
}

const save = (c: PoolClient, postId: string, userId: string) =>
  c.query("insert into public.post_saves (post_id, user_id) values ($1, $2)", [postId, userId]);

describe("post_saves", () => {
  it("a member can save a post they can see, and read it back", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer2);
      await save(c, id, USERS.buyer2);
      const { rows } = await c.query("select post_id from public.post_saves where user_id = $1", [USERS.buyer2]);
      expect(rows.map((r) => String(r.post_id))).toEqual([id]);
    });
  });

  it("saves are private: nobody else, the author included, can see them", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer2);
      await save(c, id, USERS.buyer2);

      for (const other of [USERS.seller1, USERS.buyer1]) {
        await as(c, other);
        const { rowCount } = await c.query("select 1 from public.post_saves where post_id = $1", [id]);
        expect(rowCount).toBe(0);
      }
    });
  });

  it("nobody can save as someone else", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer2);
      await refused(c, "insert into public.post_saves (post_id, user_id) values ($1, $2)", [id, USERS.buyer1], /row-level security/);
    });
  });

  it("a connections-only post can be saved by a connection, not by a stranger", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await asService(c, () =>
        c.query("insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')", [
          USERS.seller1,
          USERS.buyer1,
        ]),
      );
      const id = await post(c, USERS.seller1, "connections");

      await as(c, USERS.buyer1);
      await save(c, id, USERS.buyer1);

      await as(c, USERS.buyer2);
      await refused(c, "insert into public.post_saves (post_id, user_id) values ($1, $2)", [id, USERS.buyer2], /row-level security/);
    });
  });

  it("only the owner can remove a save", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer2);
      await save(c, id, USERS.buyer2);

      // The author trying to remove it: matches nothing they can see.
      await as(c, USERS.seller1);
      const stranger = await c.query("delete from public.post_saves where post_id = $1", [id]);
      expect(stranger.rowCount).toBe(0);

      await as(c, USERS.buyer2);
      const owner = await c.query("delete from public.post_saves where post_id = $1 and user_id = $2", [id, USERS.buyer2]);
      expect(owner.rowCount).toBe(1);
    });
  });

  it("a save cannot be edited, and anon has no access at all", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer2);
      await save(c, id, USERS.buyer2);
      await refused(c, "update public.post_saves set created_at = now() where post_id = $1", [id], /permission denied/);
    });
    await withRole("anon", null, async (c) => {
      await refused(c, "select 1 from public.post_saves", [], /permission denied/);
    });
  });

  it("goes with the post when the post is deleted", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c, USERS.seller1);
      await as(c, USERS.buyer2);
      await save(c, id, USERS.buyer2);
      await asService(c, () => c.query("delete from public.posts where id = $1", [id]));
      const { rowCount } = await c.query("select 1 from public.post_saves where post_id = $1", [id]);
      expect(rowCount).toBe(0);
    });
  });
});
