// 0108_hole_maps.sql — course geometry and shot positions.
//
// Cast (as live-scoring.test.ts):
//   seller1  starts the round
//   buyer1   an accepted PinPal of seller1, playing in it
//   buyer2   a stranger
//
// What must hold:
//   - course layouts and points: a signed-in member reads one club at a time
//     via course_layout_get (golfapi.io's anti-scraping clause); the tables
//     take no reads or writes from anon or authenticated
//   - shots: only people who can see the round read them; only people who
//     can score it add or undo them, and only through the functions
//   - shots are numbered 1, 2, 3 per player per hole; undo takes the last
//   - a finished round is frozen; a deleted member's positions are deleted
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

async function befriend(c: PoolClient): Promise<void> {
  await asService(c, () =>
    c.query(
      `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
      [ME, PAL],
    ),
  );
}

const player = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 14.2,
  course_handicap: 19,
  playing_handicap: 18,
  handicap_estimated: false,
});

async function createRound(c: PoolClient): Promise<{ roundId: string; players: string[] }> {
  await befriend(c);
  await as(c, ME);
  const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    JSON.stringify({ course_name: "Portmarnock Golf Club", format: "stableford", holes: 18, allowance: 0.95 }),
    JSON.stringify([player(ME, "Eire"), player(PAL, "Ciarán")]),
    JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: null }))),
  ]);
  const roundId = rows[0].id;
  const players = await asService(c, () =>
    c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 order by position", [roundId]),
  );
  return { roundId, players: players.rows.map((r) => r.id) };
}

const ADD = "select public.live_round_shot_add($1, $2, $3::smallint, $4, $5, $6) as id";
const UNDO = "select public.live_round_shot_undo($1, $2, $3::smallint)";

describe("course layouts", () => {
  it("members read one club at a time through course_layout_get; the tables are closed to everyone else", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { layoutId, clubId } = await asService(c, async () => {
        const club = await c.query<{ id: string }>("select id from public.clubs order by id limit 1");
        const { rows } = await c.query<{ id: string }>(
          `insert into public.course_layouts (club_id, name, source, provider, provider_course_id)
           values ($1, 'Championship', 'provider', 'golfapi', 'test-1') returning id`,
          [club.rows[0].id],
        );
        await c.query(
          `insert into public.course_layout_points (layout_id, hole, kind, lat, lng) values
             ($1, 1, 'tee_back', 53.4300, -6.1200), ($1, 1, 'green_centre', 53.4330, -6.1180)`,
          [rows[0].id],
        );
        return { layoutId: rows[0].id, clubId: club.rows[0].id };
      });

      await as(c, STRANGER);
      const got = await c.query<{ j: Array<{ name: string; points: unknown[] }> }>("select public.course_layout_get($1) as j", [clubId]);
      const champ = got.rows[0].j.find((l) => l.name === "Championship");
      expect(champ?.points).toHaveLength(2);

      // No bulk route: the tables themselves are closed, read and write.
      await rejects(c, "select 1 from public.course_layout_points", []);
      await rejects(c, "select 1 from public.course_layouts", []);
      await rejects(c, "insert into public.course_layout_points (layout_id, hole, kind, lat, lng) values ($1, 2, 'tee_back', 1, 1)", [layoutId]);
      await rejects(c, "delete from public.course_layouts where id = $1", [layoutId]);

      await c.query("set local role anon");
      await rejects(c, "select public.course_layout_get($1)", [clubId]);
    });
  });

  it("refuses a point that is not on the map or not a known kind", async () => {
    await withRole("service_role", null, async (c) => {
      const club = await c.query<{ id: string }>("select id from public.clubs order by id limit 1");
      const { rows } = await c.query<{ id: string }>(
        "insert into public.course_layouts (club_id, source) values ($1, 'admin') returning id",
        [club.rows[0].id],
      );
      await rejects(c, "insert into public.course_layout_points (layout_id, hole, kind, lat, lng) values ($1, 1, 'tee_back', 95, 0)", [rows[0].id]);
      await rejects(c, "insert into public.course_layout_points (layout_id, hole, kind, lat, lng) values ($1, 1, 'clubhouse', 53, -6)", [rows[0].id]);
      await rejects(c, "insert into public.course_layout_points (layout_id, hole, kind, lat, lng) values ($1, 19, 'tee_back', 53, -6)", [rows[0].id]);
    });
  });
});

describe("live round shots", () => {
  it("players add shots for anyone in the group, numbered in order; a stranger can neither add nor read", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, players } = await createRound(c);

      await as(c, ME);
      await c.query(ADD, [roundId, players[0], 1, 53.43, -6.12, 4.5]);
      await as(c, PAL);
      await c.query(ADD, [roundId, players[0], 1, 53.431, -6.119, null]);
      await c.query(ADD, [roundId, players[1], 1, 53.43, -6.12, 6]);

      for (const who of [ME, PAL]) {
        await as(c, who);
        const { rows } = await c.query<{ shot_no: number; recorded_by: string }>(
          "select shot_no, recorded_by from public.live_round_shots where player_id = $1 order by shot_no",
          [players[0]],
        );
        expect(rows).toEqual([
          { shot_no: 1, recorded_by: ME },
          { shot_no: 2, recorded_by: PAL },
        ]);
      }

      await as(c, STRANGER);
      expect((await c.query("select 1 from public.live_round_shots where round_id = $1", [roundId])).rowCount).toBe(0);
      await rejects(c, ADD, [roundId, players[0], 1, 53.43, -6.12, null], /Not your round/);
      await rejects(c, UNDO, [roundId, players[0], 1], /Not your round/);
      await rejects(
        c,
        "insert into public.live_round_shots (round_id, player_id, hole, shot_no, lat, lng) values ($1, $2, 1, 9, 0, 0)",
        [roundId, players[0]],
      );
    });
  });

  it("undo takes back only the last shot; bad input is refused", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, players } = await createRound(c);
      await as(c, ME);
      for (let i = 0; i < 3; i++) await c.query(ADD, [roundId, players[0], 2, 53.43 + i / 1000, -6.12, null]);
      await c.query(UNDO, [roundId, players[0], 2]);
      const { rows } = await c.query<{ shot_no: number }>(
        "select shot_no from public.live_round_shots where player_id = $1 order by shot_no",
        [players[0]],
      );
      expect(rows.map((r) => r.shot_no)).toEqual([1, 2]);

      await rejects(c, ADD, [roundId, players[0], 2, 123, -6.12, null], /not on the map/);
      await rejects(c, ADD, [roundId, players[0], 19, 53.43, -6.12, null], /No such hole/);
      // A player from someone else's round.
      await rejects(c, ADD, [roundId, "999999999", 2, 53.43, -6.12, null], /not in this round/);
      // An absurd accuracy is clamped, not stored as given.
      await c.query(ADD, [roundId, players[0], 3, 53.43, -6.12, 999999]);
      const acc = await c.query<{ accuracy_m: string }>(
        "select accuracy_m from public.live_round_shots where player_id = $1 and hole = 3",
        [players[0]],
      );
      expect(Number(acc.rows[0].accuracy_m)).toBe(5000);
    });
  });

  it("stops at twenty shots on a hole", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, players } = await createRound(c);
      await as(c, ME);
      for (let i = 0; i < 20; i++) await c.query(ADD, [roundId, players[0], 5, 53.43, -6.12, null]);
      await rejects(c, ADD, [roundId, players[0], 5, 53.43, -6.12, null], /enough shots/);
    });
  });

  it("a finished round is frozen", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, players } = await createRound(c);
      await as(c, ME);
      await c.query(ADD, [roundId, players[0], 1, 53.43, -6.12, null]);
      await c.query("select public.live_round_finish($1)", [roundId]);
      await rejects(c, ADD, [roundId, players[0], 1, 53.43, -6.12, null], /finished/);
      await rejects(c, UNDO, [roundId, players[0], 1], /finished/);
    });
  });

  it("a member who leaves PinPals takes their positions with them", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, players } = await createRound(c);
      await as(c, ME);
      await c.query(ADD, [roundId, players[0], 1, 53.43, -6.12, null]);
      await c.query(ADD, [roundId, players[1], 1, 53.43, -6.12, null]);
      await asService(c, () => c.query("update public.live_round_players set member_id = null where id = $1", [players[1]]));
      const { rows } = await asService(c, () =>
        c.query<{ player_id: string }>("select player_id from public.live_round_shots where round_id = $1", [roundId]),
      );
      expect(rows.map((r) => r.player_id)).toEqual([players[0]]);
    });
  });
});
