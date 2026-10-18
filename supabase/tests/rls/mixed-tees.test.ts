// 0176_mixed_tees.sql — players on different tees in one day.
//
// What must hold:
//   - the day-create functions keep each player's tees and adjustment
//     (fourball and scramble/pairs days), and default to the day's tees
//   - a player off other tees who saves their card for the handicap record
//     saves it on THEIR tees: that card's rating, slope, par, pars and stroke
//     indexes, and their playing handicap without the competition adjustment
//   - someone on the day's tees saves as before
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

async function setUp(c: PoolClient): Promise<string> {
  return asService(c, async () => {
    await c.query(
      `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
      [ME, PAL],
    );
    const { rows } = await c.query<{ id: string }>(
      "insert into public.clubs (name, slug, country) values ('Test Links', 'test-links-' || gen_random_uuid(), 'ireland') returning id",
    );
    return rows[0].id;
  });
}

// The whites: par 4s, SI 1–18. The reds: hole 1 is a par 5 and the stroke indexes run backwards.
const WHITE = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 }));
const RED = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: i === 0 ? 5 : 4, stroke_index: 18 - i }));

async function cards(c: PoolClient, clubId: string): Promise<void> {
  await as(c, ME);
  await c.query("select public.course_card_save($1, 'White', 18::smallint, 72::smallint, 71.3, 128::smallint, $2::jsonb)", [clubId, JSON.stringify(WHITE)]);
  await c.query("select public.course_card_save($1, 'Red', 18::smallint, 73::smallint, 74.1, 133::smallint, $2::jsonb)", [clubId, JSON.stringify(RED)]);
}

const player = (memberId: string, name: string, ph: number, tee?: { tee_name: string; tee_extra: number }) => ({
  member_id: memberId,
  name,
  handicap_index: 18.4,
  course_handicap: 20,
  playing_handicap: ph,
  handicap_estimated: false,
  ...(tee ?? {}),
});

const day = (clubId: string, extra: object = {}) =>
  JSON.stringify({
    title: "Mixed Stableford",
    course_name: "Test Links",
    club_id: Number(clubId),
    tee_name: "White",
    holes: 18,
    course_rating: 71.3,
    slope: 128,
    par_total: 72,
    format: "stableford",
    allowance: 0.95,
    ...extra,
  });

const tees = (c: PoolClient, dayId: string) =>
  asService(c, () =>
    c.query(
      `select p.member_id, p.tee_name, p.tee_extra, p.playing_handicap
         from public.live_round_players p join public.live_rounds r on r.id = p.round_id
        where r.match_day_id = $1 order by p.position`,
      [dayId],
    ),
  );

describe("mixed tees: the day keeps each player's tees", () => {
  it("a fourball day: the lady off the reds with +1, the man on the day's tees", async () => {
    await withRole("authenticated", ME, async (c) => {
      const clubId = await setUp(c);
      await as(c, ME);
      const groups = JSON.stringify([{ players: [player(ME, "Eire", 19), player(PAL, "Aoife", 21, { tee_name: "Red", tee_extra: 1 })] }]);
      const { rows } = await c.query<{ id: string }>("select public.live_fourball_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [day(clubId), groups, JSON.stringify(WHITE)]);
      expect((await tees(c, rows[0].id)).rows).toEqual([
        { member_id: ME, tee_name: null, tee_extra: 0, playing_handicap: 19 },
        { member_id: PAL, tee_name: "Red", tee_extra: 1, playing_handicap: 21 },
      ]);
    });
  });

  it("a pairs day keeps them too", async () => {
    await withRole("authenticated", ME, async (c) => {
      const clubId = await setUp(c);
      await as(c, ME);
      const pairs = JSON.stringify([{ team_handicap: 10, players: [player(ME, "Eire", 10), player(PAL, "Aoife", 10, { tee_name: "Red", tee_extra: 1 })] }]);
      const { rows } = await c.query<{ id: string }>("select public.live_scramble_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
        day(clubId, { scramble_size: 2, foursomes_scoring: "stableford" }),
        pairs,
        JSON.stringify(WHITE),
      ]);
      expect((await tees(c, rows[0].id)).rows.map((r) => [r.tee_name, r.tee_extra])).toEqual([
        [null, 0],
        ["Red", 1],
      ]);
    });
  });
});

describe("mixed tees: saving a card for the handicap record", () => {
  it("off other tees, the card goes in on those tees; on the day's tees, as before", async () => {
    await withRole("authenticated", ME, async (c) => {
      const clubId = await setUp(c);
      await cards(c, clubId);
      await as(c, ME);
      const groups = JSON.stringify([{ players: [player(ME, "Eire", 19), player(PAL, "Aoife", 21, { tee_name: "Red", tee_extra: 1 })] }]);
      const { rows } = await c.query<{ id: string }>("select public.live_fourball_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [day(clubId), groups, JSON.stringify(WHITE)]);
      const roundId = (await asService(c, () => c.query<{ id: string }>("select id from public.live_rounds where match_day_id = $1", [rows[0].id]))).rows[0].id;

      await as(c, PAL);
      const hers = (await c.query<{ id: string }>("select public.scorecard_from_live_round($1) as id", [roundId])).rows[0].id;
      const card = await asService(c, () =>
        c.query("select tee_name, par_total, course_rating::float as course_rating, slope, playing_handicap from public.scorecards where id = $1", [hers]),
      );
      expect(card.rows[0]).toEqual({ tee_name: "Red", par_total: 73, course_rating: 74.1, slope: 133, playing_handicap: 20 });
      const first = await asService(c, () => c.query("select par, stroke_index from public.scorecard_holes where scorecard_id = $1 and hole = 1", [hers]));
      expect(first.rows[0]).toEqual({ par: 5, stroke_index: 18 });

      await as(c, ME);
      const mine = (await c.query<{ id: string }>("select public.scorecard_from_live_round($1) as id", [roundId])).rows[0].id;
      const my = await asService(c, () =>
        c.query("select tee_name, par_total, course_rating::float as course_rating, slope, playing_handicap from public.scorecards where id = $1", [mine]),
      );
      expect(my.rows[0]).toEqual({ tee_name: "White", par_total: 72, course_rating: 71.3, slope: 128, playing_handicap: 19 });
      const myFirst = await asService(c, () => c.query("select par, stroke_index from public.scorecard_holes where scorecard_id = $1 and hole = 1", [mine]));
      expect(myFirst.rows[0]).toEqual({ par: 4, stroke_index: 1 });
    });
  });
});
