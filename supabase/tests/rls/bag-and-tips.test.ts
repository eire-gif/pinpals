// 0153_bag_and_hole_tips.sql — My bag, club tags on shots, local knowledge.
//
// Cast:
//   seller1  plays a live round, tags their shot, keeps a bag, leaves a tip
//   buyer1   an accepted PinPal in the same round
//   buyer2   a stranger
//   admin    staff (two-step) who can hide a tip
//
// What must hold:
//   - a bag is its owner's alone, read and write
//   - only the player themself tags a club on their shot; it feeds my_bag()
//   - tips: one per member per hole; everyone signed in reads them with a
//     first name; you can't mark your own useful; only staff hide; a hidden
//     tip shows only to its author; nobody deletes someone else's
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const PAL = USERS.buyer1;
const STRANGER = USERS.buyer2;
const STAFF = USERS.admin;

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

async function rejects(c: PoolClient, sql: string, params: unknown[], pattern?: RegExp): Promise<void> {
  await c.query("savepoint attempt");
  let message: string | null = null;
  try {
    await c.query(sql, params);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  await c.query("rollback to savepoint attempt");
  if (message == null) throw new Error(`Expected to be rejected: ${sql}`);
  if (pattern && !pattern.test(message)) throw new Error(`Rejected with "${message}", expected ${pattern}`);
}

const player = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 14.2,
  course_handicap: 19,
  playing_handicap: 18,
  handicap_estimated: false,
});

async function roundWithShot(c: PoolClient): Promise<{ roundId: string; mine: string; pals: string }> {
  await asService(c, () =>
    c.query(
      `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
      [ME, PAL],
    ),
  );
  await as(c, ME);
  const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    JSON.stringify({ course_name: "Portmarnock Hotel & Golf Links", format: "stableford", holes: 18, allowance: 0.95 }),
    JSON.stringify([player(ME, "Eire"), player(PAL, "Ciarán")]),
    JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: null }))),
  ]);
  const roundId = rows[0].id;
  const players = await asService(c, () => c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 order by position", [roundId]));
  const [mine, pals] = players.rows.map((r) => r.id);
  await c.query("select public.live_round_shot_add($1, $2, 1::smallint, 53.43, -6.12, 5)", [roundId, mine]);
  await c.query("select public.live_round_shot_add($1, $2, 1::smallint, 53.431, -6.12, 5)", [roundId, pals]);
  return { roundId, mine, pals };
}

const TAG = "select public.live_round_shot_club($1, $2, 1::smallint, 1::smallint, $3, $4)";

describe("My bag", () => {
  it("is its owner's alone", async () => {
    await withRole("authenticated", ME, async (c) => {
      await c.query("insert into public.member_bag (member_id, club, yards) values ($1, '7i', 150)", [ME]);
      await rejects(c, "insert into public.member_bag (member_id, club, yards) values ($1, '8i', 140)", [STRANGER]);
      await rejects(c, "insert into public.member_bag (member_id, club) values ($1, 'putter')", [ME], /check/);
      const mine = await c.query<{ club: string; yards: number }>("select club, yards from public.my_bag()");
      expect(mine.rows).toEqual([expect.objectContaining({ club: "7i", yards: 150 })]);

      await as(c, STRANGER);
      expect((await c.query("select 1 from public.member_bag where member_id = $1", [ME])).rowCount).toBe(0);
      expect((await c.query("update public.member_bag set yards = 300 where member_id = $1", [ME])).rowCount).toBe(0);
      expect((await c.query("select * from public.my_bag()")).rowCount).toBe(0);
    });
  });

  it("learns from the shots the player tags, and only the player can tag them", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, mine, pals } = await roundWithShot(c);

      await c.query(TAG, [roundId, mine, "7i", 137.6]);
      const bag = await c.query<{ club: string; shots: number; median_m: string }>("select club, shots, median_m from public.my_bag() where club = '7i'");
      expect(bag.rows[0]).toMatchObject({ club: "7i", shots: 1 });
      expect(Number(bag.rows[0].median_m)).toBeCloseTo(137.6);

      // Not someone else's shot, even in your own round.
      await rejects(c, TAG, [roundId, pals, "8i", 120], /your own shots/);
      await rejects(c, TAG, [roundId, mine, "putter", 10], /Unknown club/);
      await rejects(c, TAG, [roundId, mine, "7i", null], /no distance/);

      // Longest shots: the player's own, for this round and ever.
      const longest = await c.query<{ club: string; distance_m: string; hole: number }>("select club, distance_m, hole from public.my_longest_shots($1)", [roundId]);
      expect(longest.rows).toHaveLength(1);
      expect(longest.rows[0]).toMatchObject({ club: "7i" });
      expect(Number(longest.rows[0].distance_m)).toBeCloseTo(137.6);
      expect((await c.query("select * from public.my_longest_shots()")).rowCount).toBe(1);

      // A stranger can't, and can't see it.
      await as(c, STRANGER);
      await rejects(c, TAG, [roundId, mine, "driver", 230], /your own shots/);
      expect((await c.query("select * from public.my_bag() where club = '7i'")).rowCount).toBe(0);
      expect((await c.query("select * from public.my_longest_shots($1)", [roundId])).rowCount).toBe(0);

      // Clearing it takes it out of the bag's sums.
      await as(c, ME);
      await c.query(TAG, [roundId, mine, null, null]);
      expect((await c.query("select * from public.my_bag() where club = '7i'")).rowCount).toBe(0);
    });
  });
});

describe("Local knowledge", () => {
  it("one tip per member per hole; read by members with a first name; useful votes; staff hide", async () => {
    await withRole("authenticated", ME, async (c) => {
      const club = (await asService(c, () => c.query<{ id: string }>("select id from public.clubs order by id limit 1"))).rows[0].id;
      const tip = (await c.query<{ id: string }>("insert into public.hole_tips (club_id, hole, member_id, body) values ($1, 1, $2, 'Aim at the left edge of the ruin.') returning id", [club, ME])).rows[0].id;
      await rejects(c, "insert into public.hole_tips (club_id, hole, member_id, body) values ($1, 1, $2, 'Another one')", [club, ME], /duplicate|unique/);
      await rejects(c, "insert into public.hole_tips (club_id, hole, member_id, body) values ($1, 2, $2, 'Pretending')", [club, STRANGER]);
      await rejects(c, "insert into public.hole_tips (club_id, hole, member_id, body, hidden_at) values ($1, 3, $2, 'Hidden from the start', now())", [club, ME]);
      // Not your own tip.
      await rejects(c, "insert into public.hole_tip_votes (tip_id, member_id) values ($1, $2)", [tip, ME]);

      await as(c, STRANGER);
      const seen = await c.query<{ author_first_name: string; useful: number; mine: boolean }>("select author_first_name, useful, mine from public.hole_tips_for($1, 1::smallint)", [club]);
      expect(seen.rows).toHaveLength(1);
      expect(seen.rows[0]).toMatchObject({ mine: false, useful: 0 });
      await c.query("insert into public.hole_tip_votes (tip_id, member_id) values ($1, $2)", [tip, STRANGER]);
      expect((await c.query<{ useful: number }>("select useful from public.hole_tips_for($1, 1::smallint)", [club])).rows[0].useful).toBe(1);
      // Can't delete or hide someone else's.
      expect((await c.query("delete from public.hole_tips where id = $1", [tip])).rowCount).toBe(0);
      expect((await c.query("update public.hole_tips set hidden_at = now() where id = $1", [tip])).rowCount).toBe(0);

      // Staff hide it: gone for others, still there (marked) for its author.
      await as(c, STAFF);
      await c.query("select set_config('request.jwt.claim.aal', 'aal2', true)");
      expect((await c.query("update public.hole_tips set hidden_at = now(), hidden_by = $2, hidden_reason = 'spam' where id = $1", [tip, STAFF])).rowCount).toBe(1);
      await c.query("select set_config('request.jwt.claim.aal', 'aal1', true)");
      await as(c, STRANGER);
      expect((await c.query("select * from public.hole_tips_for($1, 1::smallint)", [club])).rowCount).toBe(0);
      await as(c, ME);
      const own = await c.query<{ hidden: boolean; mine: boolean }>("select hidden, mine from public.hole_tips_for($1, 1::smallint)", [club]);
      expect(own.rows[0]).toMatchObject({ hidden: true, mine: true });

      // Its author can delete it.
      expect((await c.query("delete from public.hole_tips where id = $1", [tip])).rowCount).toBe(1);

      await c.query("set local role anon");
      await rejects(c, "select * from public.hole_tips_for($1, 1::smallint)", [club]);
    });
  });
});
