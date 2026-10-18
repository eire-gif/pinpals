// 0178_my_game_stats.sql — member_hole_stats and my_hole_stats_set().
//
// Cast:
//   seller1  plays a live round and keeps stats; owns a scorecard
//   buyer1   plays in the same round
//   buyer2   a stranger
//
// What must hold:
//   - a player saves their own stats for a round they played in, and reads them
//   - nobody else reads them — not a playing partner, not a stranger
//   - nobody saves stats on a round they weren't in, or on someone else's card
//   - clearing every field deletes the row
//   - no direct writes to the table
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const PAL = USERS.buyer1;
const STRANGER = USERS.buyer2;

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

async function refused(c: PoolClient, sql: string, params: unknown[], pattern?: RegExp): Promise<void> {
  await c.query("savepoint attempt");
  let message: string | null = null;
  try {
    await c.query(sql, params);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  await c.query("rollback to savepoint attempt");
  if (message == null) throw new Error(`Expected to be refused: ${sql}`);
  if (pattern && !pattern.test(message)) throw new Error(`Refused with "${message}", expected ${pattern}`);
}

const player = (memberId: string, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 14.2,
  course_handicap: 19,
  playing_handicap: 18,
  handicap_estimated: false,
});

async function round(c: PoolClient): Promise<string> {
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
  return rows[0].id;
}

const SET = "select public.my_hole_stats_set($1, $2, $3::smallint, $4::smallint, $5, $6, $7::smallint)";
const MINE = "select hole, putts, tee, green_miss, penalties from public.member_hole_stats order by hole";

describe("My Game stats (member_hole_stats)", () => {
  it("are saved by the player and read by nobody else", async () => {
    await withRole("authenticated", ME, async (c) => {
      const r = await round(c);
      await c.query(SET, [r, null, 7, 2, "left", "short", 1]);
      await c.query(SET, [r, null, 7, 2, "left", "short", 0]); // update in place, penalty cleared
      expect((await c.query(MINE)).rows).toEqual([{ hole: 7, putts: 2, tee: "left", green_miss: "short", penalties: null }]);

      // A playing partner sees none of it, and can't write it for you.
      await as(c, PAL);
      expect((await c.query(MINE)).rowCount).toBe(0);
      await c.query(SET, [r, null, 7, 1, "fairway", null, null]); // their own row, not yours
      expect((await c.query(MINE)).rows).toEqual([{ hole: 7, putts: 1, tee: "fairway", green_miss: null, penalties: null }]);

      // A stranger can't keep stats on a round they weren't in.
      await as(c, STRANGER);
      await refused(c, SET, [r, null, 7, 2, null, null, null], /round you played in/);
      expect((await c.query(MINE)).rowCount).toBe(0);

      // Clearing every field removes the row.
      await as(c, ME);
      await c.query(SET, [r, null, 7, null, null, null, null]);
      expect((await c.query(MINE)).rowCount).toBe(0);
    });
  });

  it("go on your own scorecard only", async () => {
    await withRole("authenticated", ME, async (c) => {
      const card = (
        await asService(c, () =>
          c.query<{ id: string }>(
            "insert into public.scorecards (member_id, course_name, holes, played_on, source) values ($1, 'The Island', 18, current_date, 'manual') returning id",
            [ME],
          ),
        )
      ).rows[0].id;
      await as(c, ME);
      await c.query(SET, [null, card, 3, 3, null, "long", null]);
      expect((await c.query(MINE)).rows).toEqual([{ hole: 3, putts: 3, tee: null, green_miss: "long", penalties: null }]);

      await as(c, STRANGER);
      await refused(c, SET, [null, card, 3, 1, null, null, null], /your own card/);
    });
  });

  it("refuse bad input and direct writes", async () => {
    await withRole("authenticated", ME, async (c) => {
      const r = await round(c);
      await refused(c, SET, [r, null, 19, 2, null, null, null], /isn't on the card/);
      await refused(c, SET, [r, null, 1, 2, "bunker", null, null], /check/);
      await refused(c, SET, [null, null, 1, 2, null, null, null], /round or a scorecard/);
      await refused(c, "insert into public.member_hole_stats (member_id, live_round_id, hole, putts) values ($1, $2, 1, 2)", [ME, r], /permission denied/);
    });
  });

  it("keep the first putt's distance (0179), and older builds' saves don't wipe it", async () => {
    const SET8 = "select public.my_hole_stats_set($1, $2, $3::smallint, $4::smallint, $5, $6, $7::smallint, $8)";
    const FIRST = "select hole, putts, first_putt from public.member_hole_stats order by hole";
    await withRole("authenticated", ME, async (c) => {
      const r = await round(c);
      await c.query(SET8, [r, null, 4, 2, null, null, null, "20-30"]);
      expect((await c.query(FIRST)).rows).toEqual([{ hole: 4, putts: 2, first_putt: "20-30" }]);

      // An older build saves the same hole through the 0178 version: the distance stays.
      await c.query(SET, [r, null, 4, 3, "right", null, null]);
      expect((await c.query(FIRST)).rows).toEqual([{ hole: 4, putts: 3, first_putt: "20-30" }]);

      // A chip-in has no first putt, whatever was sent.
      await c.query(SET8, [r, null, 5, 0, null, null, null, "0-3"]);
      expect((await c.query(FIRST)).rows[1]).toEqual({ hole: 5, putts: 0, first_putt: null });

      // A distance on its own is still a stat; clearing it too removes the row.
      await c.query(SET8, [r, null, 6, null, null, null, null, "3-6"]);
      expect((await c.query(FIRST)).rowCount).toBe(3);
      await c.query(SET8, [r, null, 6, null, null, null, null, null]);
      expect((await c.query(FIRST)).rowCount).toBe(2);

      await refused(c, SET8, [r, null, 4, 2, null, null, null, "40ft"], /check/);
      await as(c, STRANGER);
      await refused(c, SET8, [r, null, 4, 2, null, null, null, "3-6"], /round you played in/);
    });
  });

  it("can't be saved signed out", async () => {
    await withRole("anon", null, async (c) => {
      await refused(c, SET, [1, null, 1, 2, null, null, null], /permission denied/);
    });
  });
});
