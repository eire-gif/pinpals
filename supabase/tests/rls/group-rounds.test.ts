// 0121_group_rounds.sql — group-mates on a card, and the society day.
//
// Cast (no connections between any of them unless a test makes one):
//   seller1    runs the society (owner); in the crew
//   moderator  a society admin (the committee)
//   buyer1     an ordinary society member; in the crew
//   buyer2     an ordinary society member
//   seller2    in nothing: a stranger
//
// What must hold:
//   - whoever runs a group can put any of its members on a card
//   - an ordinary member of a society can't put other members on cards
//   - anyone in a crew or trip can put the others on cards
//   - a block still wins, group or not
//   - a society day is one day with a round per group, everyone on it can see
//     every card, and you score only your own group's card
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const SECRETARY = USERS.seller1;
const COMMITTEE = USERS.moderator;
const MEMBER = USERS.buyer1;
const MEMBER2 = USERS.buyer2;
const STRANGER = USERS.seller2;

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

/** A society run by SECRETARY (COMMITTEE as admin, MEMBER and MEMBER2 in it),
 *  and a crew of SECRETARY and MEMBER. Returns their ids. */
async function setUp(c: PoolClient): Promise<{ society: string; crew: string }> {
  await as(c, SECRETARY);
  const society = (await c.query<{ id: string }>("select public.create_group('society', 'Malahide Golf Society') as id")).rows[0].id;
  const crew = (await c.query<{ id: string }>("select public.create_group('crew', 'Saturday Crew') as id")).rows[0].id;
  await asService(c, async () => {
    for (const m of [COMMITTEE, MEMBER, MEMBER2]) await c.query("select public.group_add_member($1, $2)", [society, m]);
    await c.query("select public.group_add_member($1, $2)", [crew, MEMBER]);
  });
  await c.query("select public.set_group_office($1, $2, 'captain')", [society, COMMITTEE]);
  return { society, crew };
}

const p = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 12.0,
  course_handicap: 14,
  playing_handicap: 13,
  handicap_estimated: false,
});

const card = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));
const round = JSON.stringify({ course_name: "Portmarnock Golf Club", holes: 18, allowance: 0.95, format: "stableford" });
const createRound = "select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id";
const day = (extra: object = {}) =>
  JSON.stringify({ title: "Captain's Day", course_name: "Portmarnock Golf Club", holes: 18, format: "stableford", allowance: 0.95, ...extra });
const createDay = "select public.live_fourball_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id";

// ---------------------------------------------------------------------------

describe("who can be put on a card, now that there are groups", () => {
  it("whoever runs a society can add its members without being connected", async () => {
    await withRole("authenticated", SECRETARY, async (c) => {
      await setUp(c);
      await as(c, SECRETARY);
      const { rows } = await c.query<{ id: string }>(createRound, [round, JSON.stringify([p(SECRETARY, "Eire"), p(MEMBER2, "Niall")]), card]);
      expect(rows[0].id).toBeTruthy();
      // So can the committee.
      await as(c, COMMITTEE);
      expect((await c.query(createRound, [round, JSON.stringify([p(COMMITTEE, "Dave"), p(MEMBER2, "Niall")]), card])).rowCount).toBe(1);
    });
  });

  it("an ordinary society member can't put other members on a card", async () => {
    await withRole("authenticated", SECRETARY, async (c) => {
      await setUp(c);
      await as(c, MEMBER2);
      await rejects(c, createRound, [round, JSON.stringify([p(MEMBER2, "Niall"), p(COMMITTEE, "Dave")]), card], /people in your group/);
    });
  });

  it("anyone in a crew can add the others", async () => {
    await withRole("authenticated", SECRETARY, async (c) => {
      await setUp(c);
      await as(c, MEMBER);
      expect((await c.query(createRound, [round, JSON.stringify([p(MEMBER, "Ciarán"), p(SECRETARY, "Eire")]), card])).rowCount).toBe(1);
    });
  });

  it("a stranger is still refused, and a block wins over a group", async () => {
    await withRole("authenticated", SECRETARY, async (c) => {
      await setUp(c);
      await as(c, SECRETARY);
      await rejects(c, createRound, [round, JSON.stringify([p(SECRETARY, "Eire"), p(STRANGER, "X")]), card], /people in your group/);
      await asService(c, () => c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [MEMBER2, SECRETARY]));
      await rejects(c, createRound, [round, JSON.stringify([p(SECRETARY, "Eire"), p(MEMBER2, "Niall")]), card], /people in your group/);
    });
  });

  it("the same rule holds for scramble days", async () => {
    await withRole("authenticated", SECRETARY, async (c) => {
      await setUp(c);
      await as(c, SECRETARY);
      const scramble = JSON.stringify({ title: "Scramble", course_name: "Portmarnock Golf Club", holes: 18, scramble_size: 2 });
      const teams = JSON.stringify([{ team_handicap: 5, players: [p(SECRETARY, "Eire"), p(MEMBER2, "Niall")] }]);
      expect((await c.query("select public.live_scramble_day_create($1::jsonb, $2::jsonb, $3::jsonb)", [scramble, teams, card])).rowCount).toBe(1);
    });
  });
});

describe("the society day", () => {
  it("is one day with a round per group, in tee order", async () => {
    await withRole("authenticated", SECRETARY, async (c) => {
      await setUp(c);
      await as(c, SECRETARY);
      const groups = JSON.stringify([
        { tee_time: "09:00", players: [p(SECRETARY, "Eire"), p(COMMITTEE, "Dave"), p(null, "A guest")] },
        { tee_time: "09:10", players: [p(MEMBER, "Ciarán"), p(MEMBER2, "Niall")] },
      ]);
      const id = (await c.query<{ id: string }>(createDay, [day(), groups, card])).rows[0].id;
      const d = await c.query<{ kind: string }>("select kind from public.live_match_days where id = $1", [id]);
      expect(d.rows[0].kind).toBe("fourballs");
      const rounds = await c.query<{ match_number: number; format: string; tee_time: string; n: string }>(
        `select r.match_number, r.format, r.tee_time::text, (select count(*) from public.live_round_players p where p.round_id = r.id) as n
           from public.live_rounds r where r.match_day_id = $1 order by r.match_number`,
        [id],
      );
      expect(rounds.rows.map((r) => [r.match_number, r.format, r.tee_time, Number(r.n)])).toEqual([
        [1, "stableford", "09:00:00", 3],
        [2, "stableford", "09:10:00", 2],
      ]);
    });
  });

  it("everyone in the day sees every card, but scores only their own", async () => {
    await withRole("authenticated", SECRETARY, async (c) => {
      await setUp(c);
      await as(c, SECRETARY);
      const groups = JSON.stringify([
        { players: [p(SECRETARY, "Eire"), p(COMMITTEE, "Dave")] },
        { players: [p(MEMBER, "Ciarán"), p(MEMBER2, "Niall")] },
      ]);
      const id = (await c.query<{ id: string }>(createDay, [day(), groups, card])).rows[0].id;
      const group1 = await asService(c, () =>
        c.query<{ round_id: string; player_id: string }>(
          `select r.id as round_id, p.id as player_id from public.live_rounds r
             join public.live_round_players p on p.round_id = r.id and p.position = 1
            where r.match_day_id = $1 and r.match_number = 1`,
          [id],
        ),
      );
      const { round_id, player_id } = group1.rows[0];

      await as(c, MEMBER2);
      expect((await c.query("select id from public.live_rounds where match_day_id = $1", [id])).rowCount).toBe(2);
      await rejects(c, "select public.live_round_set_score($1, $2, 1::smallint, 4::smallint)", [round_id, player_id]);

      await as(c, STRANGER);
      expect((await c.query("select id from public.live_rounds where match_day_id = $1", [id])).rowCount).toBe(0);

      // The organiser can fix any card.
      await as(c, SECRETARY);
      await c.query("select public.live_round_set_score($1, $2, 1::smallint, 4::smallint)", [round_id, player_id]);
    });
  });

  it("refuses strangers, anyone twice, the wrong format and empty groups", async () => {
    await withRole("authenticated", SECRETARY, async (c) => {
      await setUp(c);
      await as(c, SECRETARY);
      const one = (players: object[]) => JSON.stringify([{ players }]);
      await rejects(c, createDay, [day(), one([p(SECRETARY, "Eire"), p(STRANGER, "X")]), card], /people in your group/);
      await rejects(
        c,
        createDay,
        [day(), JSON.stringify([{ players: [p(SECRETARY, "Eire"), p(MEMBER, "C")] }, { players: [p(MEMBER, "C")] }]), card],
        /two groups/,
      );
      await rejects(c, createDay, [day({ format: "matchplay" }), one([p(SECRETARY, "Eire")]), card], /Stableford or stroke/);
      await rejects(c, createDay, [day(), JSON.stringify([{ players: [] }]), card], /between 1 and 5/);
      await rejects(c, createDay, [day({ title: " " }), one([p(SECRETARY, "Eire")]), card], /name/);
    });
  });
});
