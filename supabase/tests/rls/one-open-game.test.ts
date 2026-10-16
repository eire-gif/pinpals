// 0157_one_open_game.sql — a player can only be in one open game at a time.
//
// Cast:
//   seller1  ME, starts games
//   buyer1   PAL, an accepted PinPal of ME
//
// What must hold:
//   - starting a second game with someone already in an open one is refused,
//     nothing is created, and the hint names the game to open instead
//   - it's the same for every kind of game (a match day too)
//   - guests by name never clash; a finished game, or one older than 8 hours,
//     doesn't count
//   - my_open_live_game() tells a player where their open game is
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const PAL = USERS.buyer1;

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

async function setUp(c: PoolClient): Promise<void> {
  await asService(c, async () => {
    await c.query(
      `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
      [ME, PAL],
    );
    // Nothing left open from the seed.
    await c.query("update public.live_rounds set status = 'finished', finished_at = now() where status = 'live'");
  });
}

const player = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 14.2,
  course_handicap: 19,
  playing_handicap: 18,
  handicap_estimated: false,
});
const round = () => JSON.stringify({ course_name: "Portmarnock Golf Club", tee_name: "Blue", format: "stableford", holes: 18, allowance: 0.95 });
const card = () =>
  JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));

const CREATE = "select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id";

/** Runs a statement expected to fail; returns its message and hint. */
async function refused(c: PoolClient, sql: string, params: unknown[]): Promise<{ message: string; hint: string | undefined }> {
  await c.query("savepoint attempt");
  try {
    await c.query(sql, params);
  } catch (err) {
    await c.query("rollback to savepoint attempt");
    const e = err as { message: string; hint?: string };
    return { message: e.message, hint: e.hint };
  }
  await c.query("rollback to savepoint attempt");
  throw new Error(`Expected to be refused: ${sql}`);
}

const liveRounds = (c: PoolClient) =>
  asService(c, async () => Number((await c.query("select count(*) from public.live_rounds where status = 'live'")).rows[0].count));

describe("one open game per player", () => {
  it("refuses a second game for the same player and points at the first", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const first = (await c.query<{ id: string }>(CREATE, [round(), JSON.stringify([player(ME, "Eire"), player(PAL, "Ciarán")]), card()])).rows[0].id;

      // The tee time race: the other player starts the same game.
      await as(c, PAL);
      const r = await refused(c, CREATE, [round(), JSON.stringify([player(PAL, "Ciarán"), player(ME, "Eire")]), card()]);
      expect(r.message).toMatch(/already in a game started by/);
      expect(r.hint).toBe(`open-game:round:${first}`);
      expect(await liveRounds(c)).toBe(1);

      // And they're told where it is.
      const open = await c.query("select kind, id, round_id from public.my_open_live_game()");
      expect(open.rows).toEqual([{ kind: "round", id: first, round_id: first }]);
    });
  });

  it("covers match days, naming the day", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const day = (
        await c.query<{ id: string }>("select public.live_match_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
          JSON.stringify({ title: "Saturday match", course_name: "Portmarnock Golf Club", holes: 18 }),
          JSON.stringify([{ match_type: "singles", players: [{ ...player(ME, "Eire"), side: 1 }, { ...player(PAL, "Ciarán"), side: 2 }] }]),
          card(),
        ])
      ).rows[0].id;
      await as(c, PAL);
      const r = await refused(c, CREATE, [round(), JSON.stringify([player(PAL, "Ciarán")]), card()]);
      expect(r.hint).toBe(`open-game:day:${day}`);
    });
  });

  it("never clashes on guests, finished games or games over 8 hours old", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      // Two games of guests by name: nothing to match, so no clash.
      await c.query(CREATE, [round(), JSON.stringify([player(null, "Seán (guest)")]), card()]);
      await c.query(CREATE, [round(), JSON.stringify([player(null, "Seán (guest)")]), card()]);

      const a = (await c.query<{ id: string }>(CREATE, [round(), JSON.stringify([player(ME, "Eire")]), card()])).rows[0].id;
      await c.query("select public.live_round_finish($1)", [a]);
      const b = (await c.query<{ id: string }>(CREATE, [round(), JSON.stringify([player(ME, "Eire")]), card()])).rows[0].id;
      expect(b).toBeTruthy();

      await asService(c, () => c.query("update public.live_rounds set created_at = now() - interval '9 hours' where id = $1", [b]));
      await as(c, ME);
      expect((await c.query(CREATE, [round(), JSON.stringify([player(ME, "Eire")]), card()])).rowCount).toBe(1);
    });
  });
});
