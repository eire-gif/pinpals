// 0131_outing_guests.sql — guests on events.
//
// Cast:
//   seller1    owns the society
//   moderator  its secretary
//   buyer1     a member, entered
//   buyer2     a member, not entered
//   seller2    not in the society
//
// What must hold:
//   - only the officers add, change and take off guests; names and indexes
//     are checked; guests count towards places
//   - the society's members see guests and their tee times; outsiders don't
//   - a published draw takes guests beside members, in order, each once,
//     and only guests on that outing; a members-only draw (an old app) still
//     works and clears any guest's earlier tee time
//   - only the officers mark guests paid, and only they see it
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
  const id = (await c.query<{ id: string }>("select public.create_group('society', 'Malahide Golf Society') as id")).rows[0].id;
  await c.query("set local role service_role");
  for (const m of [SECRETARY, MEMBER, MEMBER2]) await c.query("select public.group_add_member($1, $2)", [id, m]);
  await c.query("set local role authenticated");
  await c.query("select public.set_group_office($1, $2, 'secretary')", [id, SECRETARY]);
  return id;
}

const day = (daysAhead: number) => new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

async function newOuting(c: PoolClient, g: string, extra: Record<string, unknown> = {}): Promise<string> {
  await as(c, SECRETARY);
  const p = JSON.stringify({ title: "Captain's Day", course_name: "Portmarnock Golf Club", plays_on: day(7), entry_fee_cents: 6000, ...extra });
  const id = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, p])).rows[0].id;
  await c.query("select public.set_outing_entry($1, true, $2)", [id, MEMBER]);
  return id;
}

const addGuest = async (c: PoolClient, o: string, name: string, index: number | null = null) =>
  (await c.query<{ id: string }>("select public.add_outing_guest($1, $2, $3) as id", [o, name, index])).rows[0].id;

const guests = async (c: PoolClient, o: string) =>
  (
    await c.query<{ name: string; handicap_index: string | null; tee_group: number | null; tee_time: string | null; tee_position: number | null }>(
      "select name, handicap_index, tee_group, tee_time, tee_position from public.society_outing_guests where outing_id = $1 order by id",
      [o]
    )
  ).rows;

describe("guests", () => {
  it("officers add, change and take them off; members see them; outsiders don't", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      const pat = await addGuest(c, o, "  Pat Murphy ", 12.44);
      const plus = await addGuest(c, o, "Plus Man", -1.5);
      await c.query("select public.update_outing_guest($1, 'Plus Man Jr', -2)", [plus]);

      await as(c, MEMBER2);
      expect(await guests(c, o)).toEqual([
        { name: "Pat Murphy", handicap_index: "12.4", tee_group: null, tee_time: null, tee_position: null },
        { name: "Plus Man Jr", handicap_index: "-2.0", tee_group: null, tee_time: null, tee_position: null },
      ]);
      await rejects(c, "select public.add_outing_guest($1, 'Sneaky', null)", [o], /captain or secretary/);
      await rejects(c, "select public.update_outing_guest($1, 'Sneaky', null)", [pat], /captain or secretary/);
      await rejects(c, "select public.remove_outing_guest($1)", [pat], /captain or secretary/);

      await as(c, STRANGER);
      expect(await guests(c, o)).toEqual([]);
      await rejects(c, "select public.add_outing_guest($1, 'Sneaky', null)", [o], /captain or secretary/);

      await as(c, SECRETARY);
      await rejects(c, "select public.add_outing_guest($1, '   ', null)", [o], /Give the guest a name/);
      await rejects(c, "select public.add_outing_guest($1, 'Way Off', 60)", [o], /handicap index/);
      await c.query("select public.remove_outing_guest($1)", [plus]);
      expect((await guests(c, o)).map((x) => x.name)).toEqual(["Pat Murphy"]);
    });
  });

  it("count towards places, for guests and members alike", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g, { max_entries: 2, waiting_list: false });
      await addGuest(c, o, "Pat Murphy");
      await rejects(c, "select public.add_outing_guest($1, 'One Too Many', null)", [o], /full/);
      await as(c, MEMBER2);
      await rejects(c, "select public.set_outing_entry($1, true)", [o], /full/);
    });
  });
});

describe("the draw with guests", () => {
  it("publishes guests beside members, in order, each once, only this outing's", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      const other = await newOuting(c, g, { title: "Another day" });
      const pat = await addGuest(c, o, "Pat Murphy", 12.4);
      const sean = await addGuest(c, o, "Sean Kelly");
      const elsewhere = await addGuest(c, other, "Elsewhere");

      const draw = (groups: unknown) => c.query("select public.publish_outing_draw($1, $2::jsonb)", [o, JSON.stringify(groups)]);
      await draw([
        { tee_time: "10:00", members: [MEMBER, { guest: Number(pat) }] },
        { tee_time: "10:10", members: [{ guest: Number(sean) }] },
      ]);
      expect(await guests(c, o)).toEqual([
        { name: "Pat Murphy", handicap_index: "12.4", tee_group: 1, tee_time: "10:00:00", tee_position: 2 },
        { name: "Sean Kelly", handicap_index: null, tee_group: 2, tee_time: "10:10:00", tee_position: 1 },
      ]);
      expect((await c.query("select tee_group, tee_position from public.society_outing_entries where outing_id = $1 and member_id = $2", [o, MEMBER])).rows[0]).toEqual({ tee_group: 1, tee_position: 1 });

      // Members see the guests' tee times.
      await as(c, MEMBER2);
      expect((await guests(c, o)).map((x) => x.tee_group)).toEqual([1, 2]);

      await as(c, SECRETARY);
      await rejects(c, "select public.publish_outing_draw($1, $2::jsonb)", [o, JSON.stringify([{ members: [{ guest: Number(pat) }, { guest: Number(pat) }] }])], /two groups/);
      await rejects(c, "select public.publish_outing_draw($1, $2::jsonb)", [o, JSON.stringify([{ members: [{ guest: Number(elsewhere) }] }])], /guests on this outing/);
      await rejects(c, "select public.publish_outing_draw($1, $2::jsonb)", [o, JSON.stringify([{ members: [{ guest: "abc" }] }])], /doesn't look right/);

      // A members-only draw, as an older app sends it, still works — and the
      // guests are no longer in a group.
      await draw([{ tee_time: "11:00", members: [MEMBER] }]);
      expect((await guests(c, o)).map((x) => x.tee_group)).toEqual([null, null]);

      await as(c, MEMBER);
      await rejects(c, "select public.publish_outing_draw($1, $2::jsonb)", [o, JSON.stringify([{ members: [{ guest: Number(pat) }] }])], /captain or secretary/);
    });
  });
});

describe("guest payments", () => {
  it("only the officers mark them, and only they see them", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      const pat = await addGuest(c, o, "Pat Murphy");
      const paid = async () => (await c.query("select status from public.society_outing_guest_payments where guest_id = $1", [pat])).rows;

      await c.query("select public.mark_outing_guest_paid($1, 'cash')", [pat]);
      expect(await paid()).toEqual([{ status: "cash" }]);
      await rejects(c, "select public.mark_outing_guest_paid($1, 'card')", [pat], /cash, transfer or waived/);

      await as(c, MEMBER);
      expect(await paid()).toEqual([]);
      await rejects(c, "select public.mark_outing_guest_paid($1, 'waived')", [pat], /captain or secretary/);

      await as(c, OWNER);
      await c.query("select public.mark_outing_guest_paid($1, null)", [pat]);
      expect(await paid()).toEqual([]);
    });
  });

  it("no direct writes", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      const pat = await addGuest(c, o, "Pat Murphy");
      await rejects(c, "insert into public.society_outing_guests (outing_id, name) values ($1, 'Direct')", [o], /permission denied/);
      await rejects(c, "update public.society_outing_guests set tee_group = 1 where id = $1", [pat], /permission denied/);
      await rejects(c, "delete from public.society_outing_guests where id = $1", [pat], /permission denied/);
      await rejects(c, "insert into public.society_outing_guest_payments (guest_id, status) values ($1, 'cash')", [pat], /permission denied/);
      await rejects(c, "select public.outing_entry_count($1)", [o], /permission denied/);
    });
  });
});
