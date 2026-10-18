// 0125_society_outings.sql — outings, entries, the draw and payments.
//
// Cast:
//   seller1    owns the society
//   moderator  its secretary
//   buyer1     a member
//   buyer2     a member
//   seller2    not in it
//
// What must hold:
//   - only the owner and officers set up, cancel, draw and mark payments
//   - members join and cancel until midnight at the start of the day (Irish
//     time); after that only an officer can change the list
//   - non-members see nothing; members see outings, entries and the draw
//   - a payment is seen by its member and the officers, never other members
//   - 'card' can't be set by hand
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const OWNER = USERS.seller1;
const SECRETARY = USERS.moderator;
const MEMBER = USERS.buyer1;
const MEMBER2 = USERS.buyer2;
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

/** A society with a secretary and two members; returns its id. */
async function society(c: PoolClient): Promise<string> {
  await as(c, OWNER);
  const id = (await c.query<{ id: string }>("select public.create_group('society', 'Malahide Golf Society') as id")).rows[0].id;
  await c.query("set local role service_role");
  for (const m of [SECRETARY, MEMBER, MEMBER2]) await c.query("select public.group_add_member($1, $2)", [id, m]);
  await c.query("set local role authenticated");
  await c.query("select public.set_group_office($1, $2, 'secretary')", [id, SECRETARY]);
  return id;
}

const day = (daysAhead: number) => new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
const outing = (playsOn: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ title: "Captain's Day", course_name: "Portmarnock Golf Club", plays_on: playsOn, first_tee: "09:00", entry_fee_cents: 6000, ...extra });

async function newOuting(c: PoolClient, group: string, playsOn = day(7), extra: Record<string, unknown> = {}): Promise<string> {
  await as(c, SECRETARY);
  return (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [group, outing(playsOn, extra)])).rows[0].id;
}

/** Moves an outing's date without the "date has passed" check. */
async function setDate(c: PoolClient, id: string, playsOn: string): Promise<void> {
  await c.query("set local role service_role");
  await c.query("update public.society_outings set plays_on = $2 where id = $1", [id, playsOn]);
  await c.query("set local role authenticated");
}

const entrants = async (c: PoolClient, id: string) =>
  (await c.query<{ member_id: string }>("select member_id from public.society_outing_entries where outing_id = $1 order by member_id", [id])).rows.map((r) => r.member_id);

describe("setting up an outing", () => {
  it("the owner and officers can; members and strangers can't", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await newOuting(c, g);
      await as(c, OWNER);
      await c.query("select public.save_outing($1, null, $2::jsonb)", [g, outing(day(14))]);
      await as(c, MEMBER);
      await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, outing(day(7))], /whoever runs the group/);
      await as(c, SECRETARY);
      await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, outing(day(-1))], /passed/);
      await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, outing(day(7), { title: " " })], /name/);
    });
  });

  it("crews and trips have events too (0129): their owner and admins set them up, members join", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      for (const kind of ["crew", "trip"]) {
        await as(c, OWNER);
        const g = (await c.query<{ id: string }>("select public.create_group($1, 'The Sunday Four', null, null, $2::date, $3::date) as id", [
          kind, kind === "trip" ? day(30) : null, kind === "trip" ? day(34) : null,
        ])).rows[0].id;
        await c.query("set local role service_role");
        for (const m of [SECRETARY, MEMBER]) await c.query("select public.group_add_member($1, $2)", [g, m]);
        await c.query("set local role authenticated");
        await as(c, OWNER);
        await c.query("select public.set_group_role($1, $2, 'admin')", [g, SECRETARY]);

        // The owner, an admin: a day out and a trip abroad.
        const id = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, outing(day(7))])).rows[0].id;
        await as(c, SECRETARY);
        await c.query("select public.save_outing($1, null, $2::jsonb)", [
          g, JSON.stringify({ kind: "abroad", title: "Algarve", location: "Vilamoura", plays_on: day(30), ends_on: day(34) }),
        ]);
        // A plain member can't set one up, but can join.
        await as(c, MEMBER);
        await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, outing(day(9))], /whoever runs the group/);
        await c.query("select public.set_outing_entry($1, true)", [id]);
        expect(await entrants(c, id)).toEqual([MEMBER]);
        // Someone outside it sees nothing.
        await as(c, STRANGER);
        expect((await c.query("select 1 from public.society_outings where group_id = $1", [g])).rowCount).toBe(0);
      }
    });
  });

  it("members see it; someone outside the society doesn't", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      await as(c, MEMBER);
      expect((await c.query("select title from public.society_outings where id = $1", [o])).rows).toHaveLength(1);
      await as(c, STRANGER);
      expect((await c.query("select title from public.society_outings where id = $1", [o])).rows).toHaveLength(0);
      await rejects(c, "select public.set_outing_entry($1, true)", [o], /isn't available/);
    });
  });
});

describe("joining and cancelling", () => {
  it("members join and cancel before midnight; places are capped", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g, day(7), { max_entries: 1 });
      await as(c, MEMBER);
      await c.query("select public.set_outing_entry($1, true)", [o]);
      await c.query("select public.set_outing_entry($1, true)", [o]); // twice is fine
      // Full: since 0142 a member asking goes on the waiting list…
      await as(c, MEMBER2);
      await c.query("select public.set_outing_entry($1, true)", [o]);
      expect(await entrants(c, o)).toHaveLength(1);
      await as(c, MEMBER);
      await c.query("select public.set_outing_entry($1, false)", [o]);
      expect(await entrants(c, o)).toEqual([]);
      // …and is offered the place that frees up.
      await as(c, MEMBER2);
      expect((await c.query("select status from public.society_outing_queue where outing_id = $1", [o])).rows).toEqual([{ status: "offered" }]);
      // An event without a waiting list is simply full.
      const closed = await newOuting(c, g, day(8), { max_entries: 1, waiting_list: false });
      await as(c, MEMBER);
      await c.query("select public.set_outing_entry($1, true)", [closed]);
      await as(c, MEMBER2);
      await rejects(c, "select public.set_outing_entry($1, true)", [closed], /full/);
    });
  });

  it("closes at midnight at the start of the day; officers can still change the list", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      await as(c, MEMBER);
      await c.query("select public.set_outing_entry($1, true)", [o]);
      await setDate(c, o, day(0)); // today: entries closed at last midnight
      await rejects(c, "select public.set_outing_entry($1, false)", [o], /closed at midnight/);
      await as(c, MEMBER2);
      await rejects(c, "select public.set_outing_entry($1, true)", [o], /closed at midnight/);
      await rejects(c, "select public.set_outing_entry($1, true, $2)", [o, MEMBER], /captain or secretary/);

      await as(c, SECRETARY);
      await c.query("select public.set_outing_entry($1, true, $2)", [o, MEMBER2]);
      await c.query("select public.set_outing_entry($1, false, $2)", [o, MEMBER]);
      expect(await entrants(c, o)).toEqual([MEMBER2]);
      await rejects(c, "select public.set_outing_entry($1, true, $2)", [o, STRANGER], /not in the society/);
    });
  });

  it("the close is midnight Irish time, summer and winter", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const utc = async (d: string) =>
        (await c.query<{ t: string }>("select to_char(public.outing_entries_close_at($1::date) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as t", [d])).rows[0].t;
      expect(await utc("2026-07-01")).toBe("2026-06-30 23:00"); // IST, UTC+1
      expect(await utc("2026-12-01")).toBe("2026-12-01 00:00"); // GMT
    });
  });

  it("a cancelled outing takes nobody", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      await as(c, MEMBER);
      await rejects(c, "select public.cancel_outing($1)", [o], /captain or secretary/);
      await as(c, SECRETARY);
      await c.query("select public.cancel_outing($1)", [o]);
      await as(c, MEMBER);
      await rejects(c, "select public.set_outing_entry($1, true)", [o], /cancelled/);
    });
  });
});

describe("the draw", () => {
  it("officers publish tee times for people entered; members see them", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      for (const m of [MEMBER, MEMBER2]) {
        await as(c, m);
        await c.query("select public.set_outing_entry($1, true)", [o]);
      }
      const groups = JSON.stringify([{ tee_time: "09:00", members: [MEMBER2] }, { tee_time: "09:10", members: [MEMBER] }]);

      await as(c, MEMBER);
      await rejects(c, "select public.publish_outing_draw($1, $2::jsonb)", [o, groups], /captain or secretary/);
      await as(c, SECRETARY);
      await rejects(c, "select public.publish_outing_draw($1, $2::jsonb)", [o, JSON.stringify([{ members: [STRANGER] }])], /Only people entered/);
      await rejects(c, "select public.publish_outing_draw($1, $2::jsonb)", [o, JSON.stringify([{ members: [MEMBER, MEMBER] }])], /two groups/);
      await c.query("select public.publish_outing_draw($1, $2::jsonb)", [o, groups]);

      await as(c, MEMBER);
      const mine = (await c.query("select tee_group, tee_time::text from public.society_outing_entries where outing_id = $1 and member_id = $2", [o, MEMBER])).rows[0];
      expect(mine).toEqual({ tee_group: 2, tee_time: "09:10:00" });
      expect((await c.query("select draw_published_at from public.society_outings where id = $1", [o])).rows[0].draw_published_at).not.toBeNull();
    });
  });

  it("a shotgun draw keeps each group's starting hole and A/B (0173)", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      for (const m of [MEMBER, MEMBER2]) {
        await as(c, m);
        await c.query("select public.set_outing_entry($1, true)", [o]);
      }
      await as(c, SECRETARY);
      await rejects(c, "select public.publish_outing_draw($1, $2::jsonb)", [o, JSON.stringify([{ tee_time: "09:00", start_hole: 19, start_letter: "A", members: [MEMBER] }])], /hole of the course/);
      await rejects(c, "select public.publish_outing_draw($1, $2::jsonb)", [o, JSON.stringify([{ tee_time: "09:00", start_letter: "A", members: [MEMBER] }])], /starting hole/);
      await c.query("select public.publish_outing_draw($1, $2::jsonb)", [
        o,
        JSON.stringify([
          { tee_time: "09:00", start_hole: 7, start_letter: "A", members: [MEMBER] },
          { tee_time: "09:00", start_hole: 7, start_letter: "B", members: [MEMBER2] },
        ]),
      ]);
      await as(c, MEMBER);
      const { rows } = await c.query("select member_id, start_hole, start_letter from public.society_outing_entries where outing_id = $1 order by start_letter", [o]);
      expect(rows.map((r) => [r.start_hole, r.start_letter])).toEqual([[7, "A"], [7, "B"]]);
      // Published again without a shotgun: the starts go.
      await as(c, SECRETARY);
      await c.query("select public.publish_outing_draw($1, $2::jsonb)", [o, JSON.stringify([{ tee_time: "09:00", members: [MEMBER, MEMBER2] }])]);
      const after = await c.query("select count(*) filter (where start_hole is not null) as n from public.society_outing_entries where outing_id = $1", [o]);
      expect(Number(after.rows[0].n)).toBe(0);
    });
  });

  it("only links a live day the officer started", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      await c.query("set local role service_role");
      const theirs = (await c.query<{ id: string }>("insert into public.live_match_days (created_by, title, course_name) values ($1, 'x', 'y') returning id", [MEMBER])).rows[0].id;
      const mine = (await c.query<{ id: string }>("insert into public.live_match_days (created_by, title, course_name) values ($1, 'x', 'y') returning id", [SECRETARY])).rows[0].id;
      await c.query("set local role authenticated");
      await as(c, SECRETARY);
      await rejects(c, "select public.link_outing_match_day($1, $2)", [o, theirs], /isn't your round/);
      await c.query("select public.link_outing_match_day($1, $2)", [o, mine]);
      await as(c, MEMBER);
      await rejects(c, "select public.set_outing_entry($1, true)", [o], /round has started/);
    });
  });
});

describe("payments", () => {
  it("officers mark them; each member sees only their own", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      for (const m of [MEMBER, MEMBER2]) {
        await as(c, m);
        await c.query("select public.set_outing_entry($1, true)", [o]);
      }
      await as(c, MEMBER);
      await rejects(c, "select public.mark_outing_paid($1, $2, 'cash')", [o, MEMBER], /captain or secretary/);

      await as(c, SECRETARY);
      await c.query("select public.mark_outing_paid($1, $2, 'cash')", [o, MEMBER]);
      await c.query("select public.mark_outing_paid($1, $2, 'transfer')", [o, MEMBER2]);
      await rejects(c, "select public.mark_outing_paid($1, $2, 'card')", [o, MEMBER], /cash, transfer or waived/);
      await rejects(c, "select public.mark_outing_paid($1, $2, 'cash')", [o, STRANGER], /not entered/);
      expect((await c.query("select member_id from public.society_outing_payments where outing_id = $1", [o])).rows).toHaveLength(2);

      await as(c, MEMBER);
      const seen = (await c.query("select member_id, status from public.society_outing_payments where outing_id = $1", [o])).rows;
      expect(seen).toEqual([{ member_id: MEMBER, status: "cash" }]);

      await as(c, SECRETARY);
      await c.query("select public.mark_outing_paid($1, $2, null)", [o, MEMBER]);
      await as(c, MEMBER);
      expect((await c.query("select 1 from public.society_outing_payments where outing_id = $1", [o])).rows).toHaveLength(0);
    });
  });

  it("nothing is written directly", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      await as(c, SECRETARY);
      await rejects(c, "insert into public.society_outing_payments (outing_id, member_id, status) values ($1, $2, 'card')", [o, MEMBER], /permission denied/);
      await rejects(c, "insert into public.society_outing_entries (outing_id, member_id) values ($1, $2)", [o, MEMBER], /permission denied/);
      await rejects(c, "update public.society_outings set title = 'x' where id = $1", [o], /permission denied/);
    });
  });
});
