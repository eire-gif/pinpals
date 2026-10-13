// 0134_member_phones.sql — verified mobile numbers.
//
// Cast:
//   seller1    owns the society
//   moderator  its secretary
//   buyer1     a member
//   buyer2     a member
//   seller2    not in the society
//
// What must hold:
//   - a member adds, changes and removes their own number, nobody else's
//   - a member reads their own number only; numbers must be in +353… form
//   - sharing is the member's own, and only with groups they are in
//   - the people who run a group see the numbers shared with it; members see
//     only the people who run it; outsiders see nothing
//   - remove_my_phone() clears the number and every share
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

async function rejects(c: PoolClient, sql: string, params: unknown[]): Promise<void> {
  await c.query("savepoint attempt");
  let failed = false;
  try {
    await c.query(sql, params);
  } catch {
    failed = true;
  }
  await c.query("rollback to savepoint attempt");
  if (!failed) throw new Error(`Expected to be rejected: ${sql}`);
}

/** A member saving their mobile. */
async function verify(c: PoolClient, userId: string, phone: string): Promise<void> {
  await as(c, userId);
  await c.query(
    "insert into public.member_phones (member_id, phone) values ($1, $2) on conflict (member_id) do update set phone = excluded.phone",
    [userId, phone],
  );
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

async function share(c: PoolClient, userId: string, group: string): Promise<void> {
  await as(c, userId);
  await c.query("insert into public.member_phone_shares (member_id, group_id) values ($1, $2)", [userId, group]);
}

const contacts = async (c: PoolClient, userId: string, group: string) => {
  await as(c, userId);
  return (await c.query<{ member_id: string; phone: string }>("select member_id, phone from public.group_contacts($1)", [group])).rows;
};

describe("the number", () => {
  it("is the member's own to add, change and remove", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await verify(c, MEMBER, "+353871234567");
      await verify(c, MEMBER, "+353861112222");
      const { rows } = await c.query("select phone from public.member_phones where member_id = $1", [MEMBER]);
      expect(rows).toEqual([{ phone: "+353861112222" }]);
      await c.query("delete from public.member_phones where member_id = $1", [MEMBER]);
      expect((await c.query("select * from public.member_phones")).rows).toEqual([]);
    });
  });

  it("must be in +353… form", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await as(c, MEMBER);
      await rejects(c, "insert into public.member_phones (member_id, phone) values ($1, '087 123 4567')", [MEMBER]);
    });
  });

  it("nobody else can read, add, change or remove it", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await verify(c, MEMBER, "+353871234567");
      await as(c, STRANGER);
      expect((await c.query("select * from public.member_phones where member_id = $1", [MEMBER])).rows).toEqual([]);
      await rejects(c, "insert into public.member_phones (member_id, phone) values ($1, '+353870000000')", [MEMBER2]);
      expect((await c.query("update public.member_phones set phone = '+353870000000' where member_id = $1", [MEMBER])).rowCount).toBe(0);
      expect((await c.query("delete from public.member_phones where member_id = $1", [MEMBER])).rowCount).toBe(0);
    });
  });

  it("anon gets nothing", async () => {
    await withRole("anon", null, async (c) => {
      await rejects(c, "select * from public.member_phones", []);
      await rejects(c, "select * from public.member_phone_shares", []);
      await rejects(c, "select * from public.group_contacts(1)", []);
    });
  });
});

describe("sharing", () => {
  it("only with a group you're in", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await as(c, STRANGER);
      await rejects(c, "insert into public.member_phone_shares (member_id, group_id) values ($1, $2)", [STRANGER, g]);
      await as(c, MEMBER);
      await rejects(c, "insert into public.member_phone_shares (member_id, group_id) values ($1, $2)", [MEMBER2, g]);
    });
  });

  it("the people who run it see members' numbers; members see theirs; outsiders nothing", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await verify(c, MEMBER, "+353871234567");
      await verify(c, SECRETARY, "+353861112222");
      await verify(c, MEMBER2, "+353851113333");
      await share(c, MEMBER, g);
      await share(c, SECRETARY, g);
      // MEMBER2 verified a number but didn't share it.

      const forOwner = await contacts(c, OWNER, g);
      expect(forOwner.map((r) => r.member_id).sort()).toEqual([MEMBER, SECRETARY].sort());

      const forSecretary = await contacts(c, SECRETARY, g);
      expect(forSecretary.map((r) => r.member_id).sort()).toEqual([MEMBER, SECRETARY].sort());

      const forMember = await contacts(c, MEMBER2, g);
      expect(forMember).toEqual([{ member_id: SECRETARY, phone: "+353861112222" }]);

      await as(c, STRANGER);
      await rejects(c, "select * from public.group_contacts($1)", [g]);
    });
  });

  it("stopping sharing takes it out straight away", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await verify(c, MEMBER, "+353871234567");
      await share(c, MEMBER, g);
      await as(c, MEMBER);
      await c.query("delete from public.member_phone_shares where group_id = $1", [g]);
      expect(await contacts(c, OWNER, g)).toEqual([]);
    });
  });
});

describe("remove_my_phone()", () => {
  it("clears the number and every share", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await society(c);
      await verify(c, MEMBER, "+353871234567");
      await share(c, MEMBER, g);
      await as(c, MEMBER);
      await c.query("select public.remove_my_phone()");

      expect((await c.query("select * from public.member_phones")).rows).toEqual([]);
      expect((await c.query("select * from public.member_phone_shares")).rows).toEqual([]);
    });
  });

  it("the server's version is not for members", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await rejects(c, "select public.remove_member_phone($1)", [MEMBER2]);
    });
  });
});
