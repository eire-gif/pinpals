// 0127_outing_payment_details.sql — how to pay, and "I've paid".
//
// Cast:
//   seller1    owns the society
//   moderator  its secretary
//   buyer1     a member, entered
//   buyer2     a member, entered
//   seller2    not in the society
//
// What must hold:
//   - officers set a Revolut username, IBAN, account name, cash and a note;
//     they're tidied ("@Name" → "name", spaces out of the IBAN) and checked
//   - the society's members can read them; outsiders can't
//   - a member says "I've paid" only for themselves, only when entered, only
//     when there's a fee and they aren't already marked paid
//   - a claim is seen by its member and the officers, not other members
//   - officers can clear a claim but not make one; leaving clears yours
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
const outing = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "Captain's Day",
    course_name: "Portmarnock Golf Club",
    plays_on: day(7),
    entry_fee_cents: 6000,
    pay_revtag: "@Geoff.Walsh",
    pay_iban: "IE29 AIBK 9311 5212 3456 78",
    pay_account_name: "Geoff Walsh",
    pay_cash: false,
    pay_note: "By Friday, please",
    ...extra,
  });

async function newOuting(c: PoolClient, g: string, extra: Record<string, unknown> = {}): Promise<string> {
  await as(c, SECRETARY);
  const id = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, outing(extra)])).rows[0].id;
  for (const m of [MEMBER, MEMBER2]) await c.query("select public.set_outing_entry($1, true, $2)", [id, m]);
  return id;
}

const claims = async (c: PoolClient, o: string) =>
  (await c.query<{ member_id: string; method: string }>("select member_id, method from public.society_outing_payment_claims where outing_id = $1 order by member_id", [o])).rows;

describe("payment details", () => {
  it("officers set them, tidied and checked; members read them; outsiders don't", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      await as(c, MEMBER);
      const row = (await c.query("select pay_revtag, pay_iban, pay_account_name, pay_cash, pay_note from public.society_outings where id = $1", [o])).rows[0];
      expect(row).toEqual({ pay_revtag: "geoff.walsh", pay_iban: "IE29AIBK93115212345678", pay_account_name: "Geoff Walsh", pay_cash: false, pay_note: "By Friday, please" });
      await as(c, STRANGER);
      expect((await c.query("select pay_iban from public.society_outings where id = $1", [o])).rows).toHaveLength(0);

      await as(c, SECRETARY);
      await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, outing({ pay_revtag: "geoff walsh" })], /Revolut username/);
      await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, outing({ pay_iban: "12345" })], /IBAN/);
      await rejects(c, "select public.save_outing($1, null, $2::jsonb)", [g, outing({ pay_account_name: "" })], /name on the bank account/);
      // Left out entirely: cash is fine, nothing else set (a 0125-style call).
      const plain = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [g, JSON.stringify({ title: "Plain", course_name: "The Island", plays_on: day(9) })])).rows[0].id;
      expect((await c.query("select pay_revtag, pay_iban, pay_cash from public.society_outings where id = $1", [plain])).rows[0]).toEqual({ pay_revtag: null, pay_iban: null, pay_cash: true });
    });
  });
});

describe("I've paid", () => {
  it("a member tells the officers; other members don't see it", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      await as(c, MEMBER);
      await c.query("select public.claim_outing_paid($1, 'revolut')", [o]);
      await c.query("select public.claim_outing_paid($1, 'transfer')", [o]); // changing it is fine
      expect(await claims(c, o)).toEqual([{ member_id: MEMBER, method: "transfer" }]);
      await rejects(c, "select public.claim_outing_paid($1, 'cheque')", [o], /Revolut, bank transfer or cash/);

      await as(c, MEMBER2);
      expect(await claims(c, o)).toEqual([]);
      await rejects(c, "select public.claim_outing_paid($1, 'cash', $2)", [o, MEMBER], /captain or secretary/);

      await as(c, SECRETARY);
      expect(await claims(c, o)).toHaveLength(1);
      await rejects(c, "select public.claim_outing_paid($1, 'cash', $2)", [o, MEMBER], /Mark their payment/);
      await c.query("select public.claim_outing_paid($1, null, $2)", [o, MEMBER]); // not received
      expect(await claims(c, o)).toEqual([]);

      await as(c, STRANGER);
      await rejects(c, "select public.claim_outing_paid($1, 'cash')", [o], /isn't available/);
    });
  });

  it("only when entered, with a fee, and not already marked paid", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      const free = await newOuting(c, g, { title: "Free", entry_fee_cents: null });
      await as(c, OWNER);
      await rejects(c, "select public.claim_outing_paid($1, 'cash')", [o], /Join it first/);
      await as(c, MEMBER);
      await rejects(c, "select public.claim_outing_paid($1, 'cash')", [free], /nothing to pay/);
      await as(c, SECRETARY);
      await c.query("select public.mark_outing_paid($1, $2, 'cash')", [o, MEMBER]);
      await as(c, MEMBER);
      await rejects(c, "select public.claim_outing_paid($1, 'revolut')", [o], /already marked as paid/);
    });
  });

  it("leaving the outing clears your claim", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      await as(c, MEMBER);
      await c.query("select public.claim_outing_paid($1, 'revolut')", [o]);
      await c.query("select public.set_outing_entry($1, false)", [o]);
      await as(c, SECRETARY);
      expect(await claims(c, o)).toEqual([]);
    });
  });

  it("nobody writes claims directly", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      const o = await newOuting(c, g);
      await as(c, MEMBER);
      await rejects(c, "insert into public.society_outing_payment_claims (outing_id, member_id, method) values ($1, $2, 'cash')", [o, MEMBER], /permission denied/);
    });
  });
});
