// 0110_scorecards.sql — members' own scorecards.
//
// Cast:
//   seller1  owns the cards
//   buyer1   an accepted PinPal of seller1
//   buyer2   a stranger (signed in, not connected)
//   seller2  an accepted PinPal whom seller1 has blocked
//
// What must hold:
//   - private: owner only; pinpals: owner + accepted PinPals; members: any
//     signed-in member; never across a block; never anon
//   - nothing is written except through scorecard_save /
//     scorecard_from_live_round, which check ownership and shape
//   - the owner (only) can delete, and the holes go with the card
//   - from a live round: only your own line, and running it again refreshes
//     the same card rather than adding another
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const PAL = USERS.buyer1;
const STRANGER = USERS.buyer2;
const BLOCKED_PAL = USERS.seller2;

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

async function setUp(c: PoolClient): Promise<void> {
  await asService(c, async () => {
    for (const [a, b] of [
      [ME, PAL],
      [ME, BLOCKED_PAL],
    ]) {
      await c.query(
        `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
         on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
        [a, b],
      );
    }
    await c.query(`insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2) on conflict do nothing`, [ME, BLOCKED_PAL]);
  });
}

const card = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ course_name: "Portmarnock Golf Club", tee_name: "Blue", holes: 18, played_on: "2026-10-04", par_total: 72, visibility: "pinpals", ...over });
const holes = (n = 18, strokes: number | null = 5) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1, yards: 400, strokes })));

const SAVE = "select public.scorecard_save($1, $2::jsonb, $3::jsonb) as id";

async function save(c: PoolClient, over: Record<string, unknown> = {}): Promise<string> {
  await as(c, ME);
  const { rows } = await c.query<{ id: string }>(SAVE, [null, card(over), holes()]);
  return rows[0].id;
}

const sees = async (c: PoolClient, who: string, id: string) => {
  await as(c, who);
  const card = (await c.query("select 1 from public.scorecards where id = $1", [id])).rowCount;
  const h = (await c.query("select 1 from public.scorecard_holes where scorecard_id = $1", [id])).rowCount;
  return { card, holes: h };
};

describe("scorecards: who sees them", () => {
  it("pinpals: owner and PinPals, not a stranger or a blocked PinPal", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await save(c);
      expect(await sees(c, ME, id)).toEqual({ card: 1, holes: 18 });
      expect(await sees(c, PAL, id)).toEqual({ card: 1, holes: 18 });
      expect(await sees(c, STRANGER, id)).toEqual({ card: 0, holes: 0 });
      expect(await sees(c, BLOCKED_PAL, id)).toEqual({ card: 0, holes: 0 });
    });
  });

  it("private: owner only; members: any signed-in member except across a block; anon never", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const priv = await save(c, { visibility: "private" });
      const open = await save(c, { visibility: "members" });
      expect((await sees(c, PAL, priv)).card).toBe(0);
      expect((await sees(c, ME, priv)).card).toBe(1);
      expect((await sees(c, STRANGER, open)).card).toBe(1);
      expect((await sees(c, BLOCKED_PAL, open)).card).toBe(0);
      await c.query("set local role anon");
      await rejects(c, "select 1 from public.scorecards", []);
    });
  });
});

describe("scorecards: writing", () => {
  it("only through scorecard_save; edits are the owner's; the shape is checked", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await save(c);

      await as(c, ME);
      await rejects(c, "insert into public.scorecards (member_id, course_name, holes, played_on, source) values ($1, 'X', 18, current_date, 'manual')", [ME]);
      await rejects(c, "update public.scorecards set course_name = 'X' where id = $1", [id]);
      await rejects(c, "update public.scorecard_holes set strokes = 1 where scorecard_id = $1", [id]);

      // Edit: scores change in place.
      await c.query(SAVE, [id, card(), holes(18, 4)]);
      const { rows } = await c.query<{ s: string }>("select sum(strokes) as s from public.scorecard_holes where scorecard_id = $1", [id]);
      expect(Number(rows[0].s)).toBe(72);

      await rejects(c, SAVE, [id, card({ holes: 9 }), holes(9)], /number of holes/);
      await rejects(c, SAVE, [null, card(), holes(17)], /one entry for each hole/);
      await rejects(c, SAVE, [null, card({ played_on: "2099-01-01" }), holes()], /date/);
      await rejects(c, SAVE, [null, card({ visibility: "everyone" }), holes()], /who can see/);

      await as(c, PAL);
      await rejects(c, SAVE, [id, card(), holes()], /isn't yours/);
    });
  });

  it("the owner deletes a card and its holes go too; nobody else can", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await save(c, { visibility: "members" });
      await as(c, STRANGER);
      await c.query("delete from public.scorecards where id = $1", [id]);
      expect((await sees(c, ME, id)).card).toBe(1);
      await as(c, ME);
      await c.query("delete from public.scorecards where id = $1", [id]);
      const left = await asService(c, () => c.query("select 1 from public.scorecard_holes where scorecard_id = $1", [id]));
      expect(left.rowCount).toBe(0);
    });
  });
});

describe("scorecards: from a live round", () => {
  it("copies your own line, refreshes on a second run, and refuses someone who didn't play", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const player = (memberId: string | null, name: string) => ({
        member_id: memberId, name, handicap_index: 12.4, course_handicap: 15, playing_handicap: 14, handicap_estimated: false,
      });
      const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
        JSON.stringify({ course_name: "Portmarnock Golf Club", tee_name: "Blue", format: "stableford", holes: 9, allowance: 0.95 }),
        JSON.stringify([player(ME, "Eire"), player(PAL, "Ciarán")]),
        JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 }))),
      ]);
      const roundId = rows[0].id;
      const players = await asService(c, () =>
        c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 order by position", [roundId]),
      );
      await c.query("select public.live_round_set_score($1, $2, 1::smallint, 5::smallint)", [roundId, players.rows[0].id]);
      await c.query("select public.live_round_set_score($1, $2, 1::smallint, 3::smallint)", [roundId, players.rows[1].id]);

      const first = (await c.query<{ id: string }>("select public.scorecard_from_live_round($1) as id", [roundId])).rows[0].id;
      await c.query("select public.live_round_set_score($1, $2, 2::smallint, 4::smallint)", [roundId, players.rows[0].id]);
      const again = (await c.query<{ id: string }>("select public.scorecard_from_live_round($1) as id", [roundId])).rows[0].id;
      expect(again).toBe(first);

      const card = await c.query<{ handicap_index: string; playing_handicap: number; source: string; holes: number }>(
        "select handicap_index, playing_handicap, source, holes from public.scorecards where id = $1",
        [first],
      );
      expect(card.rows[0]).toMatchObject({ playing_handicap: 14, source: "live", holes: 9 });
      expect(Number(card.rows[0].handicap_index)).toBe(12.4);
      const mine = await c.query<{ hole: number; strokes: number | null }>(
        "select hole, strokes from public.scorecard_holes where scorecard_id = $1 and strokes is not null order by hole",
        [first],
      );
      // My 5 and 4 — not Ciarán's 3.
      expect(mine.rows).toEqual([{ hole: 1, strokes: 5 }, { hole: 2, strokes: 4 }]);

      await as(c, STRANGER);
      await rejects(c, "select public.scorecard_from_live_round($1)", [roundId], /round you played in/);
    });
  });
});
