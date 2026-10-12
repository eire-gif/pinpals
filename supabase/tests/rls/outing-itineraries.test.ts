// 0126_outing_itineraries.sql — overnight and abroad trips, and their itinerary.
//
// Cast:
//   seller1    owns the society
//   moderator  its secretary
//   buyer1     a member, on the trip
//   buyer2     a member, on the trip
//   seller2    not in the society
//
// What must hold:
//   - a day out still needs a course and has no last day; a trip needs a
//     last day 1–20 days after the first, and no course
//   - only officers add, change and remove itinerary items, and only on a
//     trip, only on its days
//   - members see the itinerary and who is on what; outsiders see nothing
//   - only people on the trip go on a flight, in a room or in a group; a
//     group or room holds 8 at most; meals and notes have nobody
//   - cancelling your place takes you off everything
//   - a trip with an itinerary can't become a day out, or lose the days its
//     itinerary is on
//   - no direct writes
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

async function society(c: PoolClient): Promise<string> {
  await as(c, OWNER);
  const id = (await c.query<{ id: string }>("select public.create_group('society', 'Portmarnock Thursday Society') as id")).rows[0].id;
  await c.query("set local role service_role");
  for (const m of [SECRETARY, MEMBER, MEMBER2]) await c.query("select public.group_add_member($1, $2)", [id, m]);
  await c.query("set local role authenticated");
  await c.query("select public.set_group_office($1, $2, 'secretary')", [id, SECRETARY]);
  return id;
}

const day = (daysAhead: number) => new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
const trip = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ kind: "abroad", title: "Algarve 2027", plays_on: day(30), ends_on: day(33), location: "Vale do Lobo, Portugal", entry_fee_cents: 50000, ...extra });

/** A four-day trip with MEMBER and MEMBER2 on it. */
async function newTrip(c: PoolClient, g: string): Promise<string> {
  await as(c, SECRETARY);
  const id = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, trip()])).rows[0].id;
  for (const m of [MEMBER, MEMBER2]) await c.query("select public.set_outing_entry($1, true, $2)", [id, m]);
  return id;
}

async function addItem(c: PoolClient, outing: string, item: Record<string, unknown>): Promise<string> {
  return (await c.query<{ id: string }>("select public.save_outing_item($1, null, $2::jsonb) as id", [outing, JSON.stringify(item)])).rows[0].id;
}

const people = async (c: PoolClient, item: string) =>
  (await c.query<{ member_id: string; slot: number | null }>("select member_id, slot from public.society_outing_item_people where item_id = $1 order by member_id", [item])).rows;

describe("kinds of outing", () => {
  it("a day out needs a course; a trip needs a last day and no course", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await as(c, SECRETARY);
      await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, JSON.stringify({ title: "Day", plays_on: day(7) })], /course/);
      await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, trip({ ends_on: null })], /last day/);
      await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, trip({ ends_on: day(30) })], /after the first/);
      await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, trip({ ends_on: day(60) })], /three weeks/);
      await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, trip({ kind: "cruise" })], /day out, overnight or abroad/);
      const id = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, trip({ kind: "overnight" })])).rows[0].id;
      const row = (await c.query("select kind, ends_on::text, course_name, location from public.society_outings where id = $1", [id])).rows[0];
      expect(row).toEqual({ kind: "overnight", ends_on: day(33), course_name: null, location: "Vale do Lobo, Portugal" });
      // A 0125-style call (no kind) is still a day out.
      const d = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, JSON.stringify({ title: "Captain's Day", course_name: "The Island", plays_on: day(7) })])).rows[0].id;
      expect((await c.query("select kind, ends_on from public.society_outings where id = $1", [d])).rows[0]).toEqual({ kind: "day", ends_on: null });
    });
  });

  it("a trip with an itinerary can't become a day out or lose the days it's on", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const t = await newTrip(c, g);
      await addItem(c, t, { kind: "note", on_date: day(33), title: "Home day" });
      await rejects(c, "select public.save_outing($1, $2, $3::jsonb)", [g, t, JSON.stringify({ title: "x", course_name: "The Island", plays_on: day(30) })], /remove it before/);
      await rejects(c, "select public.save_outing($1, $2, $3::jsonb)", [g, t, trip({ ends_on: day(32) })], /outside the new dates/);
      await c.query("select public.save_outing($1, $2, $3::jsonb)", [g, t, trip({ ends_on: day(34) })]);
    });
  });
});

describe("the itinerary", () => {
  it("officers add items on the trip's days; members and outsiders can't", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const t = await newTrip(c, g);
      const round = await addItem(c, t, { kind: "round", on_date: day(30), title: "Quinta do Lago South", starts_at: "14:10", play_format: "stableford" });
      expect((await c.query("select tee_interval, from_place from public.society_outing_items where id = $1", [round])).rows[0]).toEqual({ tee_interval: 10, from_place: null });
      await rejects(c, "select public.save_outing_item($1, null, $2::jsonb)", [t, JSON.stringify({ kind: "note", on_date: day(29), title: "Early" })], /day of the trip/);
      await rejects(c, "select public.save_outing_item($1, null, $2::jsonb)", [t, JSON.stringify({ kind: "flight", on_date: day(30), title: "Out", from_place: "DUB" })], /from and to/);
      await rejects(c, "select public.save_outing_item($1, null, $2::jsonb)", [t, JSON.stringify({ kind: "stay", on_date: day(32), title: "Hotel", nights: 3 })], /past the end/);
      await rejects(c, "select public.save_outing_item($1, null, $2::jsonb)", [t, JSON.stringify({ kind: "round", on_date: day(30), title: "X", tee_interval: 30 })], /5 to 20/);

      await as(c, MEMBER);
      await rejects(c, "select public.save_outing_item($1, null, $2::jsonb)", [t, JSON.stringify({ kind: "note", on_date: day(30), title: "Mine" })], /captain or secretary/);
      await rejects(c, "select public.delete_outing_item($1)", [round], /captain or secretary/);
      expect((await c.query("select id from public.society_outing_items where outing_id = $1", [t])).rows).toHaveLength(1);

      await as(c, STRANGER);
      expect((await c.query("select id from public.society_outing_items where outing_id = $1", [t])).rows).toHaveLength(0);

      await as(c, OWNER);
      await c.query("select public.delete_outing_item($1)", [round]);
      expect((await c.query("select id from public.society_outing_items where outing_id = $1", [t])).rows).toHaveLength(0);
    });
  });

  it("a day out has no itinerary", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await as(c, SECRETARY);
      const d = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, JSON.stringify({ title: "Captain's Day", course_name: "The Island", plays_on: day(7) })])).rows[0].id;
      await rejects(c, "select public.save_outing_item($1, null, $2::jsonb)", [d, JSON.stringify({ kind: "note", on_date: day(7), title: "x" })], /overnight and abroad/);
    });
  });

  it("only people on the trip go on things; groups and rooms hold 8; meals have nobody", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const t = await newTrip(c, g);
      const flight = await addItem(c, t, { kind: "flight", on_date: day(30), title: "Out", from_place: "DUB", to_place: "FAO", starts_at: "06:40", ends_at: "10:35" });
      const round = await addItem(c, t, { kind: "round", on_date: day(30), title: "Quinta do Lago South", starts_at: "14:10" });
      const meal = await addItem(c, t, { kind: "meal", on_date: day(30), title: "Dinner" });

      await c.query("select public.set_outing_item_people($1, $2::jsonb)", [flight, JSON.stringify([{ member: MEMBER }, { member: MEMBER2 }])]);
      expect(await people(c, flight)).toHaveLength(2);
      await rejects(c, "select public.set_outing_item_people($1, $2::jsonb)", [flight, JSON.stringify([{ member: SECRETARY }])], /on the trip/);
      await rejects(c, "select public.set_outing_item_people($1, $2::jsonb)", [flight, JSON.stringify([{ member: MEMBER }, { member: MEMBER }])], /twice/);
      await rejects(c, "select public.set_outing_item_people($1, $2::jsonb)", [round, JSON.stringify([{ member: MEMBER }])], /in a group/);
      await rejects(c, "select public.set_outing_item_people($1, $2::jsonb)", [meal, JSON.stringify([{ member: MEMBER }])], /everyone on the trip/);
      await c.query("select public.set_outing_item_people($1, $2::jsonb)", [round, JSON.stringify([{ member: MEMBER2, slot: 2 }, { member: MEMBER, slot: 1 }])]);
      expect(await people(c, round)).toEqual(
        [
          { member_id: MEMBER, slot: 1 },
          { member_id: MEMBER2, slot: 2 },
        ].sort((a, b) => a.member_id.localeCompare(b.member_id))
      );

      await as(c, MEMBER);
      await rejects(c, "select public.set_outing_item_people($1, $2::jsonb)", [flight, JSON.stringify([])], /captain or secretary/);
      expect(await people(c, round)).toHaveLength(2); // members see who is where
      await as(c, STRANGER);
      expect(await people(c, round)).toHaveLength(0);
    });
  });

  it("cancelling your place takes you off every flight, room and group", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const t = await newTrip(c, g);
      const flight = await addItem(c, t, { kind: "flight", on_date: day(30), title: "Out", from_place: "DUB", to_place: "FAO" });
      const stay = await addItem(c, t, { kind: "stay", on_date: day(30), title: "Dona Filipa", nights: 3 });
      await c.query("select public.set_outing_item_people($1, $2::jsonb)", [flight, JSON.stringify([{ member: MEMBER }, { member: MEMBER2 }])]);
      await c.query("select public.set_outing_item_people($1, $2::jsonb)", [stay, JSON.stringify([{ member: MEMBER, slot: 1 }, { member: MEMBER2, slot: 1 }])]);
      await as(c, MEMBER);
      await c.query("select public.set_outing_entry($1, false)", [t]);
      await as(c, SECRETARY);
      expect((await people(c, flight)).map((p) => p.member_id)).toEqual([MEMBER2]);
      expect((await people(c, stay)).map((p) => p.member_id)).toEqual([MEMBER2]);
    });
  });

  it("nobody writes the tables directly", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const t = await newTrip(c, g);
      await rejects(c, "insert into public.society_outing_items (outing_id, on_date, kind, title) values ($1, $2, 'note', 'x')", [t, day(30)], /permission denied/);
      const note = await addItem(c, t, { kind: "note", on_date: day(30), title: "x" });
      await rejects(c, "update public.society_outing_items set title = 'y' where id = $1", [note], /permission denied/);
      await rejects(c, "insert into public.society_outing_item_people (item_id, member_id) values ($1, $2)", [note, MEMBER], /permission denied/);
    });
  });
});
