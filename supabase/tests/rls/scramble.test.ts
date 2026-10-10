// 0113_scramble.sql — scramble teams, scramble days, drives.
//
// Cast:
//   seller1    organises; plays in team 1
//   buyer1     a PinPal of seller1; team 1
//   moderator  a PinPal of seller1; team 2
//   seller2    a PinPal whom seller1 has blocked
//   buyer2     a stranger
//
// What must hold:
//   - a single team is a stroke round with the scramble columns; side 1 for all
//   - team sizes are 2 or 4 and every team has exactly that many
//   - everyone in a scramble day sees every team; strangers see nothing
//   - you score (and record drives for) your own team; the organiser any
//   - drives only for players in the team, only in a live scramble
//   - no direct writes to the drives table
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const PAL = USERS.buyer1;
const PAL2 = USERS.moderator;
const BLOCKED_PAL = USERS.seller2;
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

async function setUp(c: PoolClient): Promise<void> {
  await asService(c, async () => {
    for (const other of [PAL, PAL2, BLOCKED_PAL]) {
      await c.query(
        `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
         on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
        [ME, other],
      );
    }
    await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2) on conflict do nothing", [ME, BLOCKED_PAL]);
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
const round = (extra: object) =>
  JSON.stringify({ course_name: "Portmarnock Golf Club", holes: 18, allowance: 0.35, format: "scramble", ...extra });
const day = (extra: object = {}) =>
  JSON.stringify({ title: "Society Scramble", course_name: "Portmarnock Golf Club", holes: 18, scramble_size: 2, drive_minimum: 6, ...extra });

async function createDay(c: PoolClient) {
  await as(c, ME);
  const teams = JSON.stringify([
    { name: "The Eagles", tee_time: "09:00", team_handicap: 5, players: [p(ME, "Eire"), p(PAL, "Ciarán")] },
    { team_handicap: 7, players: [p(PAL2, "Niamh"), p(null, "Darragh")] },
  ]);
  const { rows } = await c.query<{ id: string }>("select public.live_scramble_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [day(), teams, card]);
  const dayId = rows[0].id;
  const rounds = await asService(c, () =>
    c.query<{ id: string }>("select id from public.live_rounds where match_day_id = $1 order by team_number", [dayId]),
  );
  return { dayId, team1: rounds.rows[0].id, team2: rounds.rows[1].id };
}

describe("scramble: one team", () => {
  it("is a stroke round with the scramble columns, every player on side 1", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
        round({ scramble_size: 2, team_name: "Us", team_handicap: 4, drive_minimum: 6 }),
        JSON.stringify([p(ME, "Eire"), p(PAL, "Ciarán")]),
        card,
      ]);
      const r = await asService(c, () =>
        c.query("select format, scramble_size, team_name, team_handicap, drive_minimum from public.live_rounds where id = $1", [rows[0].id]),
      );
      expect(r.rows[0]).toEqual({ format: "stroke", scramble_size: 2, team_name: "Us", team_handicap: 4, drive_minimum: 6 });
      const sides = await asService(c, () => c.query("select side from public.live_round_players where round_id = $1", [rows[0].id]));
      expect(sides.rows.every((x) => x.side === 1)).toBe(true);
    });
  });

  it("refuses the wrong number of players, a missing team handicap and odd sizes", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const create = "select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb)";
      await rejects(c, create, [round({ scramble_size: 4, team_handicap: 4 }), JSON.stringify([p(ME, "Eire"), p(PAL, "C")]), card], /4 person scramble/);
      await rejects(c, create, [round({ scramble_size: 2 }), JSON.stringify([p(ME, "Eire"), p(PAL, "C")]), card], /team handicap/);
      await rejects(c, create, [round({ scramble_size: 3, team_handicap: 4 }), JSON.stringify([p(ME, "Eire"), p(PAL, "C"), p(null, "G")]), card], /2 or 4/);
    });
  });
});

describe("scramble days", () => {
  it("creates one round per team, numbered and named, with the day's size and drive minimum", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { dayId } = await createDay(c);
      const d = await asService(c, () => c.query("select kind from public.live_match_days where id = $1", [dayId]));
      expect(d.rows[0].kind).toBe("scramble");
      const rounds = await asService(c, () =>
        c.query(
          "select team_number, team_name, team_handicap, scramble_size, drive_minimum, format, tee_time::text from public.live_rounds where match_day_id = $1 order by team_number",
          [dayId],
        ),
      );
      expect(rounds.rows).toEqual([
        { team_number: 1, team_name: "The Eagles", team_handicap: 5, scramble_size: 2, drive_minimum: 6, format: "stroke", tee_time: "09:00:00" },
        { team_number: 2, team_name: "Team 2", team_handicap: 7, scramble_size: 2, drive_minimum: 6, format: "stroke", tee_time: null },
      ]);
    });
  });

  it("refuses strangers, blocked PinPals, anyone twice and wrong-sized teams", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const create = "select public.live_scramble_day_create($1::jsonb, $2::jsonb, $3::jsonb)";
      for (const who of [STRANGER, BLOCKED_PAL]) {
        await rejects(c, create, [day(), JSON.stringify([{ team_handicap: 5, players: [p(ME, "Eire"), p(who, "X")] }]), card], /PinPals, or guests/);
      }
      await rejects(
        c,
        create,
        [day(), JSON.stringify([
          { team_handicap: 5, players: [p(ME, "Eire"), p(PAL, "C")] },
          { team_handicap: 5, players: [p(PAL, "C"), p(null, "G")] },
        ]), card],
        /two teams/,
      );
      await rejects(c, create, [day(), JSON.stringify([{ team_handicap: 5, players: [p(ME, "Eire")] }]), card], /needs 2 players/);
      await rejects(c, create, [day({ scramble_size: 3 }), JSON.stringify([{ team_handicap: 5, players: [p(ME, "Eire"), p(PAL, "C"), p(null, "G")] }]), card], /2 or 4/);
    });
  });

  it("everyone in the day sees every team; a stranger sees nothing", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { dayId } = await createDay(c);
      for (const who of [ME, PAL, PAL2]) {
        await as(c, who);
        expect((await c.query("select 1 from public.live_rounds where match_day_id = $1", [dayId])).rowCount).toBe(2);
      }
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.live_rounds where match_day_id = $1", [dayId])).rowCount).toBe(0);
    });
  });
});

describe("scramble: drives", () => {
  it("your team records its drives; the organiser any team; nobody else", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { team1, team2 } = await createDay(c);
      const drive = "select public.live_round_set_drive($1, $2::smallint, $3::smallint)";

      await as(c, PAL2); // team 2
      await c.query(drive, [team2, 1, 2]);
      await rejects(c, drive, [team1, 1, 1], /Not your round/);

      await as(c, ME); // organiser, team 1
      await c.query(drive, [team2, 2, 1]);
      await c.query(drive, [team1, 1, 2]);
      await c.query(drive, [team1, 1, 1]); // changed mind
      const rows = await c.query("select hole, position from public.live_round_drives where round_id = $1", [team1]);
      expect(rows.rows).toEqual([{ hole: 1, position: 1 }]);

      await c.query(drive, [team1, 1, null]); // cleared
      expect((await c.query("select 1 from public.live_round_drives where round_id = $1", [team1])).rowCount).toBe(0);

      await rejects(c, drive, [team1, 1, 3], /not in this team/);
      await rejects(c, drive, [team1, 19, 1], /No such hole/);

      await as(c, STRANGER);
      await rejects(c, drive, [team1, 1, 1], /Not your round/);
      expect((await c.query("select 1 from public.live_round_drives where round_id = $1", [team2])).rowCount).toBe(0);
    });
  });

  it("not for an ordinary round, and no direct writes", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
        JSON.stringify({ course_name: "Portmarnock Golf Club", holes: 18, allowance: 0.95, format: "stableford" }),
        JSON.stringify([p(ME, "Eire")]),
        card,
      ]);
      await rejects(c, "select public.live_round_set_drive($1, 1::smallint, 1::smallint)", [rows[0].id], /only kept for a scramble/);
      await rejects(c, "insert into public.live_round_drives (round_id, hole, position) values ($1, 1, 1)", [rows[0].id], /permission denied/);
    });
  });
});
