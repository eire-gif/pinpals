// 0174_hidden_leaderboard.sql — keep the leaderboard secret until the
// prize-giving. While it's on, a player sees only their own tee group's
// cards; the organiser (the day's starter, or the society event's officers)
// sees everything; publishing the results, or the organiser, reveals it.
//
// Cast:
//   seller1    runs the society and starts the day (the organiser)
//   moderator  the society's secretary — an event officer, not playing
//   buyer1     plays in group 1
//   buyer2     plays in group 2
//   seller2    a stranger
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ORGANISER = USERS.seller1;
const SECRETARY = USERS.moderator;
const PLAYER1 = USERS.buyer1;
const PLAYER2 = USERS.buyer2;
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
  if (pattern) expect(message).toMatch(pattern);
}

const p = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 12,
  course_handicap: 14,
  playing_handicap: 13,
  handicap_estimated: false,
});
const card = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));

/** A society (secretary appointed), an event, and its live day of two groups. */
async function setUp(c: PoolClient, groups?: object[]): Promise<{ day: string; group1: string; group2: string }> {
  await as(c, ORGANISER);
  const g = (await c.query<{ id: string }>("select public.create_group('society', 'Malahide Golf Society') as id")).rows[0].id;
  await asService(c, async () => {
    for (const m of [SECRETARY, PLAYER1, PLAYER2]) await c.query("select public.group_add_member($1, $2)", [g, m]);
  });
  await c.query("select public.set_group_office($1, $2, 'secretary')", [g, SECRETARY]);
  const playsOn = new Date().toISOString().slice(0, 10);
  const outing = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [
    g,
    JSON.stringify({ title: "Captain's Prize", course_name: "The Island", plays_on: playsOn }),
  ])).rows[0].id;
  const { rows } = await c.query<{ id: string }>("select public.live_fourball_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    JSON.stringify({ title: "Captain's Prize", course_name: "The Island", holes: 18, format: "stableford", allowance: 0.95 }),
    JSON.stringify(
      groups ?? [
        { tee_time: "09:00", players: [p(ORGANISER, "Eire"), p(PLAYER1, "John")] },
        { tee_time: "09:10", players: [p(PLAYER2, "Niamh"), p(null, "A guest")] },
      ],
    ),
    card,
  ]);
  const day = rows[0].id;
  await c.query("select public.link_outing_match_day($1, $2)", [outing, day]);
  const ids = await asService(c, () =>
    c.query<{ id: string; match_number: number }>("select id, match_number from public.live_rounds where match_day_id = $1 order by match_number", [day]),
  );
  return { day, group1: ids.rows[0].id, group2: ids.rows[1].id };
}

const roundsSeen = async (c: PoolClient, day: string) =>
  (await c.query<{ id: string }>("select id from public.live_rounds where match_day_id = $1 order by id", [day])).rows.map((r) => r.id);

describe("a secret leaderboard", () => {
  it("players see only their own group; the organiser and the event's secretary see all", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day, group1, group2 } = await setUp(c);
      await as(c, ORGANISER);
      await c.query("select public.set_day_leaderboard_hidden($1, true)", [day]);

      await as(c, PLAYER1);
      expect(await roundsSeen(c, day)).toEqual([group1]);
      // Nor the other group's players, scores or card, read directly.
      for (const t of ["live_round_players", "live_round_scores", "live_round_holes"]) {
        expect((await c.query(`select 1 from public.${t} where round_id = $1`, [group2])).rowCount).toBe(0);
      }
      expect((await c.query("select public.live_day_is_organiser($1) as o", [day])).rows[0].o).toBe(false);

      await as(c, PLAYER2);
      expect(await roundsSeen(c, day)).toEqual([group2]);

      await as(c, ORGANISER);
      expect(await roundsSeen(c, day)).toEqual([group1, group2]);
      // The secretary isn't playing but runs the event: sees the day and every card.
      await as(c, SECRETARY);
      expect(await roundsSeen(c, day)).toEqual([group1, group2]);
      expect((await c.query("select 1 from public.live_match_days where id = $1", [day])).rowCount).toBe(1);
      expect((await c.query("select public.live_day_is_organiser($1) as o", [day])).rows[0].o).toBe(true);

      await as(c, STRANGER);
      expect(await roundsSeen(c, day)).toEqual([]);
    });
  });

  it("only the organiser hides or shows it; showing it gives the field back", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day, group1, group2 } = await setUp(c);
      await as(c, PLAYER1);
      await rejects(c, "select public.set_day_leaderboard_hidden($1, true)", [day], /Only the organiser/);
      expect(await roundsSeen(c, day)).toEqual([group1, group2]);

      await as(c, SECRETARY);
      await c.query("select public.set_day_leaderboard_hidden($1, true)", [day]);
      await as(c, PLAYER1);
      expect(await roundsSeen(c, day)).toEqual([group1]);

      await as(c, ORGANISER);
      await c.query("select public.set_day_leaderboard_hidden($1, false)", [day]);
      await as(c, PLAYER1);
      expect(await roundsSeen(c, day)).toEqual([group1, group2]);
    });
  });

  it("publishing the results reveals it", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day, group2 } = await setUp(c);
      await as(c, ORGANISER);
      await c.query("select public.set_day_leaderboard_hidden($1, true)", [day]);
      await c.query("select * from public.competition_results_publish($1, $2::jsonb)", [
        day,
        JSON.stringify({ version: 1, basis: "stableford", divisions: [{ label: "Overall", rows: [] }] }),
      ]);
      expect((await c.query("select leaderboard_hidden from public.live_match_days where id = $1", [day])).rows[0].leaderboard_hidden).toBe(false);
      await as(c, PLAYER1);
      expect(await roundsSeen(c, day)).toContain(group2);
    });
  });

  it("pairs in the same tee group, or the same shotgun start, still see each other's card", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day, group1, group2 } = await setUp(c, [
        { tee_time: "09:00", start_hole: 7, start_letter: "A", players: [p(PLAYER1, "John")] },
        { tee_time: "09:00", start_hole: 7, start_letter: "A", players: [p(PLAYER2, "Niamh")] },
        { tee_time: "09:00", start_hole: 7, start_letter: "B", players: [p(ORGANISER, "Eire")] },
      ]);
      await as(c, ORGANISER);
      await c.query("select public.set_day_leaderboard_hidden($1, true)", [day]);
      await as(c, PLAYER1);
      // 7A together; 7B — same hole, same time, other group — stays hidden.
      expect(await roundsSeen(c, day)).toEqual([group1, group2]);
    });
  });
});
