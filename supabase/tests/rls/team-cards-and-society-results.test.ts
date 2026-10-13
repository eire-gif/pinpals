// 0138_team_cards_and_society_results.sql
//
// Cast:
//   seller1    pair 1 (first player); organises
//   buyer1     pair 1 (partner)
//   moderator  pair 2
//   buyer2     a stranger
//
// What must hold:
//   - a foursomes pair's card is the pair's ball and handicap, for either
//     partner, marked team_card; the partner's card isn't blank any more
//   - the certifier is from the other side, never the partner
//   - a team card never counts for the handicap indicator
//   - results show on a group's page only for that group's members, and
//     only a group the organiser is in can be chosen
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const PAL = USERS.buyer1;
const PAL2 = USERS.moderator;
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
    for (const [a, b] of [
      [ME, PAL],
      [ME, PAL2],
    ]) {
      await c.query(
        `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
         on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
        [a, b],
      );
    }
  });
}

const p = (memberId: string | null, name: string, ch: number) => ({
  member_id: memberId,
  name,
  handicap_index: ch,
  course_handicap: ch,
  playing_handicap: Math.round(ch / 2),
  handicap_estimated: false,
});

const card = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));

/** A foursomes day: ME & PAL (pair 1), PAL2 & a guest (pair 2); pair 1's
 *  ball scored 5 on every hole, then the cards closed. */
async function foursomesDay(c: PoolClient): Promise<{ dayId: string; pair1: string; pair2: string }> {
  await as(c, ME);
  const { rows } = await c.query<{ id: string }>("select public.live_scramble_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    JSON.stringify({ title: "Mixed Foursomes", course_name: "The Island", holes: 18, scramble_size: 2, foursomes_scoring: "stableford", course_rating: 72, slope: 130, par_total: 72 }),
    JSON.stringify([
      { team_handicap: 14, tee_time: "09:00", players: [p(ME, "Eire", 9), p(PAL, "Ciarán", 18)] },
      { team_handicap: 9, tee_time: "09:00", players: [p(PAL2, "Niamh", 6), p(null, "Guest", 12)] },
    ]),
    card,
  ]);
  const dayId = rows[0].id;
  const rounds = await asService(c, () => c.query<{ id: string }>("select id from public.live_rounds where match_day_id = $1 order by team_number", [dayId]));
  const [pair1, pair2] = rounds.rows.map((r) => r.id);
  const lead = await asService(c, () => c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 order by position limit 1", [pair1]));
  for (let h = 1; h <= 18; h++) {
    await c.query("select public.live_round_set_score($1, $2, $3::smallint, 5::smallint)", [pair1, lead.rows[0].id, h]);
  }
  await c.query("select public.live_round_finish($1)", [pair1]);
  return { dayId, pair1, pair2 };
}

describe("a pair's card", () => {
  it("is the pair's ball and handicap — for the partner too — and marked as a team card", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { pair1 } = await foursomesDay(c);
      await as(c, PAL);
      const id = (await c.query<{ id: string }>("select public.scorecard_from_live_round($1) as id", [pair1])).rows[0].id;
      const row = await c.query("select team_card, playing_handicap, handicap_index from public.scorecards where id = $1", [id]);
      expect(row.rows[0]).toEqual({ team_card: "foursomes", playing_handicap: 14, handicap_index: null });
      const holes = await c.query<{ n: number }>("select count(*)::int as n from public.scorecard_holes where scorecard_id = $1 and strokes = 5", [id]);
      expect(holes.rows[0].n).toBe(18);
    });
  });

  it("is certified by the other pair, never the partner", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { pair1 } = await foursomesDay(c);
      await as(c, ME);
      const id = (await c.query<{ id: string }>("select public.scorecard_from_live_round($1) as id", [pair1])).rows[0].id;
      const cands = await c.query<{ member_id: string }>("select member_id from public.scorecard_certify_candidates($1)", [id]);
      expect(cands.rows.map((r) => r.member_id)).toEqual([PAL2]);
      await rejects(c, "select public.scorecard_certify_request($1, $2)", [id, PAL], /played the round with you/);
      const req = await c.query<{ id: string }>("select public.scorecard_certify_request($1, $2) as id", [id, PAL2]);
      expect(req.rows[0].id).toBeTruthy();
    });
  });

  it("in a foursomes match: the partner's card is the side's ball, certified by the other side", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      const pl = (memberId: string | null, name: string, side: number) => ({ ...p(memberId, name, 10), side });
      const { rows } = await c.query<{ id: string }>("select public.live_match_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
        JSON.stringify({ title: "Foursomes match", course_name: "The Island", holes: 18 }),
        JSON.stringify([{ match_type: "foursomes", players: [pl(ME, "Eire", 1), pl(PAL, "Ciarán", 1), pl(PAL2, "Niamh", 2), pl(null, "Guest", 2)] }]),
        card,
      ]);
      const round = (await asService(c, () => c.query<{ id: string }>("select id from public.live_rounds where match_day_id = $1", [rows[0].id]))).rows[0].id;
      const lead = await asService(c, () => c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 and side = 1 order by position limit 1", [round]));
      for (let h = 1; h <= 18; h++) await c.query("select public.live_round_set_score($1, $2, $3::smallint, 4::smallint)", [round, lead.rows[0].id, h]);
      await c.query("select public.live_round_finish($1)", [round]);

      await as(c, PAL);
      const id = (await c.query<{ id: string }>("select public.scorecard_from_live_round($1) as id", [round])).rows[0].id;
      const card1 = await c.query("select team_card, playing_handicap from public.scorecards where id = $1", [id]);
      expect(card1.rows[0]).toEqual({ team_card: "foursomes", playing_handicap: 10 }); // ½ × (10 + 10)
      const n = await c.query<{ n: number }>("select count(*)::int as n from public.scorecard_holes where scorecard_id = $1 and strokes = 4", [id]);
      expect(n.rows[0].n).toBe(18);
      const cands = await c.query<{ member_id: string }>("select member_id from public.scorecard_certify_candidates($1)", [id]);
      expect(cands.rows.map((r) => r.member_id)).toEqual([PAL2]);
    });
  });

  it("never counts for the handicap indicator", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { pair1 } = await foursomesDay(c);
      await as(c, ME);
      await c.query("select public.scorecard_from_live_round($1)", [pair1]);
      const diffs = await c.query("select * from public.my_handicap_differentials()");
      expect(diffs.rows).toHaveLength(0);
    });
  });
});

describe("results on the society's page", () => {
  async function group(c: PoolClient): Promise<string> {
    await as(c, ME);
    const id = (await c.query<{ id: string }>("select public.create_group('society', 'North Dublin Golf Society') as id")).rows[0].id;
    await asService(c, () => c.query("select public.group_add_member($1, $2)", [id, PAL2]));
    await asService(c, () => c.query("select public.group_add_member($1, $2)", [id, PAL]));
    return id;
  }
  const RESULTS = JSON.stringify({ version: 1, basis: "stableford", divisions: [] });

  it("suggests the group with the day's players, and members of it read the published results", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const g = await group(c);
      const { dayId } = await foursomesDay(c);
      await as(c, ME);
      const s = await c.query<{ g: string }>("select public.competition_results_group_suggestion($1) as g", [dayId]);
      expect(s.rows[0].g).toBe(g);
      await c.query("select public.competition_results_set_group($1, $2)", [dayId, g]);
      await c.query("select * from public.competition_results_publish($1, $2::jsonb)", [dayId, RESULTS]);

      // A member who wasn't in the day reads it through the group.
      const other = USERS.seller2;
      await asService(c, () => c.query("select public.group_add_member($1, $2)", [g, other]));
      await as(c, other);
      const seen = await c.query("select match_day_id from public.competition_results where group_id = $1", [g]);
      expect(seen.rows).toHaveLength(1);
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.competition_results where group_id = $1", [g])).rows).toHaveLength(0);
    });
  });

  it("only the organiser chooses, and only a group they're in", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const g = await group(c);
      const { dayId } = await foursomesDay(c);
      await as(c, PAL);
      await rejects(c, "select public.competition_results_set_group($1, $2)", [dayId, g], /organiser/);
      await as(c, STRANGER);
      const theirs = (await c.query<{ id: string }>("select public.create_group('crew', 'Strangers') as id")).rows[0].id;
      await as(c, ME);
      await rejects(c, "select public.competition_results_set_group($1, $2)", [dayId, theirs], /group you're in/);
    });
  });
});


