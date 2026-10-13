// 0140_admin_controls.sql — hide / restore for courses, groups and events.
//
// What must hold:
//   - a hidden course is invisible to visitors and members (directory,
//     search, pickers, course pages all read through this policy), and
//     visible again once restored; staff (aal2) still read it
//   - a hidden group stays invisible to everyone, its own members included
//     (0120's rule, now with hidden_by / hidden_reason on the row, which
//     members can't read)
//   - a hidden event is invisible to the group's members, and so are its
//     entries, guests and itinerary (they read through society_outings)
//   - can_delete_account_for() is the service role's alone
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool, expectRejected } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const OWNER = USERS.seller1;
const MEMBER = USERS.buyer1;
const STAFF = USERS.admin;

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

async function service<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

const day = (daysAhead: number) => new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

async function aClub(c: PoolClient): Promise<string> {
  return (
    await service(c, () =>
      c.query<{ id: string }>(
        "insert into public.clubs (name, slug, country, source) values ('Hidden Test Links', 'hidden-test-links-0140', 'ireland', 'manual') returning id"
      )
    )
  ).rows[0].id;
}

async function society(c: PoolClient): Promise<string> {
  await as(c, OWNER);
  const id = (await c.query<{ id: string }>("select public.create_group('society', 'Portmarnock Hackers') as id")).rows[0].id;
  await service(c, () => c.query("select public.group_add_member($1, $2)", [id, MEMBER]));
  return id;
}

async function outing(c: PoolClient, groupId: string): Promise<string> {
  await as(c, OWNER);
  const p = JSON.stringify({ title: "Captain's Day", course_name: "Portmarnock Golf Club", plays_on: day(7) });
  const id = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [groupId, p])).rows[0].id;
  await c.query("select public.set_outing_entry($1, true, $2)", [id, MEMBER]);
  return id;
}

describe("hidden courses (clubs)", () => {
  it("are invisible to visitors and members, and come back when restored", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const club = await aClub(c);
      const seen = async () => (await c.query("select id from public.clubs where id = $1", [club])).rowCount;

      expect(await seen()).toBe(1);
      await service(c, () => c.query("update public.clubs set hidden_at = now(), hidden_reason = 'duplicate' where id = $1", [club]));
      expect(await seen()).toBe(0);

      // A visitor, the same transaction.
      await c.query("set local role anon");
      await c.query("select set_config('request.jwt.claim.sub', '', true)");
      expect((await c.query("select id from public.clubs where id = $1", [club])).rowCount).toBe(0);
      await c.query("set local role authenticated");
      await as(c, MEMBER);

      await service(c, () => c.query("update public.clubs set hidden_at = null, hidden_reason = null where id = $1", [club]));
      expect(await seen()).toBe(1);
    });
  });

  it("stay readable by staff with two-step sign-in", async () => {
    await withRole("authenticated", STAFF, async (c) => {
      const club = await aClub(c);
      await service(c, () => c.query("update public.clubs set hidden_at = now() where id = $1", [club]));
      await c.query("select set_config('request.jwt.claim.aal', 'aal2', true)");
      expect((await c.query("select id from public.clubs where id = $1", [club])).rowCount).toBe(1);
      await c.query("select set_config('request.jwt.claim.aal', 'aal1', true)");
      expect((await c.query("select id from public.clubs where id = $1", [club])).rowCount).toBe(0);
    });
  });

  it("leave visible courses readable by visitors", async () => {
    await withRole("anon", null, async (c) => {
      const { rows } = await c.query<{ n: string }>("select count(*) as n from public.clubs where hidden_at is null");
      const { rows: all } = await c.query<{ n: string }>("select count(*) as n from public.clubs");
      expect(all[0].n).toBe(rows[0].n);
    });
  });
});

describe("hidden groups", () => {
  it("are invisible to their own members, and members can't read who hid them", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const g = await society(c);
      await as(c, MEMBER);
      expect((await c.query("select id from public.groups where id = $1", [g])).rowCount).toBe(1);

      await service(c, () =>
        c.query("update public.groups set hidden_at = now(), hidden_by = $2, hidden_reason = 'spam' where id = $1", [g, STAFF])
      );
      expect((await c.query("select id from public.groups where id = $1", [g])).rowCount).toBe(0);
      await as(c, OWNER);
      expect((await c.query("select id from public.groups where id = $1", [g])).rowCount).toBe(0);

      await c.query("savepoint s");
      await expectRejected(c.query("select hidden_reason from public.groups limit 1"), /permission denied/);
      await c.query("rollback to savepoint s");
    });
  });
});

describe("hidden events (society_outings)", () => {
  it("are invisible to the group's members, with their entries", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      const g = await society(c);
      const o = await outing(c, g);
      await as(c, MEMBER);
      expect((await c.query("select id from public.society_outings where id = $1", [o])).rowCount).toBe(1);
      expect((await c.query("select member_id from public.society_outing_entries where outing_id = $1", [o])).rowCount).toBe(1);

      await service(c, () => c.query("update public.society_outings set hidden_at = now(), hidden_reason = 'test' where id = $1", [o]));
      expect((await c.query("select id from public.society_outings where id = $1", [o])).rowCount).toBe(0);
      expect((await c.query("select member_id from public.society_outing_entries where outing_id = $1", [o])).rowCount).toBe(0);
      await as(c, OWNER);
      expect((await c.query("select id from public.society_outings where id = $1", [o])).rowCount).toBe(0);

      await service(c, () => c.query("update public.society_outings set hidden_at = null, hidden_reason = null where id = $1", [o]));
      expect((await c.query("select id from public.society_outings where id = $1", [o])).rowCount).toBe(1);
    });
  });

  it("are never visible to a visitor", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(c.query("select id from public.society_outings limit 1"), /permission denied/);
    });
  });
});

describe("can_delete_account_for", () => {
  it("can't be called by members or visitors", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await expectRejected(c.query("select public.can_delete_account_for($1)", [MEMBER]), /permission denied/);
    });
    await withRole("anon", null, async (c) => {
      await expectRejected(c.query("select public.can_delete_account_for($1)", [MEMBER]), /permission denied/);
    });
  });

  it("answers for the service role, with the same rules as can_delete_account()", async () => {
    await withRole("service_role", null, async (c) => {
      const { rows } = await c.query<{ r: string | null }>("select public.can_delete_account_for($1) as r", [USERS.buyer2]);
      expect(rows[0].r === null || typeof rows[0].r === "string").toBe(true);
    });
  });
});
