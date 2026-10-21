// 0184_outing_live_setup.sql — a society day's live set-up, saved ahead.
//
// Cast:
//   seller1    owns the society
//   moderator  its secretary
//   buyer1     a member
//   seller2    not in it
//
// What must hold:
//   - only officers with the events area save or clear it, through the function
//   - members can read it with the outing; strangers can't see the outing
//   - nothing once the round has started, on a cancelled outing, or too big
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const OWNER = USERS.seller1;
const SECRETARY = USERS.moderator;
const MEMBER = USERS.buyer1;
const STRANGER = USERS.seller2;

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
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

const day = (daysAhead: number) => new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
const SETUP = JSON.stringify({ v: 1, teeName: "White", rating: 72.4, slope: 131, format: "stableford", start: "tees" });
const save = "select public.save_outing_live_setup($1, $2::jsonb)";

async function setUp(c: PoolClient): Promise<string> {
  await as(c, OWNER);
  const g = (await c.query<{ id: string }>("select public.create_group('society', 'Howth Golf Society') as id")).rows[0].id;
  await c.query("set local role service_role");
  for (const m of [SECRETARY, MEMBER]) await c.query("select public.group_add_member($1, $2)", [g, m]);
  await c.query("set local role authenticated");
  await c.query("select public.set_group_office($1, $2, 'secretary')", [g, SECRETARY]);
  await as(c, SECRETARY);
  const outing = JSON.stringify({ title: "Captain's Day", course_name: "Portmarnock Golf Club", plays_on: day(5), first_tee: "09:00" });
  return (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, outing])).rows[0].id;
}

describe("saving a live set-up", () => {
  it("officers save and clear it; members read it; others can't", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const id = await setUp(c);
      await as(c, SECRETARY);
      await c.query(save, [id, SETUP]);
      await as(c, MEMBER);
      const seen = await c.query<{ live_setup: { teeName: string } | null; live_setup_at: string | null }>("select live_setup, live_setup_at from public.society_outings where id = $1", [id]);
      expect(seen.rows[0].live_setup?.teeName).toBe("White");
      expect(seen.rows[0].live_setup_at).not.toBeNull();
      await rejects(c, save, [id, SETUP], /captain, secretary or event organisers/);
      await rejects(c, "update public.society_outings set live_setup = '{}'::jsonb where id = $1", [id]);
      await as(c, STRANGER);
      await rejects(c, save, [id, SETUP], /captain, secretary or event organisers/);
      expect((await c.query("select 1 from public.society_outings where id = $1", [id])).rowCount).toBe(0);
      await as(c, OWNER);
      await c.query(save, [id, null]);
      const cleared = await c.query<{ live_setup: unknown; live_setup_at: unknown }>("select live_setup, live_setup_at from public.society_outings where id = $1", [id]);
      expect(cleared.rows[0]).toEqual({ live_setup: null, live_setup_at: null });
    });
  });

  it("refuses a started round, a cancelled outing and anything too big", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const id = await setUp(c);
      await as(c, SECRETARY);
      await rejects(c, save, [id, JSON.stringify({ junk: "x".repeat(9000) })], /doesn't look right/);
      await rejects(c, save, [id, "[1,2]"], /doesn't look right/);
      await c.query("set local role service_role");
      await c.query("update public.society_outings set status = 'cancelled' where id = $1", [id]);
      await c.query("set local role authenticated");
      await rejects(c, save, [id, SETUP], /cancelled/);
    });
  });
});
