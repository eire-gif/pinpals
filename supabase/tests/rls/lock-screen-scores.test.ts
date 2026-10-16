// 0155_lock_screen_scores.sql — scores saved from the iPhone lock screen.
//
// live_round_set_own_score() is called by the website as the service role,
// after it has checked a signed key naming one member and one round. It takes
// the member as a parameter, so the grant is the boundary.
//
// What must hold:
//   - neither a member nor anon can call it (the function-grants register
//     covers the ACL; this proves it in practice)
//   - it writes only the named member's OWN ball, in a round they play in
//   - never in a format where a side shares a ball (scramble team, foursomes
//     or greensomes match), never once the round has finished, never on a
//     hole that isn't on the card
//   - picked up (null) and clear behave as in the app, and the write is
//     marked as entered by that member
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

const card = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));
const roundJson = JSON.stringify({ course_name: "Portmarnock Golf Club", format: "stableford", holes: 18, allowance: 0.95, course_rating: 72, slope: 125, par_total: 72 });
const player = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 14.2,
  course_handicap: 16,
  playing_handicap: 15,
  handicap_estimated: false,
});

/** ME + PAL + a guest. Returns the round and the three player ids. */
async function createRound(c: PoolClient): Promise<{ roundId: string; players: string[] }> {
  await asService(c, () =>
    c.query(
      `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
      [ME, PAL],
    ),
  );
  await as(c, ME);
  const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    roundJson,
    JSON.stringify([player(ME, "Eire"), player(PAL, "Ciarán"), player(null, "Seán (guest)")]),
    card,
  ]);
  const roundId = rows[0].id;
  const players = await asService(c, () =>
    c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 order by position", [roundId]),
  );
  return { roundId, players: players.rows.map((r) => r.id) };
}

const SET = "select public.live_round_set_own_score($1::uuid, $2::bigint, $3::smallint, $4::smallint, $5::boolean) as player";

async function scoreOf(c: PoolClient, playerId: string, hole: number) {
  const { rows } = await asService(c, () =>
    c.query<{ strokes: number | null; entered_by: string }>("select strokes, entered_by from public.live_round_scores where player_id = $1 and hole = $2", [
      playerId,
      hole,
    ]),
  );
  return rows[0] ?? null;
}

describe("lock screen scores: who can call it", () => {
  it("a member — even one in the round — and anon cannot call it at all", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId } = await createRound(c);
      await as(c, ME);
      await rejects(c, SET, [ME, roundId, 1, 4, false], /permission denied/);
      await c.query("set local role anon");
      await rejects(c, SET, [ME, roundId, 1, 4, false], /permission denied/);
    });
  });
});

describe("lock screen scores: what it writes", () => {
  it("writes the named member's own ball, marked as entered by them; picked up and clear work", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, players } = await createRound(c);
      const { rows } = await asService(c, () => c.query<{ player: string }>(SET, [PAL, roundId, 3, 5, false]));
      expect(rows[0].player).toBe(players[1]);
      expect(await scoreOf(c, players[1], 3)).toEqual({ strokes: 5, entered_by: PAL });
      // Nobody else's row was touched.
      expect(await scoreOf(c, players[0], 3)).toBeNull();

      await asService(c, () => c.query(SET, [PAL, roundId, 3, null, false]));
      expect(await scoreOf(c, players[1], 3)).toEqual({ strokes: null, entered_by: PAL });

      await asService(c, () => c.query(SET, [PAL, roundId, 3, null, true]));
      expect(await scoreOf(c, players[1], 3)).toBeNull();
    });
  });

  it("refuses a member who isn't playing, a hole off the card and an impossible score", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId } = await createRound(c);
      await asService(c, async () => {
        await rejects(c, SET, [STRANGER, roundId, 1, 4, false], /Not your round/);
        await rejects(c, SET, [ME, roundId, 19, 4, false]);
        await rejects(c, SET, [ME, roundId, 1, 0, false], /between 1 and 20/);
        await rejects(c, SET, [ME, roundId, 1, 21, false], /between 1 and 20/);
      });
    });
  });

  it("refuses a finished round", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId } = await createRound(c);
      await as(c, ME);
      await c.query("select public.live_round_finish($1)", [roundId]);
      await asService(c, () => rejects(c, SET, [ME, roundId, 1, 4, false], /finished/));
    });
  });

  it("refuses formats where a side shares one ball", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId } = await createRound(c);
      await asService(c, async () => {
        await c.query("update public.live_rounds set format = 'matchplay', match_type = 'foursomes' where id = $1", [roundId]);
        await rejects(c, SET, [ME, roundId, 1, 4, false], /scored in the app/);
        await c.query("update public.live_rounds set match_type = 'greensomes' where id = $1", [roundId]);
        await rejects(c, SET, [ME, roundId, 1, 4, false], /scored in the app/);
        await c.query("update public.live_rounds set match_type = 'fourball' where id = $1", [roundId]);
        // Fourball: everyone plays their own ball, so it's allowed.
        await c.query(SET, [ME, roundId, 1, 4, false]);
        await c.query(
          "update public.live_rounds set match_type = null, format = 'stroke', scramble_size = 2, team_handicap = 8 where id = $1",
          [roundId],
        );
        await rejects(c, SET, [ME, roundId, 2, 4, false], /scored in the app/);
      });
    });
  });
});
