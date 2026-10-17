// 0168_competition_mode_and_tmp_lockdown.sql — live_round_is_competition().
//
// Cast:
//   seller1  creates and plays the round
//   buyer1   another member playing in it
//   buyer2   a stranger, not in the round
//
// What must hold:
//   - a friendly round (no match day, or a friends' day) is not a competition
//   - a round on a society event's day is, for everyone playing in it
//   - anyone not in the round gets false, never an answer about it
//   - signed-out callers can't run it at all
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

const player = (memberId: string, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 14.2,
  course_handicap: 19,
  playing_handicap: 18,
  handicap_estimated: false,
});

async function friendlyRound(c: PoolClient): Promise<string> {
  await asService(c, () =>
    c.query(
      `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
      [ME, PAL],
    ),
  );
  await as(c, ME);
  const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    JSON.stringify({ course_name: "Portmarnock Hotel & Golf Links", format: "stableford", holes: 18, allowance: 0.95 }),
    JSON.stringify([player(ME, "Eire"), player(PAL, "Ciarán")]),
    JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: null }))),
  ]);
  return rows[0].id;
}

const IS_COMP = "select public.live_round_is_competition($1) as yes";

async function isComp(c: PoolClient, roundId: string): Promise<boolean> {
  return (await c.query<{ yes: boolean }>(IS_COMP, [roundId])).rows[0].yes;
}

describe("Competition mode (live_round_is_competition)", () => {
  it("is off for a friendly round, and on for everyone in a society event's round", async () => {
    await withRole("authenticated", ME, async (c) => {
      const roundId = await friendlyRound(c);
      expect(await isComp(c, roundId)).toBe(false);

      // Put the round on a day that belongs to a society event.
      await asService(c, async () => {
        const day = (
          await c.query<{ id: string }>(
            "insert into public.live_match_days (created_by, title, course_name) values ($1, 'Captain''s Day', 'Portmarnock') returning id",
            [ME],
          )
        ).rows[0].id;
        await c.query("update public.live_rounds set match_day_id = $1 where id = $2", [day, roundId]);
        const group = (
          await c.query<{ id: string }>(
            "insert into public.groups (kind, name, privacy, members_can_invite, created_by) values ('society', 'North Dublin Society', 'invite', false, $1) returning id",
            [ME],
          )
        ).rows[0].id;
        await c.query(
          "insert into public.society_outings (group_id, title, course_name, plays_on, match_day_id) values ($1, 'Captain''s Day', 'Portmarnock', current_date, $2)",
          [group, day],
        );
      });

      await as(c, ME);
      expect(await isComp(c, roundId)).toBe(true);
      await as(c, PAL);
      expect(await isComp(c, roundId)).toBe(true);

      // Not in the round: no answer about it.
      await as(c, STRANGER);
      expect(await isComp(c, roundId)).toBe(false);
    });
  });

  it("can't be called signed out", async () => {
    await withRole("anon", null, async (c) => {
      await c.query("savepoint attempt");
      let message = "";
      try {
        await c.query(IS_COMP, [1]);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      await c.query("rollback to savepoint attempt");
      expect(message).toMatch(/permission denied/);
    });
  });
});

describe("Site address for scheduled jobs (pinpals_site_url)", () => {
  it("is for the database itself, not for members", async () => {
    await withRole("authenticated", ME, async (c) => {
      await c.query("savepoint attempt");
      let message = "";
      try {
        await c.query("select public.pinpals_site_url()");
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      await c.query("rollback to savepoint attempt");
      expect(message).toMatch(/permission denied/);
    });
  });
});
