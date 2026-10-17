// 0170_society_email_invites.sql — a society's member list, imported and
// emailed. Who can import and see the list, that tokens never leak to the
// client, and every way an invited golfer ends up in the society: already on
// PinPals, signing up with the address, confirming it later, or opening the
// emailed link while signed in with another account.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, setIdentity, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const { seller1: owner, seller2: member, buyer1: golfer, buyer2: stranger } = USERS;
const emailOf = (id: string) => `${id}@example.test`;

/** As the database owner — for auth.users, which only Supabase Auth writes. */
async function asAdmin<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("reset role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

async function refused(c: PoolClient, sql: string, params: unknown[], pattern?: RegExp): Promise<void> {
  await c.query("savepoint attempt");
  try {
    await expectRejected(c.query(sql, params), pattern);
  } finally {
    await c.query("rollback to savepoint attempt");
  }
}

async function society(c: PoolClient): Promise<string> {
  await setIdentity(c, owner);
  const { rows } = await c.query<{ id: string }>("select public.create_group('society', 'Thursday Society') as id");
  return rows[0].id;
}

type Out = { invite_id: string | null; email: string; outcome: string; token: string | null; failure: string | null };
async function importRows(c: PoolClient, g: string, rows: object[]): Promise<Out[]> {
  return (await c.query<Out>("select * from public.import_group_email_invites($1, $2::jsonb)", [g, JSON.stringify(rows)])).rows;
}

const isMember = async (c: PoolClient, g: string, who: string) =>
  asAdmin(c, async () => (await c.query("select 1 from public.group_members where group_id = $1 and member_id = $2", [g, who])).rowCount === 1);

const confirm = (c: PoolClient, who: string) => asAdmin(c, () => c.query("update auth.users set email_confirmed_at = now() where id = $1", [who]));

describe("import_group_email_invites", () => {
  it("invites new addresses, adds confirmed members, and reports the rest", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await society(c);
      await confirm(c, golfer);
      await confirm(c, owner);
      await setIdentity(c, owner);

      const out = await importRows(c, g, [
        { email: " New.Person@Club.ie ", first_name: "New", last_name: "Person" },
        { email: emailOf(golfer), first_name: "Brian" },
        { email: emailOf(owner) },
        { email: "not-an-email" },
        { email: "new.person@club.ie" },
      ]);
      const by = Object.fromEntries(out.map((r) => [r.email, r]));
      expect(by["new.person@club.ie"].outcome).toBe("invited");
      expect(by["new.person@club.ie"].token).toMatch(/^[0-9a-f]{64}$/);
      expect(by[emailOf(golfer)].outcome).toBe("added");
      expect(by[emailOf(owner)].outcome).toBe("already_member");
      expect(by["not-an-email"].outcome).toBe("invalid");
      expect(out.filter((r) => r.email === "new.person@club.ie")).toHaveLength(1);
      expect(await isMember(c, g, golfer)).toBe(true);

      // Again: nobody is emailed twice by an import.
      const again = await importRows(c, g, [{ email: "new.person@club.ie" }, { email: emailOf(golfer) }]);
      expect(again.map((r) => r.outcome)).toEqual(["already_invited", "already_member"]);
      expect(again[0].token).toBeNull();
    });
  });

  it("is only for the society's owner and admins", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await society(c);
      await asAdmin(c, () => c.query("select public.group_add_member($1, $2)", [g, member]));
      await importRows(c, g, [{ email: "someone@club.ie" }]);

      await setIdentity(c, member);
      await refused(c, "select * from public.import_group_email_invites($1, '[]'::jsonb)", [g], /captain or secretary/);
      expect((await c.query("select id from public.group_email_invites where group_id = $1", [g])).rowCount).toBe(0);
      await refused(c, "select * from public.resend_group_email_invites($1, '{}')", [g], /captain or secretary/);

      await setIdentity(c, stranger);
      await refused(c, "select * from public.import_group_email_invites($1, '[]'::jsonb)", [g], /captain or secretary/);

      await setIdentity(c, owner);
      expect((await c.query("select email from public.group_email_invites where group_id = $1", [g])).rows).toEqual([{ email: "someone@club.ie" }]);
    });
  });

  it("never lets the client read a token, or write the table directly", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await society(c);
      await importRows(c, g, [{ email: "someone@club.ie" }]);
      await refused(c, "select token from public.group_email_invites where group_id = $1", [g], /permission denied/);
      await refused(c, "insert into public.group_email_invites (group_id, email) values ($1, 'x@y.ie')", [g], /permission denied/);
      await refused(c, "update public.group_email_invites set status = 'joined' where group_id = $1", [g], /permission denied/);
    });
  });

  it("caps an import at 500", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await society(c);
      const rows = Array.from({ length: 501 }, (_, i) => ({ email: `m${i}@club.ie` }));
      await refused(c, "select * from public.import_group_email_invites($1, $2::jsonb)", [g, JSON.stringify(rows)], /500/);
    });
  });
});

describe("joining from an invitation", () => {
  it("joins as soon as a new account's email is confirmed", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await society(c);
      await importRows(c, g, [{ email: "late@club.ie" }, { email: "quick@club.ie" }]);

      const late = "00000000-0000-0000-0000-0000000000a1";
      const quick = "00000000-0000-0000-0000-0000000000a2";
      await asAdmin(c, async () => {
        // Confirmed at sign-up (the app's code flow, or confirmations off).
        await c.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'Quick@Club.ie', now())", [quick]);
        // Confirmed later, from the email.
        await c.query("insert into auth.users (id, email) values ($1, 'late@club.ie')", [late]);
      });
      expect(await isMember(c, g, quick)).toBe(true);
      expect(await isMember(c, g, late)).toBe(false);

      await confirm(c, late);
      expect(await isMember(c, g, late)).toBe(true);

      await setIdentity(c, owner);
      const { rows } = await c.query("select email, status, joined_member_id from public.group_email_invites where group_id = $1 order by email", [g]);
      expect(rows).toEqual([
        { email: "late@club.ie", status: "joined", joined_member_id: late },
        { email: "quick@club.ie", status: "joined", joined_member_id: quick },
      ]);
    });
  });

  it("joins with the emailed link, signed in with any account — once", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await society(c);
      const [{ token }] = await importRows(c, g, [{ email: "work@club.ie", first_name: "Barry" }]);

      // Before signing in: the front page only.
      await c.query("set local role anon");
      const { rows: preview } = await c.query("select name, kind, email, first_name, status from public.group_email_invite_preview($1)", [token]);
      expect(preview).toEqual([{ name: "Thursday Society", kind: "society", email: "work@club.ie", first_name: "Barry", status: "pending" }]);
      expect((await c.query("select * from public.group_email_invite_preview($1)", ["0".repeat(64)])).rowCount).toBe(0);
      await refused(c, "select public.claim_group_email_invite($1)", [token], /permission denied/);
      await c.query("set local role authenticated");

      await setIdentity(c, stranger);
      const { rows } = await c.query<{ g: string }>("select public.claim_group_email_invite($1) as g", [token]);
      expect(String(rows[0].g)).toBe(String(g));
      expect(await isMember(c, g, stranger)).toBe(true);
      // Opening it again is harmless.
      await c.query("select public.claim_group_email_invite($1)", [token]);

      await setIdentity(c, golfer);
      await refused(c, "select public.claim_group_email_invite($1)", [token], /already been used/);
    });
  });

  it("a cancelled invitation stops working", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await society(c);
      const [{ invite_id, token }] = await importRows(c, g, [{ email: "gone@club.ie" }]);
      await c.query("select public.cancel_group_email_invite($1, $2)", [g, invite_id]);

      await setIdentity(c, stranger);
      await refused(c, "select public.claim_group_email_invite($1)", [token], /isn't valid any more/);
      const gone = "00000000-0000-0000-0000-0000000000a3";
      await asAdmin(c, () => c.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'gone@club.ie', now())", [gone]));
      expect(await isMember(c, g, gone)).toBe(false);
    });
  });

  it("a refusal (a blocked golfer) is kept on the invite, and never stops the sign-up", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await society(c);
      await importRows(c, g, [{ email: emailOf(stranger) }]);
      await asAdmin(c, () => c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [owner, stranger]));
      await confirm(c, stranger);
      expect(await isMember(c, g, stranger)).toBe(false);
      await setIdentity(c, owner);
      const { rows } = await c.query("select status, failure from public.group_email_invites where group_id = $1", [g]);
      expect(rows[0].status).toBe("pending");
      expect(rows[0].failure).toMatch(/can't join/);
    });
  });
});

describe("resend_group_email_invites", () => {
  it("hands back pending tokens at most once an hour", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await society(c);
      const [{ invite_id }] = await importRows(c, g, [{ email: "again@club.ie" }]);
      const first = await c.query("select * from public.resend_group_email_invites($1, $2)", [g, [invite_id]]);
      expect(first.rows).toHaveLength(1);
      expect(first.rows[0].token).toMatch(/^[0-9a-f]{64}$/);

      await c.query("select public.mark_group_email_invites_sent($1, $2)", [g, [invite_id]]);
      expect((await c.query("select * from public.resend_group_email_invites($1, $2)", [g, [invite_id]])).rowCount).toBe(0);
      const { rows } = await c.query("select email_count from public.group_email_invites where id = $1", [invite_id]);
      expect(rows[0].email_count).toBe(1);
    });
  });
});
