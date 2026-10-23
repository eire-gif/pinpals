// 0187_championships.sql — multi-day championships.
//
// Cast:
//   seller1    owns the society
//   moderator  its secretary
//   buyer1     a member
//   seller2    not in it
//
// What must hold:
//   - only officers create, change or cancel one; members read it; strangers can't see it
//   - its days are day outs (one per day, in order, 2–4 days, three weeks at most)
//   - fewer days cancels the dropped ones; cancelling cancels the days not started
//   - members join every open day in one go; no direct writes
//   - the trip toggle is for trips, by officers; a trip round's live day is linked only by an officer who created it
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
const COURSES = ["Portmarnock Golf Club", "The Island Golf Club", "The European Club", "Druids Glen"];
const champ = (n: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "Autumn Classic",
    rule: "auto",
    max_entries: 40,
    days: Array.from({ length: n }, (_, i) => ({ plays_on: day(5 + i), course_name: COURSES[i], first_tee: "08:30", format: i === 1 ? "scramble4" : "stableford" })),
    ...extra,
  });
const save = "select public.save_championship($1, $2, $3::jsonb) as id";

async function society(c: PoolClient): Promise<string> {
  await as(c, OWNER);
  const g = (await c.query<{ id: string }>("select public.create_group('society', 'Howth Golf Society') as id")).rows[0].id;
  await c.query("set local role service_role");
  for (const m of [SECRETARY, MEMBER]) await c.query("select public.group_add_member($1, $2)", [g, m]);
  await c.query("set local role authenticated");
  await c.query("select public.set_group_office($1, $2, 'secretary')", [g, SECRETARY]);
  return g;
}

async function days(c: PoolClient, id: string) {
  return (
    await c.query<{ id: string; championship_round: number; championship_format: string; course_name: string; status: string; kind: string }>(
      "select id, championship_round, championship_format, course_name, status, kind from public.society_outings where championship_id = $1 order by championship_round, id",
      [id]
    )
  ).rows;
}

describe("multi-day championships", () => {
  it("officers create one as a day out per day; members read it; strangers can't", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await as(c, SECRETARY);
      const id = (await c.query<{ id: string }>(save, [g, null, champ(3)])).rows[0].id;
      const d = await days(c, id);
      expect(d.map((x) => [x.championship_round, x.course_name, x.championship_format, x.kind])).toEqual([
        [1, "Portmarnock Golf Club", "stableford", "day"],
        [2, "The Island Golf Club", "scramble4", "day"],
        [3, "The European Club", "stableford", "day"],
      ]);
      await as(c, MEMBER);
      expect((await c.query("select title from public.group_championships where id = $1", [id])).rows[0].title).toBe("Autumn Classic");
      await rejects(c, save, [g, id, champ(3)], /Only whoever runs the group/);
      await rejects(c, "update public.group_championships set title = 'x' where id = $1", [id]);
      await rejects(c, "insert into public.group_championships (group_id, title) values ($1, 'x')", [g]);
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.group_championships where id = $1", [id])).rowCount).toBe(0);
      await rejects(c, save, [g, null, champ(2)], /Only whoever runs the group/);
    });
  });

  it("checks the days", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await rejects(c, save, [g, null, champ(1)], /2, 3 or 4 days/);
      await rejects(c, save, [g, null, champ(5)], /2, 3 or 4 days/);
      const backwards = JSON.stringify({ title: "X", days: [{ plays_on: day(6), course_name: "A", format: "stableford" }, { plays_on: day(5), course_name: "B", format: "stableford" }] });
      await rejects(c, save, [g, null, backwards], /comes after/);
      const long = JSON.stringify({ title: "X", days: [{ plays_on: day(5), course_name: "A", format: "stableford" }, { plays_on: day(30), course_name: "B", format: "stableford" }] });
      await rejects(c, save, [g, null, long], /three weeks/);
      const fmt = JSON.stringify({ title: "X", days: [{ plays_on: day(5), course_name: "A", format: "matchplay" }, { plays_on: day(6), course_name: "B", format: "stableford" }] });
      await rejects(c, save, [g, null, fmt], /format for day 1/);
      await rejects(c, save, [g, null, champ(2, { rule: "add" })], /how the days add up/);
    });
  });

  it("shortening cancels the dropped days; cancelling cancels the rest", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const id = (await c.query<{ id: string }>(save, [g, null, champ(4)])).rows[0].id;
      await c.query(save, [g, id, champ(2)]);
      const open = (await days(c, id)).filter((x) => x.status === "open");
      expect(open.map((x) => x.championship_round)).toEqual([1, 2]);
      await c.query("select public.cancel_championship($1)", [id]);
      expect((await days(c, id)).every((x) => x.status === "cancelled")).toBe(true);
      expect((await c.query("select status from public.group_championships where id = $1", [id])).rows[0].status).toBe("cancelled");
    });
  });

  it("a played day keeps its own date when the others are checked", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const id = (await c.query<{ id: string }>(save, [g, null, champ(2)])).rows[0].id;
      const [d1] = await days(c, id);
      await c.query("set local role service_role");
      const md = (await c.query<{ id: string }>("insert into public.live_match_days (title, course_name, created_by) values ('Day 1', 'A', $1) returning id", [OWNER])).rows[0].id;
      await c.query("update public.society_outings set match_day_id = $1 where id = $2", [md, d1.id]);
      await c.query("set local role authenticated");
      // Day 1 (started, on day(5)) can't be "moved" after day 2 by a tampered form.
      const tampered = JSON.stringify({ title: "Autumn Classic", days: [{ plays_on: day(3), course_name: "A", format: "stableford" }, { plays_on: day(4), course_name: "B", format: "stableford" }] });
      await rejects(c, save, [g, id, tampered], /comes after/);
    });
  });

  it("members join every open day at once", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const id = (await c.query<{ id: string }>(save, [g, null, champ(3)])).rows[0].id;
      await as(c, MEMBER);
      const n = (await c.query<{ n: number }>("select public.set_championship_entry($1, true) as n", [id])).rows[0].n;
      expect(n).toBe(3);
      const mine = await c.query("select 1 from public.society_outing_entries e join public.society_outings o on o.id = e.outing_id where o.championship_id = $1 and e.member_id = $2", [id, MEMBER]);
      expect(mine.rowCount).toBe(3);
      await rejects(c, "select public.set_championship_entry($1, true, $2)", [id, SECRETARY], /captain or secretary/);
      await c.query("select public.set_championship_entry($1, false)", [id]);
      const left = await c.query("select 1 from public.society_outing_entries e join public.society_outings o on o.id = e.outing_id where o.championship_id = $1 and e.member_id = $2", [id, MEMBER]);
      expect(left.rowCount).toBe(0);
      await as(c, STRANGER);
      await rejects(c, "select public.set_championship_entry($1, true)", [id], /isn't available/);
    });
  });

  it("the trip toggle, and linking a trip round to its live day", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const trip = JSON.stringify({ kind: "overnight", title: "Kerry Trip", plays_on: day(10), ends_on: day(12), location: "Killarney" });
      const t = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, trip])).rows[0].id;
      const dayOut = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, JSON.stringify({ title: "Day", course_name: "A", plays_on: day(3) })])).rows[0].id;
      await rejects(c, "select public.set_trip_championship($1, true)", [dayOut], /overnight and abroad/);
      await as(c, MEMBER);
      await rejects(c, "select public.set_trip_championship($1, true)", [t], /Only whoever runs the trip/);
      await as(c, OWNER);
      const id = (await c.query<{ id: string }>("select public.set_trip_championship($1, true) as id", [t])).rows[0].id;
      expect((await c.query("select trip_outing_id, status from public.group_championships where id = $1", [id])).rows[0]).toEqual({ trip_outing_id: t, status: "open" });
      await rejects(c, "select public.set_championship_entry($1, true)", [id], /Join the trip itself/);
      await c.query("select public.set_trip_championship($1, false)", [t]);
      expect((await c.query("select status from public.group_championships where id = $1", [id])).rows[0].status).toBe("cancelled");

      const item = (await c.query<{ id: string }>("select public.save_outing_item($1, null, $2::jsonb) as id", [t, JSON.stringify({ kind: "round", on_date: day(10), starts_at: "09:00", title: "Killarney", play_format: "stableford" })])).rows[0].id;
      await c.query("set local role service_role");
      const mine = (await c.query<{ id: string }>("insert into public.live_match_days (title, course_name, created_by) values ('Kerry Day 1', 'Killarney', $1) returning id", [OWNER])).rows[0].id;
      const theirs = (await c.query<{ id: string }>("insert into public.live_match_days (title, course_name, created_by) values ('Other', 'X', $1) returning id", [SECRETARY])).rows[0].id;
      await c.query("set local role authenticated");
      await rejects(c, "select public.link_outing_item_match_day($1, $2)", [item, theirs], /isn't your round/);
      await c.query("select public.link_outing_item_match_day($1, $2)", [item, mine]);
      expect((await c.query("select match_day_id from public.society_outing_items where id = $1", [item])).rows[0].match_day_id).toBe(mine);
      await as(c, MEMBER);
      await rejects(c, "select public.link_outing_item_match_day($1, $2)", [item, mine], /Only whoever runs the trip/);
    });
  });
});
