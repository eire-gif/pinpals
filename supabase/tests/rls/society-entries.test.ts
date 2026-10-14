// 0142_society_entries.sql — requests, the waiting list, offers, choices,
// withdrawals and the alert outbox.
//
// Cast:
//   seller1    owns the society
//   moderator  its secretary
//   buyer1     a member
//   buyer2     a member
//   seller2    not in the society
//
// What must hold:
//   - on a request-only event a member is 'requested' until an officer
//     approves, declines or puts them on the waiting list; members can't
//   - a full event puts members on the waiting list in order; a freed place
//     is offered to the first, who takes it or lets it go to the next; an
//     offer that runs out goes to the next too
//   - a guest a member brings takes a place, and leaves with them
//   - queue rows and choices: your own, and the officers'; never another
//     member's; no direct writes
//   - meals must be ones on offer; an older app's save keeps the new fields
//   - withdrawals are logged; a withdrawn payment can be marked refunded
//   - alerts land in the outbox for the right people; members can't read it
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
  const id = (await c.query<{ id: string }>("select public.create_group('society', 'Howth Golf Society') as id")).rows[0].id;
  await c.query("set local role service_role");
  for (const m of [SECRETARY, MEMBER, MEMBER2]) await c.query("select public.group_add_member($1, $2)", [id, m]);
  await c.query("set local role authenticated");
  await c.query("select public.set_group_office($1, $2, 'secretary')", [id, SECRETARY]);
  return id;
}

const day = (daysAhead: number) => new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

async function newOuting(c: PoolClient, g: string, extra: Record<string, unknown> = {}): Promise<string> {
  await as(c, SECRETARY);
  const p = JSON.stringify({ title: "Captain's Prize", course_name: "Laytown & Bettystown", plays_on: day(10), entry_fee_cents: 7000, ...extra });
  return (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, p])).rows[0].id;
}

const ask = async (c: PoolClient, o: string, p: Record<string, unknown> = {}) =>
  (await c.query<{ s: string }>("select public.request_outing_place($1, $2::jsonb) as s", [o, JSON.stringify(p)])).rows[0].s;

const entrants = async (c: PoolClient, o: string) =>
  (await c.query<{ member_id: string }>("select member_id from public.society_outing_entries where outing_id = $1 order by entered_at, member_id", [o])).rows.map((r) => r.member_id);

const queue = async (c: PoolClient, o: string) =>
  (await c.query<{ member_id: string; status: string }>("select member_id, status from public.society_outing_queue where outing_id = $1 order by queued_at, id", [o])).rows;

async function serviceRows<T>(c: PoolClient, sql: string, params: unknown[]): Promise<T[]> {
  await c.query("savepoint peek");
  await c.query("set local role service_role");
  const rows = (await c.query(sql, params)).rows as T[];
  await c.query("rollback to savepoint peek");
  return rows;
}

const alerts = (c: PoolClient, o: string) =>
  serviceRows<{ member_id: string; kind: string }>(c, "select member_id, kind from public.society_alerts where outing_id = $1 order by id", [o]);

describe("request a place", () => {
  it("members ask; officers approve, decline or put them on the list; members can't decide", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g, { entry_mode: "request", meal_options: ["Beef", "Salmon"] });

      await as(c, MEMBER);
      expect(await ask(c, o, { meal: "Beef", tee_pref: "early", note: "Out with Pat please", guest: { name: "Pat Murphy", index: 14.2 } })).toBe("requested");
      // An older app's Join on a request-only event asks too.
      await as(c, MEMBER2);
      await c.query("select public.set_outing_entry($1, true)", [o]);
      expect(await entrants(c, o)).toEqual([]);
      expect(await queue(c, o)).toEqual([{ member_id: MEMBER2, status: "requested" }]); // only their own
      await rejects(c, "select public.review_outing_request($1, $2, 'approve')", [o, MEMBER], /captain or secretary/);

      // The officers hear about it, and see everything asked.
      expect((await alerts(c, o)).filter((a) => a.kind === "request_received").map((a) => a.member_id).sort()).toEqual(
        [OWNER, SECRETARY, OWNER, SECRETARY].sort()
      );
      await as(c, SECRETARY);
      expect(await queue(c, o)).toHaveLength(2);
      const choice = (await c.query("select meal, tee_pref, note from public.society_outing_choices where outing_id = $1 and member_id = $2", [o, MEMBER])).rows;
      expect(choice).toEqual([{ meal: "Beef", tee_pref: "early", note: "Out with Pat please" }]);

      expect((await c.query("select public.review_outing_request($1, $2, 'approve') as s", [o, MEMBER])).rows[0].s).toBe("confirmed");
      expect(await entrants(c, o)).toEqual([MEMBER]);
      expect((await c.query("select name, brought_by from public.society_outing_guests where outing_id = $1", [o])).rows).toEqual([{ name: "Pat Murphy", brought_by: MEMBER }]);
      expect((await c.query("select public.review_outing_request($1, $2, 'decline') as s", [o, MEMBER2])).rows[0].s).toBe("declined");
      expect(await queue(c, o)).toEqual([]);

      const kinds = (await alerts(c, o)).map((a) => `${a.kind}:${a.member_id === MEMBER ? "m1" : a.member_id === MEMBER2 ? "m2" : "officer"}`);
      expect(kinds).toContain("place_confirmed:m1");
      expect(kinds).toContain("request_declined:m2");
    });
  });

  it("meals have to be on offer; notes are checked; strangers can't ask", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g, { meal_options: ["Beef"] });
      await as(c, MEMBER);
      await rejects(c, "select public.request_outing_place($1, $2::jsonb)", [o, JSON.stringify({ meal: "Lobster" })], /meals on offer/);
      await rejects(c, "select public.request_outing_place($1, $2::jsonb)", [o, JSON.stringify({ note: "x".repeat(201) })], /200 characters/);
      await rejects(c, "select public.request_outing_place($1, $2::jsonb)", [o, JSON.stringify({ play_with: STRANGER })], /someone in the group/);
      await as(c, STRANGER);
      await rejects(c, "select public.request_outing_place($1, '{}'::jsonb)", [o], /isn't available/);
      await as(c, MEMBER2);
      expect(await c.query("select * from public.society_outing_choices where outing_id = $1", [o]).then((r) => r.rows)).toEqual([]);
    });
  });
});

describe("the waiting list", () => {
  it("fills in order, offers a freed place to the first, and moves on when they let it go", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g, { max_entries: 2 });
      await as(c, OWNER);
      expect(await ask(c, o)).toBe("confirmed");
      await as(c, SECRETARY);
      expect(await ask(c, o)).toBe("confirmed");
      await as(c, MEMBER);
      expect(await ask(c, o)).toBe("waiting");
      await as(c, MEMBER2);
      expect(await ask(c, o)).toBe("waiting");
      expect((await c.query("select status, line_position from public.my_outing_queue($1)", [g])).rows).toEqual([{ status: "waiting", line_position: 2 }]);

      // A place frees up: the first in line is offered it, and nobody else.
      await as(c, OWNER);
      await c.query("select public.set_outing_entry($1, false)", [o]);
      await as(c, SECRETARY);
      expect(await queue(c, o)).toEqual([
        { member_id: MEMBER, status: "offered" },
        { member_id: MEMBER2, status: "waiting" },
      ]);
      // The held place can't be taken by someone joining.
      await as(c, OWNER);
      expect(await ask(c, o)).toBe("waiting");

      // Let it go: the next is offered it; they take it.
      await as(c, MEMBER);
      expect((await c.query("select public.answer_outing_offer($1, false) as s", [o])).rows[0].s).toBe("declined");
      await as(c, MEMBER2);
      expect((await c.query("select public.answer_outing_offer($1, true) as s", [o])).rows[0].s).toBe("confirmed");
      expect((await entrants(c, o)).sort()).toEqual([SECRETARY, MEMBER2].sort());
      expect((await alerts(c, o)).filter((a) => a.kind === "place_offered").map((a) => a.member_id)).toEqual([MEMBER, MEMBER2]);
    });
  });

  it("an offer that runs out goes to the next; officers can promote anyone", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g, { max_entries: 1 });
      await as(c, OWNER);
      await ask(c, o);
      await as(c, MEMBER);
      await ask(c, o);
      await as(c, MEMBER2);
      await ask(c, o);
      await as(c, OWNER);
      await c.query("select public.set_outing_entry($1, false)", [o]);

      await c.query("savepoint expire");
      await c.query("set local role service_role");
      await c.query("update public.society_outing_queue set offer_expires_at = now() - interval '1 minute' where outing_id = $1 and status = 'offered'", [o]);
      expect((await c.query("select public.sweep_outing_offers() as n")).rows[0].n).toBe(1);
      await c.query("set local role authenticated");
      await as(c, SECRETARY);
      expect(await queue(c, o)).toEqual([{ member_id: MEMBER2, status: "offered" }]);
      expect((await alerts(c, o)).some((a) => a.kind === "offer_expired" && a.member_id === MEMBER)).toBe(true);
      await c.query("rollback to savepoint expire");

      // By hand: promote whoever, as long as there's room.
      await as(c, SECRETARY);
      await rejects(c, "select public.promote_outing_waiting($1, $2)", [o, MEMBER2], /Not enough places/);
      expect((await c.query("select public.promote_outing_waiting($1, $2) as s", [o, MEMBER])).rows[0].s).toBe("confirmed");
      expect(await entrants(c, o)).toEqual([MEMBER]);
      await as(c, MEMBER);
      await rejects(c, "select public.promote_outing_waiting($1, $2)", [o, MEMBER2], /captain or secretary/);
    });
  });

  it("a guest takes a place and leaves with the member who brought them", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g, { max_entries: 3 });
      await as(c, MEMBER);
      expect(await ask(c, o, { guest: { name: "Pat Murphy" } })).toBe("confirmed");
      await as(c, MEMBER2);
      expect(await ask(c, o, { guest: { name: "Sean Kelly" } })).toBe("waiting"); // needs two, one left
      await as(c, MEMBER);
      await c.query("select public.set_outing_entry($1, false)", [o]);
      expect((await c.query("select count(*)::int as n from public.society_outing_guests where outing_id = $1", [o])).rows[0].n).toBe(0);
      await as(c, MEMBER2);
      expect((await c.query("select public.answer_outing_offer($1, true) as s", [o])).rows[0].s).toBe("confirmed");
      expect((await c.query("select name from public.society_outing_guests where outing_id = $1", [o])).rows).toEqual([{ name: "Sean Kelly" }]);
    });
  });
});

describe("withdrawals and refunds", () => {
  it("are logged, and a paid withdrawal can be marked refunded", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      await as(c, MEMBER);
      await ask(c, o);
      await as(c, SECRETARY);
      await c.query("select public.mark_outing_paid($1, $2, 'transfer')", [o, MEMBER]);
      await rejects(c, "select public.mark_outing_refunded($1, $2, true)", [o, MEMBER], /still entered/);
      await as(c, MEMBER);
      await c.query("select public.set_outing_entry($1, false)", [o]);
      expect((await c.query("select member_id, withdrawn_by from public.society_outing_withdrawals where outing_id = $1", [o])).rows).toEqual([{ member_id: MEMBER, withdrawn_by: MEMBER }]);
      await rejects(c, "select public.mark_outing_refunded($1, $2, true)", [o, MEMBER], /captain or secretary/);
      await as(c, MEMBER2);
      expect((await c.query("select * from public.society_outing_withdrawals where outing_id = $1", [o])).rows).toEqual([]);
      await as(c, SECRETARY);
      await c.query("select public.mark_outing_refunded($1, $2, true)", [o, MEMBER]);
      expect((await c.query("select status from public.society_outing_payments where outing_id = $1 and member_id = $2", [o, MEMBER])).rows).toEqual([{ status: "refunded" }]);
    });
  });
});

describe("event details", () => {
  it("are saved and checked; an older app's save keeps them", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g, {
        entry_mode: "request",
        arrive_by: "09:15",
        format_label: "Team scramble",
        dress_code: "Collared shirts",
        meal_options: ["Turkey", " Salmon ", "Turkey", ""],
        guest_fee_cents: 8000,
      });
      // An older app sends only the 0129 fields.
      await c.query("select public.save_outing($1, $2, $3::jsonb)", [g, o, JSON.stringify({ title: "Captain's Prize", course_name: "Laytown & Bettystown", plays_on: day(11) })]);
      expect(
        (await c.query("select entry_mode, arrive_by, format_label, dress_code, meal_options, guest_fee_cents from public.society_outings where id = $1", [o])).rows
      ).toEqual([{ entry_mode: "request", arrive_by: "09:15:00", format_label: "Team scramble", dress_code: "Collared shirts", meal_options: ["Turkey", "Salmon"], guest_fee_cents: 8000 }]);
      await rejects(c, "select public.save_outing($1, $2, $3::jsonb)", [g, o, JSON.stringify({ title: "X", course_name: "Y", plays_on: day(11), meal_options: ["a", "b", "c", "d", "e", "f", "g"] })], /Six meal/);
      await rejects(c, "select public.save_outing($1, $2, $3::jsonb)", [g, o, JSON.stringify({ title: "X", course_name: "Y", plays_on: day(11), entry_mode: "lottery" })], /how members get a place/);
    });
  });

  it("an organiser's deadline closes entries early", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g, { entries_close_at: new Date(Date.now() - 60_000).toISOString() });
      await as(c, MEMBER);
      await rejects(c, "select public.request_outing_place($1, '{}'::jsonb)", [o], /Entries have closed/);
      await as(c, SECRETARY);
      await c.query("select public.set_outing_entry($1, true, $2)", [o, MEMBER]); // officers still can
    });
  });
});

describe("the outbox and direct writes", () => {
  it("a new event alerts the group, a change alerts those in it; members can't read or write any of it", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      expect((await alerts(c, o)).filter((a) => a.kind === "event_new").map((a) => a.member_id).sort()).toEqual([OWNER, MEMBER, MEMBER2].sort());
      await as(c, MEMBER);
      await ask(c, o);
      await as(c, SECRETARY);
      await c.query("select public.save_outing($1, $2, $3::jsonb)", [g, o, JSON.stringify({ title: "Captain's Prize", course_name: "Seapoint", plays_on: day(10) })]);
      await c.query("select public.publish_outing_draw($1, $2::jsonb)", [o, JSON.stringify([{ tee_time: "10:00", members: [MEMBER] }])]);
      const k = (await alerts(c, o)).filter((a) => a.member_id === MEMBER).map((a) => a.kind);
      expect(k).toEqual(["event_new", "event_changed", "draw_published"]);

      await as(c, MEMBER);
      await rejects(c, "select * from public.society_alerts", [], /permission denied/);
      await rejects(c, "insert into public.society_outing_queue (outing_id, member_id, status) values ($1, $2, 'waiting')", [o, MEMBER2], /permission denied/);
      await rejects(c, "update public.society_outing_queue set status = 'offered'", [], /permission denied/);
      await rejects(c, "insert into public.society_outing_choices (outing_id, member_id) values ($1, $2)", [o, MEMBER], /permission denied/);
      await rejects(c, "select public.queue_society_alert($1, $2, $3, 'x', '{}'::jsonb, 'x')", [g, o, MEMBER], /permission denied/);
      await rejects(c, "select public.offer_outing_places($1)", [o], /permission denied/);
    });
  });
});
