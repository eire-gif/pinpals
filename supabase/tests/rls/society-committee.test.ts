// 0143_society_noticeboard_alerts.sql and 0144_society_roles_membership.sql.
//
// Cast:
//   seller1    owns the society (and is its captain's equal: role owner)
//   moderator  its secretary
//   buyer1     a member (made treasurer in one test)
//   buyer2     a member (made event organiser / handicap secretary in tests)
//   seller2    not in the society
//
// What must hold:
//   - notices: the committee posts, members read, outsiders don't; one pin
//   - messages reach the right audience, never the sender; money messages
//     never go on the noticeboard; members can't send
//   - alert settings are your own
//   - the reminder sweep queues "entries closing" once, for those not in
//   - offices: each only their own area (treasurer: money, not events;
//     event organiser: events, not money; handicap secretary: handicaps)
//   - membership: the captain sets it up; members owe and claim; the
//     treasurer confirms; honorary carries over; 'block' stops new entries
//   - the money, member list and claims are for the right roles only
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
  const id = (await c.query<{ id: string }>("select public.create_group('society', 'Sutton Golf Society') as id")).rows[0].id;
  await c.query("set local role service_role");
  for (const m of [SECRETARY, MEMBER, MEMBER2]) await c.query("select public.group_add_member($1, $2)", [id, m]);
  await c.query("set local role authenticated");
  await c.query("select public.set_group_office($1, $2, 'secretary')", [id, SECRETARY]);
  return id;
}

const day = (daysAhead: number) => new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

async function newOuting(c: PoolClient, g: string, extra: Record<string, unknown> = {}): Promise<string> {
  await as(c, SECRETARY);
  const p = JSON.stringify({ title: "October Medal", course_name: "Seapoint", plays_on: day(10), entry_fee_cents: 5500, ...extra });
  return (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, p])).rows[0].id;
}

async function serviceRows<T>(c: PoolClient, sql: string, params: unknown[]): Promise<T[]> {
  await c.query("savepoint peek");
  await c.query("set local role service_role");
  const rows = (await c.query(sql, params)).rows as T[];
  await c.query("rollback to savepoint peek");
  return rows;
}

const groupAlerts = (c: PoolClient, g: string, kind: string) =>
  serviceRows<{ member_id: string }>(c, "select member_id from public.society_alerts where group_id = $1 and kind = $2 order by member_id", [g, kind]).then((r) => r.map((x) => x.member_id));

describe("the noticeboard", () => {
  it("the committee posts, members read, outsiders don't; one pin; an alert if asked", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await as(c, SECRETARY);
      const a = (await c.query("select public.save_society_notice($1, null, $2::jsonb) as id", [g, JSON.stringify({ title: "AGM 26 Nov", pinned: true })])).rows[0].id;
      await c.query("select public.save_society_notice($1, null, $2::jsonb)", [g, JSON.stringify({ title: "Captain's Prize moved", kind: "change", pinned: true, alert: true })]);
      expect((await c.query("select pinned from public.society_notices where id = $1", [a])).rows).toEqual([{ pinned: false }]);
      expect(await groupAlerts(c, g, "notice")).toEqual([OWNER, MEMBER, MEMBER2].sort());

      await as(c, MEMBER);
      expect((await c.query("select title from public.society_notices where group_id = $1 order by id", [g])).rows.map((r) => r.title)).toEqual(["AGM 26 Nov", "Captain's Prize moved"]);
      await rejects(c, "select public.save_society_notice($1, null, $2::jsonb)", [g, JSON.stringify({ title: "Hi" })], /captain or secretary/);
      await rejects(c, "insert into public.society_notices (group_id, title) values ($1, 'x')", [g], /permission denied/);
      await as(c, STRANGER);
      expect((await c.query("select * from public.society_notices where group_id = $1", [g])).rows).toEqual([]);
    });
  });
});

describe("targeted messages", () => {
  it("reach the audience but not the sender; money stays off the noticeboard; members can't send", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      await as(c, MEMBER);
      await c.query("select public.request_outing_place($1, '{}'::jsonb)", [o]);
      await as(c, MEMBER2);
      await c.query("select public.request_outing_place($1, '{}'::jsonb)", [o]);
      await as(c, SECRETARY);
      await c.query("select public.mark_outing_paid($1, $2, 'cash')", [o, MEMBER2]);

      expect((await c.query("select public.society_audience_count($1, 'fees_unpaid', null) as n", [g])).rows[0].n).toBe(1);
      expect((await c.query("select public.send_society_message($1, 'fees_unpaid', $2, 'October Medal fee', 'Please pay', false) as n", [g, o])).rows[0].n).toBe(1);
      expect(await groupAlerts(c, g, "message")).toEqual([MEMBER]);
      await rejects(c, "select public.send_society_message($1, 'fees_unpaid', null, 'x', null, true)", [g], /noticeboard/);
      expect((await c.query("select public.send_society_message($1, 'everyone', null, 'Welcome', null, true) as n", [g])).rows[0].n).toBe(3);
      expect((await c.query("select count(*)::int as n from public.society_notices where group_id = $1", [g])).rows[0].n).toBe(1);

      await as(c, MEMBER);
      await rejects(c, "select public.send_society_message($1, 'everyone', null, 'x', null, false)", [g], /captain or secretary/);
      expect((await c.query("select * from public.society_messages where group_id = $1", [g])).rows).toEqual([]);
    });
  });
});

describe("alert settings and reminders", () => {
  it("settings are your own", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await as(c, MEMBER);
      await c.query("select public.set_society_alert_pref($1, 'noticeboard', false)", [g]);
      await rejects(c, "select public.set_society_alert_pref($1, 'everything', false)", [g], /can switch/);
      expect((await c.query("select kind, enabled from public.society_alert_prefs where group_id = $1", [g])).rows).toEqual([{ kind: "noticeboard", enabled: false }]);
      await as(c, MEMBER2);
      expect((await c.query("select * from public.society_alert_prefs where group_id = $1", [g])).rows).toEqual([]);
      await as(c, STRANGER);
      await rejects(c, "select public.set_society_alert_pref($1, 'noticeboard', false)", [g], /isn't available/);
    });
  });

  it("entries closing reaches those not in, once", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      await as(c, MEMBER);
      await c.query("select public.request_outing_place($1, '{}'::jsonb)", [o]);
      await c.query("savepoint sweep");
      await c.query("set local role service_role");
      await c.query("update public.society_outings set created_at = now() - interval '3 days', entries_close_at = now() + interval '5 hours' where id = $1", [o]);
      await c.query("select public.society_reminder_sweep()");
      await c.query("select public.society_reminder_sweep()");
      const to = (await c.query("select member_id from public.society_alerts where outing_id = $1 and kind = 'entries_closing' order by member_id", [o])).rows.map((r) => r.member_id);
      expect(to).toEqual([OWNER, SECRETARY, MEMBER2].sort());
      await c.query("rollback to savepoint sweep");
    });
  });
});

describe("committee offices", () => {
  it("each office gets only its own area", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await c.query("select public.set_group_office($1, $2, 'treasurer')", [g, MEMBER]);
      await c.query("select public.set_group_office($1, $2, 'event_organiser')", [g, MEMBER2]);
      expect((await c.query("select role, office from public.group_members where group_id = $1 and member_id = $2", [g, MEMBER])).rows).toEqual([{ role: "member", office: "treasurer" }]);
      const o = await newOuting(c, g);
      await as(c, SECRETARY);
      await c.query("select public.set_outing_entry($1, true, $2)", [o, OWNER]);

      // The treasurer: money and messages, not events or handicaps.
      await as(c, MEMBER);
      expect((await c.query("select public.my_society_areas($1) as a", [g])).rows[0].a).toEqual(["messages", "money"]);
      await c.query("select public.mark_outing_paid($1, $2, 'transfer')", [o, OWNER]);
      expect((await c.query("select count(*)::int as n from public.society_outing_payments where outing_id = $1", [o])).rows[0].n).toBe(1);
      await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, JSON.stringify({ title: "x", course_name: "y", plays_on: day(5) })], /runs the group/);
      await rejects(c, "select * from public.society_handicaps($1)", [g], /handicap secretary/);
      await rejects(c, "select public.invite_to_group($1, array[$2]::uuid[])", [g, STRANGER]);

      // The event organiser: events, but not the money.
      await as(c, MEMBER2);
      expect((await c.query("select public.my_society_areas($1) as a", [g])).rows[0].a).toEqual(["events", "messages"]);
      await c.query("select public.save_outing($1, null, $2::jsonb)", [g, JSON.stringify({ title: "Turkey Fourball", course_name: "The Island", plays_on: day(20) })]);
      await c.query("select public.publish_outing_draw($1, $2::jsonb)", [o, JSON.stringify([{ members: [OWNER] }])]);
      await rejects(c, "select public.mark_outing_paid($1, $2, 'cash')", [o, OWNER], /treasurer/);
      expect((await c.query("select * from public.society_outing_payments where outing_id = $1", [o])).rows).toEqual([]);

      // A handicap secretary: handicaps only.
      await as(c, OWNER);
      await c.query("select public.set_group_office($1, $2, 'handicap_secretary')", [g, MEMBER2]);
      await as(c, MEMBER2);
      expect((await c.query("select public.my_society_areas($1) as a", [g])).rows[0].a).toEqual(["handicaps"]);
      await c.query("select public.set_society_handicap($1, $2, 12.3)", [g, MEMBER]);
      await as(c, MEMBER);
      expect((await c.query("select society_index from public.my_society_handicap($1)", [g])).rows).toEqual([{ society_index: "12.3" }]);
    });
  });
});

describe("annual membership", () => {
  it("is set up by the captain or secretary; members owe and claim; the treasurer confirms", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await as(c, MEMBER);
      await rejects(c, "select public.save_membership_settings($1, $2::jsonb)", [g, JSON.stringify({ enabled: true, fee_cents: 8000 })], /captain or secretary/);
      await as(c, SECRETARY);
      await rejects(c, "select public.save_membership_settings($1, $2::jsonb)", [g, JSON.stringify({ enabled: true })], /annual fee/);
      await c.query("select public.save_membership_settings($1, $2::jsonb)", [g, JSON.stringify({ enabled: true, fee_cents: 8000, pay_revtag: "@FairwaysGS" })]);
      await rejects(c, "select public.set_group_office($1, $2, 'treasurer')", [g, MEMBER2], /owner/);
      await as(c, OWNER);
      await c.query("select public.set_group_office($1, $2, 'treasurer')", [g, MEMBER2]);

      await as(c, MEMBER);
      const dues = (await c.query("select kind, amount_cents, claimed from public.my_society_dues($1)", [g])).rows;
      expect(dues).toEqual([{ kind: "membership", amount_cents: 8000, claimed: false }]);
      await c.query("select public.claim_membership_paid($1, 'revolut')", [g]);
      expect((await c.query("select claimed from public.my_society_dues($1)", [g])).rows).toEqual([{ claimed: true }]);
      await rejects(c, "select public.society_money($1)", [g], /treasurer/);

      await as(c, MEMBER2);
      const season = (await c.query("select public.membership_billing_season($1) as s", [g])).rows[0].s;
      expect((await c.query("select kind, method from public.society_payment_claims($1)", [g])).rows).toEqual([{ kind: "membership", method: "revolut" }]);
      await c.query("select public.mark_membership($1, $2, $3, 'paid', 'transfer')", [g, MEMBER, season]);
      await c.query("select public.mark_membership($1, $2, $3, 'honorary')", [g, OWNER, season]);
      const money = (await c.query("select public.society_money($1) as m", [g])).rows[0].m;
      expect(money.membership).toMatchObject({ paid: 1, honorary: 1, unpaid: 2, collected_cents: 8000, outstanding_cents: 16000 });
      expect((await c.query("select first_name, membership from public.society_member_list($1) where member_id = $2", [g, MEMBER])).rows[0].membership).toBe("paid");

      await as(c, MEMBER);
      expect((await c.query("select * from public.my_society_dues($1)", [g])).rows).toEqual([]);
      await rejects(c, "select * from public.society_member_list($1)", [g], /captain, secretary or treasurer/);
      // Honorary carries into the next season.
      await as(c, MEMBER2);
      expect((await serviceRows<{ s: string }>(c, "select public.membership_status($1, $2, ($3 + 1)::smallint) as s", [g, OWNER, season]))[0].s).toBe("honorary");
    });
  });

  it("'block' stops new entries for unpaid members once it's due", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const month = new Date().getUTCMonth() + 1;
      await as(c, SECRETARY);
      await c.query("select public.save_membership_settings($1, $2::jsonb)", [g, JSON.stringify({ enabled: true, fee_cents: 8000, season_start_month: month, due_after_days: 0, unpaid_policy: "block" })]);
      const o = await newOuting(c, g);
      await as(c, MEMBER);
      await rejects(c, "select public.request_outing_place($1, '{}'::jsonb)", [o], /membership/);
      await as(c, SECRETARY);
      const season = (await c.query("select public.membership_billing_season($1) as s", [g])).rows[0].s;
      await c.query("select public.mark_membership($1, $2, $3, 'paid', 'cash')", [g, MEMBER, season]);
      await as(c, MEMBER);
      expect((await c.query("select public.request_outing_place($1, '{}'::jsonb) as s", [o])).rows[0].s).toBe("confirmed");
    });
  });
});

describe("order of merit rules", () => {
  it("the captain or secretary sets them; members read them; checks hold", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await as(c, SECRETARY);
      await c.query("select public.save_order_of_merit($1, $2::jsonb)", [g, JSON.stringify({ points: [10, 8, 6], attendance_points: 1, best_of: 6 })]);
      await rejects(c, "select public.save_order_of_merit($1, $2::jsonb)", [g, JSON.stringify({ points: [] })], /between 1 and 20/);
      await as(c, MEMBER);
      expect((await c.query("select points, attendance_points, best_of from public.society_merit_settings where group_id = $1", [g])).rows).toEqual([{ points: [10, 8, 6], attendance_points: 1, best_of: 6 }]);
      await rejects(c, "select public.save_order_of_merit($1, $2::jsonb)", [g, JSON.stringify({ points: [5] })], /captain or secretary/);
      await as(c, STRANGER);
      expect((await c.query("select * from public.society_merit_settings where group_id = $1", [g])).rows).toEqual([]);
    });
  });
});
