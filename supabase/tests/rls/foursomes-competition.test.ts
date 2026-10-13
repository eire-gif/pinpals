// 0136_foursomes_competition.sql — foursomes (Scotch foursomes) pairs on a
// Stableford or stroke-play leaderboard.
//
// Cast:
//   seller1    organises; plays in pair 1
//   buyer1     a PinPal of seller1; pair 1
//   moderator  a PinPal of seller1; pair 2
//   seller2    a PinPal whom seller1 has blocked
//   buyer2     a stranger
//
// What must hold:
//   - one pair is a 2-person team round marked foursomes, no drives
//   - a pair is exactly two players, has its handicap, and is scored by
//     Stableford or stroke play only
//   - a day of pairs: every team two players, allowance 0.5, the day and
//     each round marked, no drives even if asked for, "Pair n" by default
//   - the add-player rule is unchanged (strangers, blocked refused)
//   - everyone in the day sees every pair; a stranger sees nothing
//   - foursomes_scoring can't be set on anything but a pair
//   - an ordinary scramble is untouched (foursomes_scoring null)
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

const p = (memberId: string | null, name: string, ch = 14) => ({
  member_id: memberId,
  name,
  handicap_index: 12.0,
  course_handicap: ch,
  playing_handicap: Math.round(ch / 2),
  handicap_estimated: false,
});

const card = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));
const pair = (extra: object) =>
  JSON.stringify({ course_name: "Portmarnock Golf Club", holes: 18, allowance: 0.5, format: "foursomes", ...extra });
const day = (extra: object = {}) =>
  JSON.stringify({ title: "Mixed Foursomes", course_name: "Portmarnock Golf Club", holes: 18, scramble_size: 2, foursomes_scoring: "stableford", ...extra });

const CREATE_ROUND = "select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id";
const CREATE_DAY = "select public.live_scramble_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id";

describe("foursomes: one pair", () => {
  it("is a 2-person team round marked foursomes, with no drives", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const { rows } = await c.query<{ id: string }>(CREATE_ROUND, [
        pair({ scoring: "stableford", team_name: "Eire & Ciarán", team_handicap: 14, drive_minimum: 6 }),
        JSON.stringify([p(ME, "Eire", 9), p(PAL, "Ciarán", 18)]),
        card,
      ]);
      const r = await asService(c, () =>
        c.query(
          "select format, scramble_size, team_name, team_handicap, drive_minimum, foursomes_scoring, allowance::float as allowance from public.live_rounds where id = $1",
          [rows[0].id],
        ),
      );
      expect(r.rows[0]).toEqual({
        format: "stroke",
        scramble_size: 2,
        team_name: "Eire & Ciarán",
        team_handicap: 14,
        drive_minimum: null,
        foursomes_scoring: "stableford",
        allowance: 0.5,
      });
      const sides = await asService(c, () => c.query("select side from public.live_round_players where round_id = $1", [rows[0].id]));
      expect(sides.rows.map((x) => x.side)).toEqual([1, 1]);
    });
  });

  it("refuses anything but two players, a missing handicap, or another scoring", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const two = JSON.stringify([p(ME, "Eire"), p(PAL, "Ciarán")]);
      await rejects(c, CREATE_ROUND, [pair({ scoring: "stroke", team_handicap: 4 }), JSON.stringify([p(ME, "Eire"), p(PAL, "C"), p(null, "G"), p(null, "H")]), card], /two players/);
      await rejects(c, CREATE_ROUND, [pair({ scoring: "stroke" }), two, card], /handicap/);
      await rejects(c, CREATE_ROUND, [pair({ scoring: "matchplay", team_handicap: 4 }), two, card], /Stableford or stroke play/);
      await rejects(c, CREATE_ROUND, [pair({ team_handicap: 4 }), two, card], /Stableford or stroke play/);
    });
  });

  it("still won't put a stranger or a blocked PinPal on the card", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      await rejects(c, CREATE_ROUND, [pair({ scoring: "stroke", team_handicap: 4 }), JSON.stringify([p(ME, "Eire"), p(STRANGER, "S")]), card], /PinPals/);
      await rejects(c, CREATE_ROUND, [pair({ scoring: "stroke", team_handicap: 4 }), JSON.stringify([p(ME, "Eire"), p(BLOCKED_PAL, "B")]), card], /PinPals/);
    });
  });
});

describe("foursomes: a day of pairs", () => {
  async function createDay(c: PoolClient, extra: object = {}) {
    await as(c, ME);
    const teams = JSON.stringify([
      { name: "Eire & Ciarán", tee_time: "09:00", team_handicap: 14, players: [p(ME, "Eire", 9), p(PAL, "Ciarán", 18)] },
      { tee_time: "09:00", team_handicap: 9, players: [p(PAL2, "Niamh", 6), p(null, "Darragh", 12)] },
    ]);
    const { rows } = await c.query<{ id: string }>(CREATE_DAY, [day(extra), teams, card]);
    return rows[0].id;
  }

  it("marks the day and every pair, allowance 0.5, no drives, Pair n by default", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const dayId = await createDay(c, { drive_minimum: 6 });
      const d = await asService(c, () => c.query("select kind, foursomes_scoring from public.live_match_days where id = $1", [dayId]));
      expect(d.rows[0]).toEqual({ kind: "scramble", foursomes_scoring: "stableford" });
      const rounds = await asService(c, () =>
        c.query(
          "select team_number, team_name, team_handicap, scramble_size, drive_minimum, foursomes_scoring, allowance::float as allowance, tee_time::text as tee_time from public.live_rounds where match_day_id = $1 order by team_number",
          [dayId],
        ),
      );
      expect(rounds.rows).toEqual([
        { team_number: 1, team_name: "Eire & Ciarán", team_handicap: 14, scramble_size: 2, drive_minimum: null, foursomes_scoring: "stableford", allowance: 0.5, tee_time: "09:00:00" },
        { team_number: 2, team_name: "Pair 2", team_handicap: 9, scramble_size: 2, drive_minimum: null, foursomes_scoring: "stableford", allowance: 0.5, tee_time: "09:00:00" },
      ]);
    });
  });

  it("is pairs only, Stableford or stroke play", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const fours = JSON.stringify([{ team_handicap: 5, players: [p(ME, "E"), p(PAL, "C"), p(PAL2, "N"), p(null, "D")] }]);
      await rejects(c, CREATE_DAY, [day({ scramble_size: 4 }), fours, card], /pairs/);
      const pairs = JSON.stringify([{ team_handicap: 5, players: [p(ME, "E"), p(PAL, "C")] }]);
      await rejects(c, CREATE_DAY, [day({ foursomes_scoring: "matchplay" }), pairs, card], /Stableford or stroke play/);
    });
  });

  it("everyone in the day sees every pair; a stranger sees nothing", async () => {
    let dayId = "";
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      dayId = await createDay(c);
      await as(c, PAL);
      const seen = await c.query("select id from public.live_rounds where match_day_id = $1", [dayId]);
      expect(seen.rows).toHaveLength(2);
      await as(c, STRANGER);
      const none = await c.query("select id from public.live_rounds where match_day_id = $1", [dayId]);
      expect(none.rows).toHaveLength(0);
      const noDay = await c.query("select id from public.live_match_days where id = $1", [dayId]);
      expect(noDay.rows).toHaveLength(0);
    });
  });

  it("an ordinary scramble day is untouched", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const teams = JSON.stringify([{ team_handicap: 5, players: [p(ME, "Eire"), p(PAL, "Ciarán")] }]);
      const { rows } = await c.query<{ id: string }>(CREATE_DAY, [
        JSON.stringify({ title: "Scramble", course_name: "Portmarnock Golf Club", holes: 18, scramble_size: 2, drive_minimum: 6 }),
        teams,
        card,
      ]);
      const r = await asService(c, () =>
        c.query("select drive_minimum, foursomes_scoring, team_name, allowance::float as allowance from public.live_rounds where match_day_id = $1", [rows[0].id]),
      );
      expect(r.rows[0]).toEqual({ drive_minimum: 6, foursomes_scoring: null, team_name: "Team 1", allowance: 0.35 });
    });
  });
});

describe("foursomes: the columns", () => {
  it("foursomes_scoring belongs only on a pair", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const { rows } = await c.query<{ id: string }>(CREATE_ROUND, [
        JSON.stringify({ course_name: "Portmarnock Golf Club", holes: 18, allowance: 0.95, format: "stableford" }),
        JSON.stringify([p(ME, "Eire")]),
        card,
      ]);
      await asService(c, () =>
        rejects(c, "update public.live_rounds set foursomes_scoring = 'stroke' where id = $1", [rows[0].id], /live_rounds_foursomes_is_a_pair/),
      );
    });
  });
});
