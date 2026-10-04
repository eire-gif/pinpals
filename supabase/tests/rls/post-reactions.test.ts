// 0096_post_reactions.sql — golf reactions on post_likes.
//
// A like without a reaction is a Great Shot; a reaction can be changed by
// its owner and nobody else; posts.reaction_counts always agrees with
// like_count and with the rows; and members still can't write either
// counter themselves.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

async function post(c: PoolClient): Promise<string> {
  await as(c, USERS.seller1);
  const { rows } = await c.query<{ id: string }>(
    "insert into public.posts (author_id, body) values ($1, 'Par on 18') returning id",
    [USERS.seller1],
  );
  return rows[0].id;
}

async function counters(c: PoolClient, id: string) {
  const { rows } = await c.query<{ like_count: number; reaction_counts: Record<string, number> }>(
    "select like_count, reaction_counts from public.posts where id = $1",
    [id],
  );
  return rows[0];
}

async function refused(c: PoolClient, sql: string, params: unknown[], pattern: RegExp): Promise<void> {
  await c.query("savepoint refusal");
  await expectRejected(c.query(sql, params), pattern);
  await c.query("rollback to savepoint refusal");
}

describe("post reactions", () => {
  it("a plain like — what older apps send — is a Great Shot", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      await as(c, USERS.buyer1);
      await c.query("insert into public.post_likes (post_id, user_id) values ($1, $2)", [id, USERS.buyer1]);
      const { rows } = await c.query("select reaction from public.post_likes where post_id = $1", [id]);
      expect(rows[0].reaction).toBe("great_shot");
      expect(await counters(c, id)).toEqual({ like_count: 1, reaction_counts: { great_shot: 1 } });
    });
  });

  it("counts follow every add, change and removal, and the total only moves on add and remove", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      await as(c, USERS.buyer1);
      await c.query("insert into public.post_likes (post_id, user_id, reaction) values ($1, $2, 'on_fire')", [id, USERS.buyer1]);
      await as(c, USERS.buyer2);
      await c.query("insert into public.post_likes (post_id, user_id, reaction) values ($1, $2, 'on_fire')", [id, USERS.buyer2]);
      expect(await counters(c, id)).toEqual({ like_count: 2, reaction_counts: { on_fire: 2 } });

      await c.query("update public.post_likes set reaction = 'unlucky' where post_id = $1 and user_id = $2", [id, USERS.buyer2]);
      expect(await counters(c, id)).toEqual({ like_count: 2, reaction_counts: { on_fire: 1, unlucky: 1 } });

      await c.query("delete from public.post_likes where post_id = $1 and user_id = $2", [id, USERS.buyer2]);
      expect(await counters(c, id)).toEqual({ like_count: 1, reaction_counts: { on_fire: 1 } });
    });
  });

  it("only the owner can change a reaction, and only to a real one", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      await as(c, USERS.buyer1);
      await c.query("insert into public.post_likes (post_id, user_id) values ($1, $2)", [id, USERS.buyer1]);

      await as(c, USERS.buyer2);
      const other = await c.query("update public.post_likes set reaction = 'unlucky' where post_id = $1", [id]);
      expect(other.rowCount).toBe(0);

      await as(c, USERS.buyer1);
      await refused(
        c,
        "update public.post_likes set reaction = 'like' where post_id = $1 and user_id = $2",
        [id, USERS.buyer1],
        /check constraint/,
      );
      await refused(
        c,
        "insert into public.post_likes (post_id, user_id, reaction) values ($1, $2, 'meh')",
        [id, USERS.buyer2],
        /check constraint|row-level security/,
      );
    });
  });

  it("a reaction can't be moved to another post or member", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      await as(c, USERS.buyer1);
      await c.query("insert into public.post_likes (post_id, user_id) values ($1, $2)", [id, USERS.buyer1]);
      await refused(
        c,
        "update public.post_likes set user_id = $2 where post_id = $1",
        [id, USERS.buyer2],
        /permission denied/,
      );
    });
  });

  it("members can't write the counters", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await post(c);
      await refused(
        c,
        "update public.posts set reaction_counts = '{\"amazing\": 999}'::jsonb where id = $1",
        [id],
        /permission denied/,
      );
    });
  });
});
