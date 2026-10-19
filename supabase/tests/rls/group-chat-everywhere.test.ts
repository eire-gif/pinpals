// 0181_group_chat_everywhere.sql — a Golf Buddies group's or trip's chat
// opens with the group, under-18s are left out of it rather than blocking
// the join, and each member sets how loudly the chat alerts them.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, setIdentity, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const { seller1: owner, seller2: friend, buyer1: golfer, buyer2: teen } = USERS;

async function asService<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
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

async function createGroup(c: PoolClient, as: string, kind: string, name: string): Promise<string> {
  await setIdentity(c, as);
  const { rows } = await c.query<{ id: string }>("select public.create_group($1, $2) as id", [kind, name]);
  return rows[0].id;
}

async function addDirect(c: PoolClient, groupId: string, memberId: string): Promise<void> {
  await asService(c, () => c.query("select public.group_add_member($1, $2)", [groupId, memberId]));
}

async function chatOf(c: PoolClient, groupId: string): Promise<string | null> {
  const { rows } = await asService(c, () =>
    c.query<{ conversation_id: string | null }>("select conversation_id from public.groups where id = $1", [groupId]),
  );
  return rows[0]?.conversation_id ?? null;
}

async function alertsOf(c: PoolClient, chat: string, member: string): Promise<string | null> {
  const { rows } = await asService(c, () =>
    c.query<{ alerts: string }>("select alerts from public.conversation_members where conversation_id = $1 and member_id = $2", [chat, member]),
  );
  return rows[0]?.alerts ?? null;
}

/** Extra golfers for the "big trip" test; rolled back with the transaction. */
async function extraGolfers(c: PoolClient, n: number): Promise<string[]> {
  const ids: string[] = [];
  await c.query("reset role");
  try {
    for (let i = 0; i < n; i++) {
      const id = `00000000-0000-0000-0181-${String(i + 1).padStart(12, "0")}`;
      await c.query(
        `insert into auth.users (id, email, raw_user_meta_data)
         values ($1, $2, jsonb_build_object('first_name', 'Golfer', 'last_name', $3::text))
         on conflict (id) do nothing`,
        [id, `${id}@example.test`, String(i + 1)],
      );
      ids.push(id);
    }
  } finally {
    await c.query("set local role authenticated");
  }
  return ids;
}

describe("a group's chat opens with the group", () => {
  it("a trip has its chat, with just its creator, the moment it's made", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "trip", "Algarve 2027");
      const chat = await chatOf(c, g);
      expect(chat).not.toBeNull();
      const { rows } = await c.query<{ member_id: string; role: string }>(
        "select member_id, role from public.conversation_members where conversation_id = $1",
        [chat],
      );
      expect(rows).toEqual([{ member_id: owner, role: "owner" }]);
      const conv = await c.query<{ kind: string; title: string }>("select kind, title from public.conversations where id = $1", [chat]);
      expect(conv.rows[0]).toEqual({ kind: "group", title: "Algarve 2027" });
    });
  });

  it("a new member reads everything said before they joined", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "crew", "Saturday Swingers");
      const chat = await chatOf(c, g);
      await c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'First tee 8:40')", [chat, owner]);
      await addDirect(c, g, friend);
      await setIdentity(c, friend);
      const { rows } = await c.query<{ body: string }>("select body from public.messages where conversation_id = $1", [chat]);
      expect(rows.map((r) => r.body)).toContain("First tee 8:40");
    });
  });

  it("an existing crew with no chat gets one from the backfill's function", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "crew", "Old crew");
      // Simulate a group made before 0181 that never reached three.
      await asService(c, async () => {
        const chat = (await c.query<{ conversation_id: string }>("select conversation_id from public.groups where id = $1", [g])).rows[0].conversation_id;
        await c.query("update public.groups set conversation_id = null where id = $1", [g]);
        await c.query("delete from public.conversations where id = $1", [chat]);
      });
      expect(await chatOf(c, g)).toBeNull();
      await c.query("reset role");
      await c.query("select public.group_sync_chat($1)", [g]);
      await c.query("set local role authenticated");
      expect(await chatOf(c, g)).not.toBeNull();
    });
  });

  it("a member under 18 joins the group but is left out of the chat", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "crew", "Family fourball");
      const chat = await chatOf(c, g);
      const dob = new Date();
      dob.setUTCFullYear(dob.getUTCFullYear() - 17);
      await asService(c, () =>
        c.query(
          `insert into public.member_birthdates (user_id, date_of_birth) values ($1, $2)
           on conflict (user_id) do update set date_of_birth = excluded.date_of_birth`,
          [teen, dob.toISOString().slice(0, 10)],
        ),
      );
      await addDirect(c, g, teen);
      const inGroup = await asService(c, () =>
        c.query("select 1 from public.group_members where group_id = $1 and member_id = $2", [g, teen]),
      );
      expect(inGroup.rows).toHaveLength(1);
      expect(await alertsOf(c, chat!, teen)).toBeNull();
      // And the chat keeps working for everyone else.
      await addDirect(c, g, golfer);
      expect(await alertsOf(c, chat!, golfer)).toBe("all");
    });
  });

  it("a society still never gets a chat", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "society", "Society");
      expect(await chatOf(c, g)).toBeNull();
    });
  });
});

describe("chat alerts", () => {
  it("a member sets their own alerts and nobody else's", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "crew", "Crew");
      const chat = (await chatOf(c, g))!;
      await addDirect(c, g, friend);

      await setIdentity(c, friend);
      expect(await alertsOf(c, chat, friend)).toBe("all");
      await c.query("update public.conversation_members set alerts = 'key' where conversation_id = $1 and member_id = $2", [chat, friend]);
      expect(await alertsOf(c, chat, friend)).toBe("key");
      await c.query("update public.conversation_members set alerts = 'none' where conversation_id = $1 and member_id = $2", [chat, friend]);
      expect(await alertsOf(c, chat, friend)).toBe("none");

      // Someone else's row: RLS leaves it untouched.
      const other = await c.query("update public.conversation_members set alerts = 'none' where conversation_id = $1 and member_id = $2", [chat, owner]);
      expect(other.rowCount).toBe(0);
      expect(await alertsOf(c, chat, owner)).toBe("all");

      await refused(c, "update public.conversation_members set alerts = 'loud' where conversation_id = $1 and member_id = $2", [chat, friend]);
      // Still can't touch the frozen columns while changing alerts.
      await refused(
        c,
        "update public.conversation_members set alerts = 'all', role = 'owner' where conversation_id = $1 and member_id = $2",
        [chat, friend],
        /read and archive state/,
      );
    });
  });

  it("a big trip defaults new golfers to Rounds & @me; its organiser keeps everything", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "trip", "Big trip");
      const chat = (await chatOf(c, g))!;
      const extras = await extraGolfers(c, 7);
      const everyone = [friend, golfer, ...extras];
      for (const m of everyone) await addDirect(c, g, m);

      expect(await alertsOf(c, chat, owner)).toBe("all");
      // Golfers 2–7 joined a trip of under eight.
      expect(await alertsOf(c, chat, friend)).toBe("all");
      // By the time the last ones join, the trip has eight or more.
      expect(await alertsOf(c, chat, extras[extras.length - 1])).toBe("key");
    });
  });

  it("a crew never defaults to anything but everything", async () => {
    await withRole("authenticated", owner, async (c) => {
      const g = await createGroup(c, owner, "crew", "Big crew");
      const chat = (await chatOf(c, g))!;
      const extras = await extraGolfers(c, 8);
      for (const m of extras) await addDirect(c, g, m);
      expect(await alertsOf(c, chat, extras[7])).toBe("all");
    });
  });
});
