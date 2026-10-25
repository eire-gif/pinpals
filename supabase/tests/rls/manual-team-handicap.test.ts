// 0189_manual_team_handicap.sql — a team's handicap set by hand for one game.
//
// Cast:
//   seller1    organises the day / sets up the single team; team 1
//   buyer1     a PinPal of seller1; team 1
//   moderator  a PinPal of seller1; team 2
//
// What must hold:
//   - the organiser sets a team's handicap; the worked-out figure is kept beside it
//   - setting it back to the worked-out figure clears the mark
//   - a player who isn't the organiser can't; nor on a round that isn't a team game
//   - a single team's handicap: whoever set it up
//   - before a score, nobody is told; once scores are in, the team is (not the organiser)
//   - not once the round has finished; out-of-range figures refused
//   - the columns can't be written directly
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const PAL = USERS.buyer1;
const PAL2 = USERS.moderator;

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
    for (const other of [PAL, PAL2]) {
      await c.query(
        `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
         on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
        [ME, other],
      );
    }
  });
}

const p = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 12.0,
  course_handicap: 14,
  playing_handicap: 3,
  handicap_estimated: false,
});
const card = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));
const SET = "select public.live_round_set_team_handicap($1, $2) as h";

async function createDay(c: PoolClient) {
  await as(c, ME);
  const teams = JSON.stringify([
    { name: "The Eagles", team_handicap: 9, players: [p(ME, "Eire"), p(PAL, "Ciarán")] },
    { team_handicap: 7, players: [p(PAL2, "Niamh"), p(null, "Darragh")] },
  ]);
  const day = JSON.stringify({ title: "Captain's Scramble", course_name: "Portmarnock Golf Club", holes: 18, scramble_size: 2 });
  const { rows } = await c.query<{ id: string }>("select public.live_scramble_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [day, teams, card]);
  const rounds = await asService(c, () =>
    c.query<{ id: string }>("select id from public.live_rounds where match_day_id = $1 order by team_number", [rows[0].id]),
  );
  return { dayId: rows[0].id, team1: rounds.rows[0].id, team2: rounds.rows[1].id };
}

const state = (c: PoolClient, id: string) =>
  asService(c, () =>
    c.query<{ team_handicap: number; team_handicap_auto: number | null; team_handicap_set_by: string | null }>(
      "select team_handicap, team_handicap_auto, team_handicap_set_by from public.live_rounds where id = $1",
      [id],
    ),
  ).then((r) => r.rows[0]);

const alerts = (c: PoolClient, roundId: string) =>
  asService(c, () =>
    c.query<{ user_id: string; title: string }>(
      "select user_id, title from public.notifications where type = 'live_team_handicap' and (data ->> 'round_id')::bigint = $1",
      [roundId],
    ),
  ).then((r) => r.rows);

describe("team handicap set by hand", () => {
  it("the organiser sets it, the worked-out figure is kept, and setting it back clears the mark", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { team1 } = await createDay(c);
      const r = await c.query(SET, [team1, 6]);
      expect(r.rows[0].h).toBe(6);
      expect(await state(c, team1)).toEqual({ team_handicap: 6, team_handicap_auto: 9, team_handicap_set_by: ME });

      // Changing it again keeps the original worked-out figure.
      await c.query(SET, [team1, 5]);
      expect(await state(c, team1)).toMatchObject({ team_handicap: 5, team_handicap_auto: 9 });

      // Back to the worked-out figure: no mark.
      await c.query(SET, [team1, 9]);
      expect(await state(c, team1)).toEqual({ team_handicap: 9, team_handicap_auto: null, team_handicap_set_by: null });

      // A plus figure is fine.
      await c.query(SET, [team1, -2]);
      expect(await state(c, team1)).toMatchObject({ team_handicap: -2, team_handicap_auto: 9 });
    });
  });

  it("only the organiser: not a player, not on a round that isn't a team game", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { team1, team2 } = await createDay(c);
      await as(c, PAL);
      await rejects(c, SET, [team1, 4], /organiser/);
      await as(c, PAL2);
      await rejects(c, SET, [team2, 4], /organiser/);

      await as(c, ME);
      const single = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
        JSON.stringify({ course_name: "Portmarnock Golf Club", holes: 18, allowance: 0.95, format: "stableford" }),
        // Guests only: Eire's already in the day's open game.
        JSON.stringify([p(null, "Aoife"), p(null, "Ruth")]),
        card,
      ]);
      await rejects(c, SET, [single.rows[0].id, 4], /team game/);
    });
  });

  it("a single team: whoever set it up, nobody else", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
        JSON.stringify({ course_name: "Portmarnock Golf Club", holes: 18, allowance: 0.35, format: "scramble", scramble_size: 2, team_handicap: 8 }),
        JSON.stringify([p(ME, "Eire"), p(PAL, "Ciarán")]),
        card,
      ]);
      await as(c, PAL);
      await rejects(c, SET, [rows[0].id, 6], /set up the round/);
      await as(c, ME);
      await c.query(SET, [rows[0].id, 6]);
      expect(await state(c, rows[0].id)).toMatchObject({ team_handicap: 6, team_handicap_auto: 8 });
    });
  });

  it("tells the team only once scores are in, and never the organiser", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { team1 } = await createDay(c);
      await c.query(SET, [team1, 7]);
      expect(await alerts(c, team1)).toEqual([]);

      const lead = await asService(c, () =>
        c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 and position = 1", [team1]),
      );
      await c.query("select public.live_round_set_score($1, $2, 1::smallint, 4::smallint, false)", [team1, lead.rows[0].id]);
      await c.query(SET, [team1, 6]);
      const sent = await alerts(c, team1);
      expect(sent.map((a) => a.user_id)).toEqual([PAL]);
      expect(sent[0].title).toBe("The Eagles now plays off 6");
    });
  });

  it("refuses a finished round, and figures out of range", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { team2 } = await createDay(c);
      await rejects(c, SET, [team2, 81], /whole number/);
      await rejects(c, SET, [team2, -21], /whole number/);
      await asService(c, () => c.query("update public.live_rounds set status = 'finished', finished_at = now() where id = $1", [team2]));
      await rejects(c, SET, [team2, 5], /finished/);
    });
  });

  it("can't be written directly", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { team1 } = await createDay(c);
      await rejects(c, "update public.live_rounds set team_handicap = 1, team_handicap_auto = 9 where id = $1", [team1]);
    });
  });
});
