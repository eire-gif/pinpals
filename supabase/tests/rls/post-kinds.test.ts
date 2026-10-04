// 0095_post_kinds.sql — posts.kind and posts.details.
//
// The database half of the rules in src/lib/post-details.ts: a member can
// post each kind with its details through their own grants, the check
// refuses a malformed or mismatched shape, and nobody can change a post's
// kind or details afterwards.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

const insert = (c: PoolClient, kind: string, details: unknown) =>
  c.query<{ id: string }>(
    "insert into public.posts (author_id, body, kind, details) values ($1, '', $2, $3::jsonb) returning id",
    [USERS.seller1, kind, details === null ? null : JSON.stringify(details)],
  );

async function refused(c: PoolClient, kind: string, details: unknown): Promise<void> {
  await c.query("savepoint refusal");
  await expectRejected(insert(c, kind, details), /posts_details_valid|violates check constraint/);
  await c.query("rollback to savepoint refusal");
}

describe("posts.kind and posts.details", () => {
  it("existing-style posts are general with no details", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await as(c, USERS.seller1);
      const { rows } = await c.query(
        "insert into public.posts (author_id, body) values ($1, 'Lovely day') returning kind, details",
        [USERS.seller1],
      );
      expect(rows[0]).toEqual({ kind: "general", details: null });
    });
  });

  it("a member can post a round, a hole and a shot with their details", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await as(c, USERS.seller1);
      await insert(c, "round", {
        score: 78, holes: 18, course_par: 72, tee: "White", played_on: "2026-10-04", differential: 6.3,
        fairways_hit: 8, fairways_total: 14, gir: 7, putts: 31, best_hole: { hole: 6, par: 4, score: 3 },
      });
      await insert(c, "hole", { hole: 7, par: 3, yards: 162, score: 1 });
      await insert(c, "shot", { hole: 18, shot_number: 2, club: "3 Wood", distance_yards: 245, lie: "fairway", result: "Eagle" });
      await insert(c, "round", { score: 81 });
      await insert(c, "round", { score: 74, birdies: 3 }); // 0098
      await insert(c, "round", { score: 78, front_nine: 38, back_nine: 40, longest_drive: 285, tee_time_id: 5 }); // 0099
      await insert(c, "round", { score: 41, holes: 9, front_nine: 41, back_nine: 40 });
      // 0100 — achievements the numbers support
      await insert(c, "hole", { hole: 7, par: 3, yards: 162, score: 1, club: "7 Iron", achievement: "hole_in_one" });
      await insert(c, "hole", { hole: 18, par: 5, score: 3, achievement: "eagle" });
      await insert(c, "round", { score: 79, achievement: "breaking_80" });
      await insert(c, "round", { score: 88, achievement: "personal_best" });
      await insert(c, "round", { score: 84, best_hole: { hole: 11, par: 3, score: 1 }, achievement: "hole_in_one" });
      await insert(c, "shot", { result: "Off the flagstick" });
    });
  });

  it("refuses details that don't match the kind or the rules", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await as(c, USERS.seller1);
      await refused(c, "general", { score: 80 });
      await refused(c, "round", null);
      await refused(c, "round", {});
      await refused(c, "round", { score: 12 });
      await refused(c, "round", { score: 78.5 });
      await refused(c, "round", { score: "78" });
      await refused(c, "round", { score: 78, holes: 12 });
      await refused(c, "round", { score: 78, played_on: "2026-02-30" });
      await refused(c, "round", { score: 78, played_on: "04/10/2026" });
      await refused(c, "round", { score: 78, fairways_hit: 9, fairways_total: 7 });
      await refused(c, "round", { score: 78, gir: 19 });
      await refused(c, "round", { score: 78, birdies: 19 });
      await refused(c, "round", { score: 78, birdies: 2.5 });
      await refused(c, "round", { score: 78, front_nine: 38, back_nine: 41 });
      await refused(c, "round", { score: 78, longest_drive: 900 });
      await refused(c, "round", { score: 78, tee_time_id: 0 });
      await refused(c, "round", { score: 80, achievement: "breaking_80" });
      await refused(c, "round", { score: 79, holes: 9, achievement: "breaking_80" });
      await refused(c, "round", { score: 40, holes: 9, achievement: "personal_best" });
      await refused(c, "round", { score: 84, achievement: "hole_in_one" });
      await refused(c, "round", { score: 84, achievement: "albatross" });
      await refused(c, "hole", { hole: 7, par: 3, score: 2, achievement: "hole_in_one" });
      await refused(c, "hole", { hole: 7, par: 3, score: 1, achievement: "eagle" });
      await refused(c, "hole", { hole: 7, score: 3, achievement: "eagle" });
      await refused(c, "hole", { hole: 7, par: 3, club: "   " });
      await refused(c, "round", { score: 78, best_hole: { hole: 6 } });
      await refused(c, "round", { score: 78, best_hole: { hole: 6, score: 3, colour: "red" } });
      await refused(c, "round", { score: 78, map: [[1, 2]] });
      await refused(c, "hole", { par: 3 });
      await refused(c, "hole", { hole: 7, par: 7 });
      await refused(c, "hole", { hole: 7, yards: 2000 });
      await refused(c, "shot", { hole: 7 });
      await refused(c, "shot", { club: "   " });
      await refused(c, "shot", { club: "7 Iron", lie: "car park" });
      await refused(c, "shot", { club: "x".repeat(25) });
      await refused(c, "round", [78]);
    });
  });

  it("refuses an unknown kind", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await as(c, USERS.seller1);
      await c.query("savepoint refusal");
      await expectRejected(insert(c, "poll", null), /check constraint/);
      await c.query("rollback to savepoint refusal");
    });
  });

  it("a member cannot change a post's kind or details afterwards", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await as(c, USERS.seller1);
      const { rows } = await insert(c, "hole", { hole: 7, par: 3, score: 3 });
      for (const sql of [
        "update public.posts set details = '{\"hole\": 7, \"par\": 3, \"score\": 1}'::jsonb where id = $1",
        "update public.posts set kind = 'general', details = null where id = $1",
      ]) {
        await c.query("savepoint refusal");
        await expectRejected(c.query(sql, [rows[0].id]), /permission denied/);
        await c.query("rollback to savepoint refusal");
      }
    });
  });

  it("nobody can post a round as someone else", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await as(c, USERS.buyer1);
      await c.query("savepoint refusal");
      await expectRejected(insert(c, "round", { score: 78 }), /row-level security/);
      await c.query("rollback to savepoint refusal");
    });
  });
});
