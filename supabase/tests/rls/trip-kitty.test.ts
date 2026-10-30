// 0202_trip_kitty.sql — the trip kitty.
//
// Cast:
//   seller1    owns the society and runs the trip
//   buyer1     a member
//   moderator  a member
//   seller2    not in the society
//
// What must hold:
//   - only people on an overnight/abroad trip add to its kitty, paid by and split between people on the trip
//   - an expense is changed or taken off by whoever added it, whoever paid, or whoever runs the trip
//   - a payment is ticked (and undone) by either of the two, or whoever runs the trip
//   - members read it all; strangers see nothing; no direct writes
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const OWNER = USERS.seller1;
const A = USERS.buyer1;
const B = USERS.moderator;
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

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function trip(c: PoolClient): Promise<{ trip: string; dayOut: string }> {
  await as(c, OWNER);
  const g = (await c.query<{ id: string }>("select public.create_group('society', 'Howth Golf Society') as id")).rows[0].id;
  await c.query("set local role service_role");
  for (const m of [A, B]) await c.query("select public.group_add_member($1, $2)", [g, m]);
  await c.query("set local role authenticated");
  const t = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, JSON.stringify({ kind: "abroad", title: "Algarve", plays_on: day(10), ends_on: day(12), location: "Algarve" })])).rows[0].id;
  const d = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, JSON.stringify({ title: "Day", course_name: "A", plays_on: day(3) })])).rows[0].id;
  return { trip: t, dayOut: d };
}

const SAVE = "select public.trip_kitty_save($1, $2, $3::jsonb) as id";
const exp = (paidBy: string, shares: string[], extra: object = {}) => JSON.stringify({ title: "Green fees", category: "golf", amount_cents: 12000, paid_by: paidBy, shares, ...extra });

describe("the trip kitty", () => {
  it("people on the trip add to it; paid by and split between people on the trip; trips only", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const t = await trip(c);
      await rejects(c, SAVE, [t.dayOut, null, exp(OWNER, [OWNER])], /overnight and abroad/);
      await as(c, A);
      const id = (await c.query<{ id: string }>(SAVE, [t.trip, null, exp(A, [OWNER, A, B])])).rows[0].id;
      expect((await c.query("select member_id from public.trip_kitty_shares where expense_id = $1 order by member_id", [id])).rows.map((r) => r.member_id)).toEqual([OWNER, A, B].sort());
      await rejects(c, SAVE, [t.trip, null, exp(STRANGER, [A])], /Who paid/);
      await rejects(c, SAVE, [t.trip, null, exp(A, [A, STRANGER])], /only between people on the trip/);
      await rejects(c, SAVE, [t.trip, null, exp(A, [])], /at least one person/);
      await rejects(c, SAVE, [t.trip, null, exp(A, [A], { amount_cents: 0 })], /amount/);
      await as(c, STRANGER);
      await rejects(c, SAVE, [t.trip, null, exp(A, [A])], /Only people on the trip/);
      expect((await c.query("select 1 from public.trip_kitty_expenses where id = $1", [id])).rowCount).toBe(0);
    });
  });

  it("changed or taken off by whoever added it, paid it, or runs the trip", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const t = await trip(c);
      await as(c, A);
      const id = (await c.query<{ id: string }>(SAVE, [t.trip, null, exp(A, [A, B])])).rows[0].id;
      await as(c, B);
      await rejects(c, SAVE, [t.trip, id, exp(A, [A, B], { amount_cents: 1 })], /Only whoever added it/);
      await rejects(c, "select public.trip_kitty_delete($1)", [id], /Only whoever added it/);
      await as(c, OWNER);
      await c.query(SAVE, [t.trip, id, exp(A, [A], { amount_cents: 5000 })]);
      expect((await c.query("select amount_cents from public.trip_kitty_expenses where id = $1", [id])).rows[0].amount_cents).toBe(5000);
      expect((await c.query("select member_id from public.trip_kitty_shares where expense_id = $1", [id])).rows.map((r) => r.member_id)).toEqual([A]);
      await as(c, A);
      await c.query("select public.trip_kitty_delete($1)", [id]);
      expect((await c.query("select 1 from public.trip_kitty_expenses where id = $1", [id])).rowCount).toBe(0);
    });
  });

  it("payments are ticked and undone by the two people or whoever runs the trip", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const t = await trip(c);
      const PAY = "select public.trip_kitty_pay($1, $2, $3, $4) as id";
      await as(c, A);
      const id = (await c.query<{ id: string }>(PAY, [t.trip, A, B, 2500])).rows[0].id;
      await rejects(c, PAY, [t.trip, A, A, 2500], /doesn't look right/);
      await rejects(c, PAY, [t.trip, A, STRANGER, 2500], /doesn't look right/);
      await rejects(c, PAY, [t.trip, A, B, 0], /amount/);
      await as(c, B);
      await rejects(c, PAY, [t.trip, OWNER, A, 100], /Only the two of them/);
      await as(c, OWNER);
      await c.query(PAY, [t.trip, A, B, 100]);
      await as(c, STRANGER);
      await rejects(c, "select public.trip_kitty_unpay($1)", [id], /Only the two of them/);
      expect((await c.query("select 1 from public.trip_kitty_payments where outing_id = $1", [t.trip])).rowCount).toBe(0);
      await as(c, B);
      await c.query("select public.trip_kitty_unpay($1)", [id]);
      expect((await c.query("select count(*)::int as n from public.trip_kitty_payments where outing_id = $1", [t.trip])).rows[0].n).toBe(1);
    });
  });

  it("can't be written directly", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const t = await trip(c);
      const g = (await c.query<{ group_id: string }>("select group_id from public.society_outings where id = $1", [t.trip])).rows[0].group_id;
      await rejects(c, "insert into public.trip_kitty_expenses (outing_id, group_id, title, amount_cents, paid_by) values ($1, $2, 'x', 1, $3)", [t.trip, g, OWNER], /permission denied/);
      await rejects(c, "insert into public.trip_kitty_payments (outing_id, group_id, from_member, to_member, amount_cents) values ($1, $2, $3, $4, 1)", [t.trip, g, OWNER, A], /permission denied/);
    });
  });
});
