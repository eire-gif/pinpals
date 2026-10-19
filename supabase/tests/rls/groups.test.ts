// 0120_groups.sql — groups, step B.
//
// Membership will soon decide what people can see (group posts and tee times
// in steps C and D), so this file is about the door: who can see a group, who
// can see who is in it, and every way someone gets in or is put out. Every
// write goes through a function; members have SELECT and nothing else.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, setIdentity, expectRejected, expectZeroRows, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const { seller1: owner, seller2: friend, buyer1: golfer, buyer2: stranger } = USERS;

async function asService<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

async function connect(c: PoolClient, a: string, others: string[]): Promise<void> {
  await asService(c, async () => {
    for (const b of others) {
      await c.query(
        `insert into public.connections (requester_id, recipient_id, status)
         values ($1, $2, 'accepted')
         on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
         do update set status = 'accepted'`,
        [a, b],
      );
    }
  });
}

async function block(c: PoolClient, blocker: string, blocked: string): Promise<void> {
  await asService(c, () =>
    c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2) on conflict do nothing", [blocker, blocked]),
  );
}

/** Runs a statement that should fail without aborting the test's transaction. */
async function refused(c: PoolClient, sql: string, params: unknown[], pattern?: RegExp): Promise<void> {
  await c.query("savepoint attempt");
  try {
    await expectRejected(c.query(sql, params), pattern);
  } finally {
    await c.query("rollback to savepoint attempt");
  }
}

async function createGroup(c: PoolClient, as: string, kind: string, name: string): Promise<string> {
  await setIdentity(c, as);
  const { rows } = await c.query<{ id: string }>("select public.create_group($1, $2) as id", [kind, name]);
  return rows[0].id;
}

async function addDirect(c: PoolClient, groupId: string, memberId: string): Promise<void> {
  await asService(c, () => c.query("select public.group_add_member($1, $2)", [groupId, memberId]));
}

const roleOf = async (c: PoolClient, groupId: string, memberId: string) =>
  (
    await asService(c, () =>
      c.query<{ role: string }>("select role from public.group_members where group_id = $1 and member_id = $2", [groupId, memberId]),
    )
  ).rows[0]?.role ?? null;

// ---------------------------------------------------------------------------

describe("create_group", () => {
  it("makes the creator the owner, with the kind's defaults", async () => {
    await withRole("authenticated", owner, async (c) => {
      const crew = await createGroup(c, owner, "crew", "Saturday Golf Crew");
      const society = await createGroup(c, owner, "society", "Malahide Golf Society");
      const { rows } = await c.query<{ id: string; privacy: string; features: string[]; member_count: number }>(
        "select id, privacy, features, member_count from public.groups where id in ($1, $2) order by id",
        [crew, society],
      );
      expect(rows[0]).toMatchObject({ privacy: "invite", member_count: 1 });
      expect(rows[0].features).toContain("chat");
      expect(rows[1]).toMatchObject({ privacy: "request", member_count: 1 });
      expect(rows[1].features).not.toContain("chat");
      expect(await roleOf(c, crew, owner)).toBe("owner");
    });
  });

  it("refuses local and club groups, and names starting with PinPals", async () => {
    await withRole("authenticated", owner, async (c) => {
      await refused(c, "select public.create_group('area', 'Dublin Golfers')", [], /crew, a trip or a society/);
      await refused(c, "select public.create_group('club', 'Portmarnock members')", [], /crew, a trip or a society/);
      await refused(c, "select public.create_group('crew', 'PinPals official')", [], /can't start with PinPals/);
    });
  });

  it("members can't write the tables directly", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "crew", "Crew");
      await refused(c, "insert into public.groups (kind, name, privacy) values ('crew', 'Sneaky', 'invite')", [], /permission denied/);
      await refused(c, "insert into public.group_members (group_id, member_id) values ($1, $2)", [g, golfer], /permission denied/);
      await refused(c, "update public.group_members set role = 'owner' where group_id = $1", [g], /permission denied/);
      await refused(c, "insert into public.group_invitations (group_id, member_id, direction) values ($1, $2, 'request')", [g, golfer], /permission denied/);
    });
  });
});

describe("who can see a group, and who is in it", () => {
  it("an invite-only crew is invisible to everyone but its members and invitees", async () => {
    await withRole("authenticated", owner, async (c) => {
      await connect(c, owner, [friend]);
      const g = await createGroup(c, owner, "crew", "Saturday Golf Crew");
      await c.query("select public.invite_to_group($1, $2::uuid[])", [g, [friend]]);

      await setIdentity(c, stranger);
      expectZeroRows(await c.query("select id from public.groups where id = $1", [g]));
      expectZeroRows(await c.query("select member_id from public.group_members where group_id = $1", [g]));

      // Invited: sees the group's front page, not who's in it.
      await setIdentity(c, friend);
      expect((await c.query("select id from public.groups where id = $1", [g])).rowCount).toBe(1);
      expectZeroRows(await c.query("select member_id from public.group_members where group_id = $1", [g]));
    });
  });

  it("a society shows in search to any signed-in member, but its member list is for members", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "society", "Malahide Golf Society");
      await setIdentity(c, stranger);
      const { rows } = await c.query<{ name: string; member_count: number }>(
        "select name, member_count from public.groups where privacy = 'request' and name ilike '%malahide%'",
      );
      expect(rows).toEqual([{ name: "Malahide Golf Society", member_count: 1 }]);
      expectZeroRows(await c.query("select member_id from public.group_members where group_id = $1", [g]));
    });
  });

  it("signed-out visitors see no groups at all", async () => {
    let g = "";
    await withRole("authenticated", owner, async (c) => {
      g = await createGroup(c, owner, "society", "Malahide Golf Society");
      await c.query("set local role anon");
      await refused(c, "select id from public.groups where id = $1", [g], /permission denied/);
    });
  });

  it("the invite code can't be read from the table, even by the owner", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "society", "Malahide Golf Society");
      await c.query("select public.group_invite_code($1)", [g]);
      await refused(c, "select invite_code from public.groups where id = $1", [g], /permission denied/);
    });
  });

  it("a hidden group is gone for its members too", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "society", "Malahide Golf Society");
      await asService(c, () => c.query("update public.groups set hidden_at = now() where id = $1", [g]));
      expectZeroRows(await c.query("select id from public.groups where id = $1", [g]));
    });
  });
});

describe("invitations", () => {
  it("whoever runs it can invite anyone (Find PinPals, 0122), and accepting puts them in", async () => {
    await withRole("authenticated", owner, async (c) => {
      await connect(c, owner, [friend]);
      const g = await createGroup(c, owner, "crew", "Crew");
      const { rows } = await c.query<{ n: number }>("select public.invite_to_group($1, $2::uuid[]) as n", [g, [friend, stranger]]);
      expect(rows[0].n).toBe(2); // 0122: the owner can invite members they aren't connected with

      await setIdentity(c, friend);
      await c.query("select public.respond_group_invitation($1, true)", [g]);
      expect(await roleOf(c, g, friend)).toBe("member");

      await setIdentity(c, stranger);
      await c.query("select public.respond_group_invitation($1, false)", [g]);
      expect(await roleOf(c, g, stranger)).toBeNull();
      await refused(c, "select public.respond_group_invitation($1, true)", [g], /already been answered or withdrawn/);
    });
  });

  it("members invite only when the group allows it", async () => {
    await withRole("authenticated", owner, async (c) => {
      await connect(c, friend, [golfer]);
      const g = await createGroup(c, owner, "crew", "Crew");
      await addDirect(c, g, friend);
      await setIdentity(c, owner);
      await c.query("select public.update_group($1, 'Crew', null, false)", [g]);
      await setIdentity(c, friend);
      await refused(c, "select public.invite_to_group($1, $2::uuid[])", [g, [golfer]], /Only whoever runs/);
      await refused(c, "select public.group_invite_code($1)", [g], /Only whoever runs/);
    });
  });
});

describe("asking to join a society", () => {
  it("a request waits for an admin; a member can't approve it", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "society", "Malahide Golf Society");
      await addDirect(c, g, friend);

      await setIdentity(c, golfer);
      expect((await c.query<{ r: string }>("select public.request_to_join_group($1) as r", [g])).rows[0].r).toBe("requested");
      expect(await roleOf(c, g, golfer)).toBeNull();

      await setIdentity(c, friend);
      await refused(c, "select public.review_group_request($1, $2, true)", [g, golfer], /Only whoever runs/);

      await setIdentity(c, owner);
      expect((await c.query("select member_id from public.group_invitations where group_id = $1 and status = 'pending'", [g])).rowCount).toBe(1);
      await c.query("select public.review_group_request($1, $2, true)", [g, golfer]);
      expect(await roleOf(c, g, golfer)).toBe("member");
    });
  });

  it("a declined request can't be repeated straight away", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "society", "Malahide Golf Society");
      await setIdentity(c, golfer);
      await c.query("select public.request_to_join_group($1)", [g]);
      await setIdentity(c, owner);
      await c.query("select public.review_group_request($1, $2, false)", [g, golfer]);
      await setIdentity(c, golfer);
      await refused(c, "select public.request_to_join_group($1)", [g], /turned down recently/);
    });
  });

  it("an invite-only crew can't be asked to join", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "crew", "Crew");
      await setIdentity(c, golfer);
      await refused(c, "select public.request_to_join_group($1)", [g], /invite only/);
    });
  });
});

describe("invite links", () => {
  it("anyone with the link joins straight in, and a reset kills the old link", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "society", "Malahide Golf Society");
      const code = (await c.query<{ code: string }>("select public.group_invite_code($1) as code", [g])).rows[0].code;
      expect(code).toMatch(/^[a-z0-9]{8}$/);

      await setIdentity(c, golfer);
      expect((await c.query<{ id: string }>("select public.join_group_by_code($1) as id", [code])).rows[0].id).toBe(g);
      expect(await roleOf(c, g, golfer)).toBe("member");

      await setIdentity(c, owner);
      const fresh = (await c.query<{ code: string }>("select public.reset_group_invite_code($1) as code", [g])).rows[0].code;
      expect(fresh).not.toBe(code);
      await setIdentity(c, stranger);
      await refused(c, "select public.join_group_by_code($1)", [code], /isn't valid any more/);
    });
  });

  it("the link's preview works signed out and shows only the front page", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "society", "Malahide Golf Society");
      const code = (await c.query<{ code: string }>("select public.group_invite_code($1) as code", [g])).rows[0].code;
      await c.query("set local role anon");
      const { rows } = await c.query("select * from public.group_invite_preview($1)", [code]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: "Malahide Golf Society", kind: "society", member_count: 1 });
      expect(Object.keys(rows[0]).sort()).toEqual(
        ["about", "club_name", "group_id", "kind", "member_count", "name", "owner_first_name"].sort(),
      );
    });
  });
});

describe("blocks and capacity", () => {
  it("someone the owner has blocked can't request, join by link, or be invited", async () => {
    await withRole("authenticated", owner, async (c) => {
      await connect(c, friend, [golfer]);
      const g = await createGroup(c, owner, "society", "Malahide Golf Society");
      await addDirect(c, g, friend);
      await setIdentity(c, owner);
      await c.query("select public.set_group_office($1, $2, 'captain')", [g, friend]); // 0122: only officers invite
      const code = (await c.query<{ code: string }>("select public.group_invite_code($1) as code", [g])).rows[0].code;
      await block(c, owner, golfer);

      await setIdentity(c, golfer);
      await refused(c, "select public.request_to_join_group($1)", [g], /can't join this group/);
      await refused(c, "select public.join_group_by_code($1)", [code], /can't join this group/);

      await setIdentity(c, friend);
      expect((await c.query<{ n: number }>("select public.invite_to_group($1, $2::uuid[]) as n", [g, [golfer]])).rows[0].n).toBe(0);
    });
  });

  it("a full crew takes nobody else", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "crew", "Crew");
      const code = (await c.query<{ code: string }>("select public.group_invite_code($1) as code", [g])).rows[0].code;
      await asService(c, () => c.query("update public.groups set member_count = 20 where id = $1", [g]));
      await setIdentity(c, golfer);
      await refused(c, "select public.join_group_by_code($1)", [code], /full/);
    });
  });
});

describe("roles, leaving and succession", () => {
  it("an admin removes members but not other admins; only the owner changes roles", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "society", "Society");
      for (const m of [friend, golfer, stranger]) await addDirect(c, g, m);
      // 0122: a society's admins are its captain and secretary.
      await c.query("select public.set_group_office($1, $2, 'captain')", [g, friend]);
      await c.query("select public.set_group_office($1, $2, 'secretary')", [g, golfer]);

      await setIdentity(c, friend);
      await refused(c, "select public.remove_group_member($1, $2)", [g, golfer], /can't remove that member/);
      await refused(c, "select public.set_group_role($1, $2, 'admin')", [g, stranger], /Only the group's owner/);
      await c.query("select public.remove_group_member($1, $2)", [g, stranger]);
      expect(await roleOf(c, g, stranger)).toBeNull();
    });
  });

  it("the owner can't walk out on a group, but can hand it over", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "society", "Society");
      await addDirect(c, g, friend);
      await refused(c, "select public.leave_group($1)", [g], /Hand the group to someone else/);
      await c.query("select public.set_group_role($1, $2, 'owner')", [g, friend]);
      expect(await roleOf(c, g, friend)).toBe("owner");
      expect(await roleOf(c, g, owner)).toBe("admin");
      await c.query("select public.leave_group($1)", [g]);
      expect(await roleOf(c, g, owner)).toBeNull();
    });
  });

  it("if the owner's membership goes (account deletion), the longest-serving admin takes over", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "society", "Society");
      await addDirect(c, g, friend);
      await addDirect(c, g, golfer);
      await c.query("select public.set_group_office($1, $2, 'secretary')", [g, golfer]);
      await asService(c, () => c.query("delete from public.group_members where group_id = $1 and member_id = $2", [g, owner]));
      expect(await roleOf(c, g, golfer)).toBe("owner");
      expect(await roleOf(c, g, friend)).toBe("member");
    });
  });

  it("a group nobody is left in is deleted", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "crew", "Crew");
      await c.query("select public.leave_group($1)", [g]);
      const left = await asService(c, () => c.query("select id from public.groups where id = $1", [g]));
      expectZeroRows(left);
    });
  });
});

describe("the group chat", () => {
  it("a crew's chat opens with the group and follows the membership (0181)", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "crew", "Saturday Golf Crew");
      const first = await asService(c, () => c.query<{ conversation_id: string | null }>("select conversation_id from public.groups where id = $1", [g]));
      expect(first.rows[0].conversation_id).not.toBeNull();

      await addDirect(c, g, friend);
      await addDirect(c, g, golfer);
      const chat = (await asService(c, () => c.query<{ conversation_id: string }>("select conversation_id from public.groups where id = $1", [g])))
        .rows[0].conversation_id;
      expect(chat).not.toBeNull();
      const members = async () =>
        (
          await asService(c, () =>
            c.query<{ member_id: string }>("select member_id from public.conversation_members where conversation_id = $1 order by member_id", [chat]),
          )
        ).rows.map((r) => r.member_id);
      expect(await members()).toEqual([owner, friend, golfer].sort());

      // As a member, the chat is readable through 0087's own policy.
      await setIdentity(c, golfer);
      expect((await c.query("select id, title from public.conversations where id = $1", [chat])).rows[0].title).toBe("Saturday Golf Crew");
      await c.query("select public.leave_group($1)", [g]);
      expect(await members()).toEqual([owner, friend].sort());
    });
  });

  it("someone blocked by a member already in the chat is in the group but left out of the chat", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "crew", "Crew");
      await addDirect(c, g, friend);
      await addDirect(c, g, golfer);
      await block(c, friend, stranger);
      await addDirect(c, g, stranger);
      expect(await roleOf(c, g, stranger)).toBe("member");
      const { rows } = await asService(c, () =>
        c.query(
          `select 1 from public.conversation_members cm join public.groups g on g.conversation_id = cm.conversation_id
           where g.id = $1 and cm.member_id = $2`,
          [g, stranger],
        ),
      );
      expect(rows).toHaveLength(0);
    });
  });

  it("a society never gets a chat", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "society", "Society");
      for (const m of [friend, golfer, stranger]) await addDirect(c, g, m);
      const { rows } = await asService(c, () => c.query<{ conversation_id: string | null }>("select conversation_id from public.groups where id = $1", [g]));
      expect(rows[0].conversation_id).toBeNull();
    });
  });
});

describe("group_members links to profiles exactly once (0123)", () => {
  it("so the app's profile:profiles(...) embeds stay unambiguous", async () => {
    await withRole("authenticated", owner, async (c) => {
      const { rows } = await asService(c, () =>
        c.query<{ n: number }>(
          "select count(*)::int as n from pg_constraint where conrelid = 'public.group_members'::regclass and contype = 'f' and confrelid = 'public.profiles'::regclass",
        ),
      );
      expect(rows[0].n).toBe(1);
    });
  });
});
