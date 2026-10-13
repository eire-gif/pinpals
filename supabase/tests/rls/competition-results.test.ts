// 0137_competition_results.sql — publishing a day's results.
//
// Cast:
//   seller1    organises the day; plays in group 1
//   buyer1     a PinPal of seller1; group 1
//   moderator  a PinPal of seller1; group 2
//   buyer2     a stranger
//
// What must hold:
//   - only the organiser saves settings, publishes and withdraws
//   - players read published results, never the draft; a stranger reads nothing
//   - publishing closes every live card in the day, and versions a republish
//   - the share token exists only while published
//   - card status answers yes/no per player, only to people in the day
//   - no direct writes
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

const p = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 12.0,
  course_handicap: 14,
  playing_handicap: 13,
  handicap_estimated: false,
});
const card = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));
const RESULTS = JSON.stringify({ version: 1, basis: "stableford", divisions: [{ label: "Overall", rows: [] }] });

async function setUp(c: PoolClient): Promise<string> {
  await asService(c, async () => {
    for (const other of [PAL, PAL2]) {
      await c.query(
        `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
         on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
        [ME, other],
      );
    }
  });
  await as(c, ME);
  const { rows } = await c.query<{ id: string }>("select public.live_fourball_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    JSON.stringify({ title: "Captain's Day", course_name: "The Island", holes: 18, format: "stableford", allowance: 0.95 }),
    JSON.stringify([{ players: [p(ME, "Eire"), p(PAL, "John")] }, { players: [p(PAL2, "Niamh"), p(null, "Guest")] }]),
    card,
  ]);
  return rows[0].id;
}

const SAVE = "select public.competition_results_save($1, $2::jsonb)";
const PUBLISH = "select * from public.competition_results_publish($1, $2::jsonb)";
const WITHDRAW = "select public.competition_results_withdraw($1)";

describe("competition results", () => {
  it("only the organiser saves, publishes or withdraws", async () => {
    await withRole("authenticated", ME, async (c) => {
      const day = await setUp(c);
      for (const who of [PAL, STRANGER]) {
        await as(c, who);
        await rejects(c, SAVE, [day, '{"tieRule":"share"}'], /organiser/);
        await rejects(c, PUBLISH, [day, RESULTS], /organiser/);
        await rejects(c, WITHDRAW, [day], /organiser/);
      }
      await as(c, ME);
      await c.query(SAVE, [day, '{"tieRule":"share"}']);
      await rejects(c, PUBLISH, [day, '{"no":"divisions"}'], /can't be published/);
    });
  });

  it("players see published results, never the draft; strangers see nothing", async () => {
    await withRole("authenticated", ME, async (c) => {
      const day = await setUp(c);
      await as(c, ME);
      await c.query(SAVE, [day, '{"tieRule":"draw"}']);
      const mine = await c.query("select status from public.competition_results where match_day_id = $1", [day]);
      expect(mine.rows).toEqual([{ status: "draft" }]);
      await as(c, PAL);
      expect((await c.query("select 1 from public.competition_results where match_day_id = $1", [day])).rows).toHaveLength(0);

      await as(c, ME);
      await c.query(PUBLISH, [day, RESULTS]);
      await as(c, PAL2);
      const seen = await c.query("select status, version from public.competition_results where match_day_id = $1", [day]);
      expect(seen.rows).toEqual([{ status: "published", version: 1 }]);
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.competition_results where match_day_id = $1", [day])).rows).toHaveLength(0);
    });
  });

  it("publishing closes the cards; a republish is a new version with the same link", async () => {
    await withRole("authenticated", ME, async (c) => {
      const day = await setUp(c);
      await as(c, ME);
      const first = await c.query<{ version: number; share_token: string }>(PUBLISH, [day, RESULTS]);
      expect(first.rows[0].version).toBe(1);
      expect(first.rows[0].share_token).toMatch(/^[0-9a-f]{32}$/);
      const live = await c.query("select count(*)::int as n from public.live_rounds where match_day_id = $1 and status = 'live'", [day]);
      expect(live.rows[0].n).toBe(0);
      // A closed card can't be scored any more.
      const r = await c.query<{ id: string }>("select id from public.live_rounds where match_day_id = $1 limit 1", [day]);
      const pl = await c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 limit 1", [r.rows[0].id]);
      await rejects(c, "select public.live_round_set_score($1, $2, 1::smallint, 4::smallint, false)", [r.rows[0].id, pl.rows[0].id]);

      const second = await c.query<{ version: number; share_token: string }>(PUBLISH, [day, RESULTS]);
      expect(second.rows[0]).toEqual({ version: 2, share_token: first.rows[0].share_token });
    });
  });

  it("withdrawing takes it down and kills the link", async () => {
    await withRole("authenticated", ME, async (c) => {
      const day = await setUp(c);
      await as(c, ME);
      await c.query(PUBLISH, [day, RESULTS]);
      await c.query(WITHDRAW, [day]);
      const row = await c.query("select status, share_token, results, version from public.competition_results where match_day_id = $1", [day]);
      expect(row.rows[0]).toEqual({ status: "draft", share_token: null, results: null, version: 1 });
      await as(c, PAL);
      expect((await c.query("select 1 from public.competition_results where match_day_id = $1", [day])).rows).toHaveLength(0);
    });
  });

  it("card status: yes/no per member, only to people in the day", async () => {
    await withRole("authenticated", ME, async (c) => {
      const day = await setUp(c);
      await as(c, PAL2);
      const rows = await c.query<{ member_id: string; certified: boolean }>("select member_id, certified from public.competition_card_status($1) order by member_id", [day]);
      expect(rows.rows).toHaveLength(3); // three members; the guest isn't listed
      expect(rows.rows.every((x) => x.certified === false)).toBe(true);
      await as(c, STRANGER);
      expect((await c.query("select * from public.competition_card_status($1)", [day])).rows).toHaveLength(0);
    });
  });

  it("no direct writes", async () => {
    await withRole("authenticated", ME, async (c) => {
      const day = await setUp(c);
      await as(c, ME);
      await rejects(c, "insert into public.competition_results (match_day_id) values ($1)", [day]);
      await c.query(SAVE, [day, "{}"]);
      await rejects(c, "update public.competition_results set status = 'published' where match_day_id = $1", [day]);
      await rejects(c, "delete from public.competition_results where match_day_id = $1", [day]);
    });
  });
});
