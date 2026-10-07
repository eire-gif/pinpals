// 0104_match_days.sql — several matches on one day, in teams.
//
// Cast:
//   seller1    organises the day, plays in match 1
//   buyer1     a PinPal of seller1, plays in match 1
//   moderator  a PinPal of seller1, plays in match 2
//   seller2    a PinPal whom seller1 has blocked
//   buyer2     a stranger
//
// What must hold:
//   - everyone in the day sees every match (that's the board); strangers see nothing
//   - you score the match you're in; the organiser can score any; nobody else
//   - the organiser adds only themselves, PinPals and guests; nobody twice;
//     match shapes are checked (singles 1 a side, pairs formats 2 a side)
//   - live-day-<id> broadcasts reach only people in the day
//   - no direct writes
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

const p = (memberId: string | null, name: string, side: 1 | 2) => ({
  member_id: memberId,
  name,
  handicap_index: 12.0,
  course_handicap: 14,
  playing_handicap: 13,
  handicap_estimated: false,
  side,
});

const day = JSON.stringify({ title: "Saturday Society", course_name: "Portmarnock Golf Club", holes: 18, team_names: ["Blues", "Golds"] });
const card = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));

/** Match 1: fourball, ME + guest v PAL + guest. Match 2: singles, PAL2 v guest. */
const standardMatches = () =>
  JSON.stringify([
    { match_type: "fourball", tee_time: "09:20", players: [p(ME, "Eire", 1), p(null, "Tom", 1), p(PAL, "Ciarán", 2), p(null, "Ruth", 2)] },
    { match_type: "singles", tee_time: "09:30", players: [p(PAL2, "Niamh", 1), p(null, "Darragh", 2)] },
  ]);

async function createDay(c: PoolClient) {
  await as(c, ME);
  const { rows } = await c.query<{ id: string }>("select public.live_match_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    day,
    standardMatches(),
    card,
  ]);
  const dayId = rows[0].id;
  const rounds = await asService(c, () =>
    c.query<{ id: string; match_number: number }>("select id, match_number from public.live_rounds where match_day_id = $1 order by match_number", [dayId]),
  );
  const players = await asService(c, () =>
    c.query<{ id: string; round_id: string; position: number; side: number }>(
      "select p.id, p.round_id, p.position, p.side from public.live_round_players p join public.live_rounds r on r.id = p.round_id where r.match_day_id = $1 order by r.match_number, p.position",
      [dayId],
    ),
  );
  return { dayId, match1: rounds.rows[0].id, match2: rounds.rows[1].id, players: players.rows };
}

describe("match days: creating", () => {
  it("creates the day and each match with its format, allowance, sides and a copy of the card", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { dayId, match1, match2, players } = await createDay(c);
      const rounds = await asService(c, () =>
        c.query("select match_number, format, match_type, allowance::text, tee_time::text from public.live_rounds where match_day_id = $1 order by match_number", [dayId]),
      );
      expect(rounds.rows).toEqual([
        { match_number: 1, format: "matchplay", match_type: "fourball", allowance: "0.90", tee_time: "09:20:00" },
        { match_number: 2, format: "matchplay", match_type: "singles", allowance: "1.00", tee_time: "09:30:00" },
      ]);
      // Side 1 first: a one-ball pair's score lives on its first player.
      expect(players.filter((x) => x.round_id === match1).map((x) => [x.position, x.side])).toEqual([[1, 1], [2, 1], [3, 2], [4, 2]]);
      const holes = await asService(c, () => c.query("select count(*)::int as n from public.live_round_holes where round_id = $1", [match2]));
      expect(holes.rows[0].n).toBe(18);
      const teams = await asService(c, () => c.query("select team_names from public.live_match_days where id = $1", [dayId]));
      expect(teams.rows[0].team_names).toEqual(["Blues", "Golds"]);
    });
  });

  it("refuses strangers, blocked PinPals, anyone twice, and wrong-sized matches", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const create = "select public.live_match_day_create($1::jsonb, $2::jsonb, $3::jsonb)";
      for (const who of [STRANGER, BLOCKED_PAL]) {
        await rejects(c, create, [day, JSON.stringify([{ match_type: "singles", players: [p(ME, "Eire", 1), p(who, "X", 2)] }]), card], /PinPals, or guests/);
      }
      await rejects(
        c,
        create,
        [day, JSON.stringify([
          { match_type: "singles", players: [p(ME, "Eire", 1), p(PAL, "Ciarán", 2)] },
          { match_type: "singles", players: [p(PAL, "Ciarán", 1), p(null, "Guest", 2)] },
        ]), card],
        /two matches/,
      );
      await rejects(c, create, [day, JSON.stringify([{ match_type: "fourball", players: [p(ME, "Eire", 1), p(PAL, "C", 2)] }]), card], /two a side|one player a side/);
      await rejects(c, create, [day, JSON.stringify([{ match_type: "singles", players: [p(ME, "Eire", 1), p(null, "G", 1)] }]), card], /one player a side/);
      await rejects(c, create, [day, JSON.stringify([{ match_type: "stableford", players: [p(ME, "Eire", 1), p(null, "G", 2)] }]), card], /needs a format/);
    });
  });
});

describe("match days: seeing and scoring", () => {
  it("everyone in the day sees every match; a stranger sees nothing", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { dayId, match2 } = await createDay(c);
      for (const who of [ME, PAL, PAL2]) {
        await as(c, who);
        expect((await c.query("select 1 from public.live_match_days where id = $1", [dayId])).rowCount).toBe(1);
        expect((await c.query("select 1 from public.live_rounds where match_day_id = $1", [dayId])).rowCount).toBe(2);
        expect((await c.query("select 1 from public.live_round_players where round_id = $1", [match2])).rowCount).toBe(2);
      }
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.live_match_days where id = $1", [dayId])).rowCount).toBe(0);
      expect((await c.query("select 1 from public.live_rounds where match_day_id = $1", [dayId])).rowCount).toBe(0);
    });
  });

  it("you score your own match; the organiser can score any; others can't", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { match1, match2, players } = await createDay(c);
      const m2player = players.find((x) => x.round_id === match2)!.id;
      const m1player = players.find((x) => x.round_id === match1)!.id;
      const score = "select public.live_round_set_score($1, $2, 1::smallint, 4::smallint)";

      await as(c, PAL); // match 1
      await c.query(score, [match1, m1player]);
      await rejects(c, score, [match2, m2player], /Not your round/);
      await rejects(c, "select public.live_round_finish($1)", [match2], /Not your round/);

      await as(c, PAL2); // match 2
      await c.query(score, [match2, m2player]);

      await as(c, ME); // organiser, playing in match 1
      await c.query("select public.live_round_set_score($1, $2, 2::smallint, 5::smallint)", [match2, m2player]);

      await as(c, STRANGER);
      await rejects(c, score, [match1, m1player], /Not your round/);
    });
  });

  it("live-day broadcasts reach only people in the day", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { dayId } = await createDay(c);
      await asService(c, () =>
        c.query("insert into realtime.messages (topic, extension, event, private) values ($1, 'broadcast', 'changed', true)", [`live-day-${dayId}`]),
      );
      const read = () => c.query("select 1 from realtime.messages where topic = $1", [`live-day-${dayId}`]);
      await as(c, PAL2);
      expect((await read()).rowCount).toBe(1);
      await as(c, STRANGER);
      expect((await read()).rowCount).toBe(0);
    });
  });

  it("no direct writes to match days", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { dayId } = await createDay(c);
      await as(c, ME);
      await rejects(c, "update public.live_match_days set title = 'x' where id = $1", [dayId], /permission denied/);
      await rejects(c, "insert into public.live_match_days (title, course_name) values ('x', 'y')", [], /permission denied/);
    });
  });

  it("an ordinary round can't carry a match type", async () => {
    await withRole("authenticated", ME, async (c) => {
      await asService(c, async () => {
        await rejects(
          c,
          "insert into public.live_rounds (course_name, format, allowance, match_type) values ('x', 'stableford', 0.95, 'fourball')",
          [],
          /live_rounds_match_type_is_matchplay/,
        );
      });
    });
  });
});

// 0105 — deleting.
describe("match days: deleting", () => {
  it("the organiser deletes one match, or the whole day; players and strangers can't", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { dayId, match1, match2 } = await createDay(c);

      for (const who of [PAL, PAL2, STRANGER]) {
        await as(c, who);
        await rejects(c, "select public.live_match_day_delete($1)", [dayId], /Only the organiser/);
        await rejects(c, "select public.live_round_delete($1)", [match2], /Only the person who started/);
      }

      await as(c, ME);
      await c.query("select public.live_round_delete($1)", [match2]);
      const count = (sql: string, id: string) => asService(c, () => c.query<{ n: number }>(sql, [id]));
      expect((await count("select count(*)::int as n from public.live_rounds where match_day_id = $1", dayId)).rows[0].n).toBe(1);

      await c.query("select public.live_match_day_delete($1)", [dayId]);
      expect((await count("select count(*)::int as n from public.live_match_days where id = $1", dayId)).rows[0].n).toBe(0);
      expect((await count("select count(*)::int as n from public.live_rounds where id = $1", match1)).rows[0].n).toBe(0);
      expect((await count("select count(*)::int as n from public.live_round_players where round_id = $1", match1)).rows[0].n).toBe(0);
    });
  });
});
