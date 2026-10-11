// 0119_live_highlight_mutes.sql — the "Match notifications" switch.
//
// What must hold:
//   - a player in the round can turn alerts off and back on for that game
//   - a stranger can't set a switch on a round they can't see
//   - you read only your own switches; nobody writes the table directly
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

async function rejects(c: PoolClient, sql: string, params: unknown[]): Promise<void> {
  await c.query("savepoint attempt");
  let failed = false;
  try {
    await c.query(sql, params);
  } catch {
    failed = true;
  }
  await c.query("rollback to savepoint attempt");
  if (!failed) throw new Error(`Expected to be rejected: ${sql}`);
}

async function createRound(c: PoolClient): Promise<string> {
  await c.query("set local role service_role");
  await c.query(
    `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
     on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
    [ME, PAL],
  );
  await c.query("set local role authenticated");
  await as(c, ME);
  const p = (memberId: string | null, name: string) => ({
    member_id: memberId, name, handicap_index: 14.2, course_handicap: 19, playing_handicap: 18, handicap_estimated: false,
  });
  const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    JSON.stringify({ course_name: "Portmarnock Golf Club", format: "stableford", holes: 18, allowance: 0.95, course_rating: 72, slope: 130, par_total: 72 }),
    JSON.stringify([p(ME, "Eire"), p(PAL, "Ciarán")]),
    JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 }))),
  ]);
  return rows[0].id;
}

describe("match notifications switch", () => {
  it("a player turns alerts off and back on for their game", async () => {
    await withRole("authenticated", ME, async (c) => {
      const roundId = await createRound(c);
      await as(c, PAL);
      const { rows } = await c.query<{ key: string }>("select public.live_highlight_set_muted($1, true) as key", [roundId]);
      expect(rows[0].key).toBe(`round:${roundId}`);
      expect((await c.query("select muted from public.live_highlight_mutes where game_key = $1", [`round:${roundId}`])).rows).toEqual([{ muted: true }]);
      await c.query("select public.live_highlight_set_muted($1, false)", [roundId]);
      expect((await c.query("select muted from public.live_highlight_mutes where game_key = $1", [`round:${roundId}`])).rows).toEqual([{ muted: false }]);
    });
  });

  it("a stranger can't set one, and nobody reads or writes anyone else's", async () => {
    await withRole("authenticated", ME, async (c) => {
      const roundId = await createRound(c);
      await as(c, PAL);
      await c.query("select public.live_highlight_set_muted($1, true)", [roundId]);

      await as(c, STRANGER);
      await rejects(c, "select public.live_highlight_set_muted($1, true)", [roundId]);

      await as(c, ME);
      expect((await c.query("select 1 from public.live_highlight_mutes")).rowCount).toBe(0);
      await rejects(c, "insert into public.live_highlight_mutes (member_id, game_key) values ($1, $2)", [PAL, `round:${roundId}`]);
      expect((await c.query("update public.live_highlight_mutes set muted = false")).rowCount).toBe(0);
    });
  });
});
