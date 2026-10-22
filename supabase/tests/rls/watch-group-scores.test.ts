// 0185_watch_group_scores.sql — the group's scores from a watch.
//
// live_round_set_scores_as() is called by the website as the service role,
// after it has checked the signed lock-screen key naming one member and one
// round. It takes the member as a parameter, so the grant is the boundary.
//
// What must hold:
//   - neither a member nor anon can call it
//   - the member must be someone the app lets score the round (creator, the
//     match day's organiser, or a player in it) — the same rule as
//     can_score_live_round(), so anyone in the group can score the group
//   - it writes the rows given, marked as entered by that member; picked up
//     (null) and clear behave as in the app
//   - a player from another round is skipped, not written
//   - never once the round has finished, never on a hole off the card, never
//     with an empty or oversized list or a bad strokes value
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
async function createRound(c: PoolClient, by: string = ME, people = [player(ME, "Eire"), player(PAL, "Ciarán"), player(null, "Seán (guest)")]) {
  await asService(c, () =>
    c.query(
      `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
      [ME, PAL],
    ),
  );
  await as(c, by);
  const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [roundJson, JSON.stringify(people), card]);
  const roundId = rows[0].id;
  const players = await asService(c, () => c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 order by position", [roundId]));
  return { roundId, players: players.rows.map((r) => r.id) };
}

const SET = "select public.live_round_set_scores_as($1::uuid, $2::bigint, $3::smallint, $4::jsonb) as saved";
const scores = (...items: unknown[]) => JSON.stringify(items);

async function scoreOf(c: PoolClient, playerId: string, hole: number) {
  const { rows } = await asService(c, () =>
    c.query<{ strokes: number | null; entered_by: string }>("select strokes, entered_by from public.live_round_scores where player_id = $1 and hole = $2", [playerId, hole]),
  );
  return rows[0] ?? null;
}

describe("watch group scores: who can call it", () => {
  it("a member — even one in the round — and anon cannot call it at all", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, players } = await createRound(c);
      await as(c, ME);
      await rejects(c, SET, [ME, roundId, 1, scores({ player_id: Number(players[0]), strokes: 4 })], /permission denied/);
      await c.query("set local role anon");
      await rejects(c, SET, [ME, roundId, 1, scores({ player_id: Number(players[0]), strokes: 4 })], /permission denied/);
    });
  });

  it("anyone playing in the round may score the whole group; a stranger may not", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, players } = await createRound(c);
      const all = scores(
        { player_id: Number(players[0]), strokes: 4 },
        { player_id: Number(players[1]), strokes: 5 },
        { player_id: Number(players[2]), strokes: 6 },
      );
      // PAL didn't create the round, but plays in it: same as the app.
      const { rows } = await asService(c, () => c.query<{ saved: string[] }>(SET, [PAL, roundId, 2, all]));
      expect(rows[0].saved.map(String)).toEqual(players);
      expect(await scoreOf(c, players[0], 2)).toEqual({ strokes: 4, entered_by: PAL });
      expect(await scoreOf(c, players[2], 2)).toEqual({ strokes: 6, entered_by: PAL });
      await asService(c, () => rejects(c, SET, [STRANGER, roundId, 2, all], /Not your round/));
    });
  });

  it("the round's creator may score it even when not playing", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, players } = await createRound(c, ME, [player(PAL, "Ciarán"), player(null, "Seán (guest)")]);
      const { rows } = await asService(c, () => c.query<{ saved: string[] }>(SET, [ME, roundId, 1, scores({ player_id: Number(players[0]), strokes: 3 })]));
      expect(rows[0].saved.map(String)).toEqual([players[0]]);
    });
  });
});

describe("watch group scores: what it writes", () => {
  it("picked up stores null, clear removes, and a player from another round is skipped", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, players } = await createRound(c);
      // Another game, with nobody from this one (one open game per player).
      const other = await createRound(c, STRANGER, [player(STRANGER, "Stranger")]);
      const { rows } = await asService(c, () =>
        c.query<{ saved: string[] }>(SET, [
          ME,
          roundId,
          5,
          scores({ player_id: Number(players[0]), strokes: null }, { player_id: Number(other.players[0]), strokes: 4 }, { player_id: Number(players[1]), strokes: 5 }),
        ]),
      );
      expect(rows[0].saved.map(String)).toEqual([players[0], players[1]]);
      expect(await scoreOf(c, players[0], 5)).toEqual({ strokes: null, entered_by: ME });
      expect(await scoreOf(c, other.players[0], 5)).toBeNull();
      await asService(c, () => c.query(SET, [ME, roundId, 5, scores({ player_id: Number(players[1]), clear: true })]));
      expect(await scoreOf(c, players[1], 5)).toBeNull();
    });
  });

  it("refuses a finished round, a hole off the card, and bad input", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, players } = await createRound(c);
      const one = scores({ player_id: Number(players[0]), strokes: 4 });
      await asService(c, () => rejects(c, SET, [ME, roundId, 19, one], /No such hole/));
      await asService(c, () => rejects(c, SET, [ME, roundId, 1, "[]"], /Between 1 and 8/));
      await asService(c, () => rejects(c, SET, [ME, roundId, 1, scores(...Array.from({ length: 9 }, () => ({ player_id: Number(players[0]), strokes: 4 })))], /Between 1 and 8/));
      await asService(c, () => rejects(c, SET, [ME, roundId, 1, scores({ player_id: Number(players[0]), strokes: 0 })], /between 1 and 20/));
      await asService(c, () => rejects(c, SET, [ME, roundId, 1, scores({ player_id: Number(players[0]), strokes: 4.5 })], /between 1 and 20/));
      await asService(c, () => rejects(c, SET, [ME, roundId, 1, scores({ player_id: Number(players[0]) })], /needs strokes/));
      await asService(c, () => rejects(c, SET, [ME, roundId, 1, scores({ strokes: 4 })], /player_id/));
      await as(c, ME);
      await c.query("select public.live_round_finish($1)", [roundId]);
      await asService(c, () => rejects(c, SET, [ME, roundId, 1, one], /finished/));
    });
  });
});
