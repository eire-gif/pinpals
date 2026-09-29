// 0087_group_conversations.sql.
//
// A conversation with more than two people in it is new privacy surface, and
// it is the kind that fails silently: a policy that is one clause too generous
// shows nothing unusual to the person it is too generous for. Everything below
// is about who is in a conversation, who may put them there, and what that
// membership does and does not entitle them to.
//
// The same deliberate omission as messaging.test.ts runs through this file:
// staff have NO read access to message content or to who is in a conversation.
// The only staff route remains the audited, reason-required
// /admin/reports/[id] Server Action, which runs as the service role. Every
// staff assertion here is an assertion of ABSENCE.
import { describe, it, expect, afterAll } from "vitest";
import { withRole, setIdentity, expectRejected, expectZeroRows, closePool, pool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";
import type { PoolClient } from "pg";

const ids = fixtureIds();

afterAll(closePool);

/**
 * Connects `me` to each of `others` inside the caller's own transaction.
 *
 * The shared fixture has no `connections` rows at all — its one conversation
 * is eligible via an offer instead — and adding some to it would perturb every
 * other test file in the suite. withRole() always rolls back, so seeding here
 * is free and leaves nothing behind.
 *
 * Written as the service role because `connections` has no policy that lets
 * one member create an already-accepted row on someone else's behalf, which is
 * correct and is not what is under test here.
 */
async function connect(c: PoolClient, me: string, others: string[]): Promise<void> {
  await c.query("set local role service_role");
  for (const other of others) {
    await c.query(
      `insert into public.connections (requester_id, recipient_id, status)
       values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
       do update set status = 'accepted'`,
      [me, other],
    );
  }
  await c.query("set local role authenticated");
}

async function block(c: PoolClient, blocker: string, blocked: string): Promise<void> {
  await c.query("set local role service_role");
  await c.query(
    "insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2) on conflict do nothing",
    [blocker, blocked],
  );
  await c.query("set local role authenticated");
}

/** seller1 starts a group with buyer1 and buyer2, all three mutually
 *  eligible. Returns the new conversation's id. */
async function makeGroup(c: PoolClient, title = "Saturday fourball"): Promise<string> {
  await connect(c, USERS.seller1, [USERS.buyer1, USERS.buyer2]);
  await connect(c, USERS.buyer1, [USERS.buyer2]);
  const { rows } = await c.query<{ id: string }>(
    "select public.create_group_conversation($1, $2::uuid[]) as id",
    [title, [USERS.buyer1, USERS.buyer2]],
  );
  return rows[0].id;
}

// ---------------------------------------------------------------------------

describe("create_group_conversation: who may start one, and with whom", () => {
  it("creates the conversation and every member row in one go", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);

      const conv = await c.query<{ kind: string; title: string; created_by: string; user_a_id: string | null }>(
        "select kind, title, created_by, user_a_id from public.conversations where id = $1",
        [id],
      );
      expect(conv.rows[0].kind).toBe("group");
      expect(conv.rows[0].title).toBe("Saturday fourball");
      expect(conv.rows[0].created_by).toBe(USERS.seller1);
      // A group leaves the pair columns null — that is what keeps it out of
      // the direct-thread unique indexes entirely.
      expect(conv.rows[0].user_a_id).toBeNull();

      const members = await c.query<{ member_id: string; role: string }>(
        "select member_id, role from public.conversation_members where conversation_id = $1 order by role",
        [id],
      );
      expect(members.rows).toHaveLength(3);
      expect(members.rows.filter((r) => r.role === "owner").map((r) => r.member_id)).toEqual([
        USERS.seller1,
      ]);
    });
  });

  it("refuses a group of two — that is a direct conversation", async () => {
    // Two people already have a thread, by the pair's unique index. A second,
    // differently-shaped one for the same two people would split their history
    // in half.
    await withRole("authenticated", USERS.seller1, async (c) => {
      await connect(c, USERS.seller1, [USERS.buyer1]);
      await expectRejected(
        c.query("select public.create_group_conversation($1, $2::uuid[])", ["Just us", [USERS.buyer1]]),
        /at least two other people/i,
      );
    });
  });

  it("refuses someone the creator has no business messaging", async () => {
    // can_message() is the same gate a direct thread passes: connected,
    // mid-offer, or sharing an accepted tee-time interest. A group is not a
    // way around it.
    await withRole("authenticated", USERS.seller1, async (c) => {
      await connect(c, USERS.seller1, [USERS.buyer1]);
      await expectRejected(
        c.query("select public.create_group_conversation($1, $2::uuid[])", [
          "Strangers",
          [USERS.buyer1, USERS.seller2],
        ]),
        /connected with/i,
      );
    });
  });

  it("refuses a group where two OTHER members are blocked with each other", async () => {
    // THE test in this file. Checking blocks only against the creator would
    // let A put B and C in a room together when B blocked C — the creator is
    // eligible with both, and neither of them chose this. That is why the
    // check is across all pairs rather than against the creator alone.
    await withRole("authenticated", USERS.seller1, async (c) => {
      await connect(c, USERS.seller1, [USERS.buyer1, USERS.buyer2]);
      await block(c, USERS.buyer1, USERS.buyer2);

      await expectRejected(
        c.query("select public.create_group_conversation($1, $2::uuid[])", [
          "Awkward",
          [USERS.buyer1, USERS.buyer2],
        ]),
        /blocked another/i,
      );
    });
  });

  it("refuses a blank or oversized name", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await connect(c, USERS.seller1, [USERS.buyer1, USERS.buyer2]);
      await connect(c, USERS.buyer1, [USERS.buyer2]);
      await expectRejected(
        c.query("select public.create_group_conversation($1, $2::uuid[])", ["   ", [USERS.buyer1, USERS.buyer2]]),
        /name/i,
      );
    });
    await withRole("authenticated", USERS.seller1, async (c) => {
      await connect(c, USERS.seller1, [USERS.buyer1, USERS.buyer2]);
      await connect(c, USERS.buyer1, [USERS.buyer2]);
      await expectRejected(
        c.query("select public.create_group_conversation($1, $2::uuid[])", [
          "x".repeat(81),
          [USERS.buyer1, USERS.buyer2],
        ]),
        /too long/i,
      );
    });
  });

  it("is unreachable from a signed-out browser", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("select public.create_group_conversation($1, $2::uuid[])", ["Anon", [USERS.buyer1, USERS.buyer2]]),
        /permission denied/i,
      );
    });
  });
});

describe("a group's messages are visible to its members and nobody else", () => {
  it("every member can read the conversation, its members and its messages", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Tee off at nine')", [
        id,
        USERS.seller1,
      ]);

      for (const member of [USERS.seller1, USERS.buyer1, USERS.buyer2]) {
        await setIdentity(c, member);
        expect((await c.query("select id from public.conversations where id = $1", [id])).rowCount).toBe(1);
        expect(
          (await c.query("select member_id from public.conversation_members where conversation_id = $1", [id]))
            .rowCount,
        ).toBe(3);
        expect((await c.query("select id from public.messages where conversation_id = $1", [id])).rowCount).toBe(1);
      }
    });
  });

  it("a member who is not in it sees nothing at all", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Tee off at nine')", [
        id,
        USERS.seller1,
      ]);

      await setIdentity(c, USERS.seller2);
      expectZeroRows(await c.query("select id from public.conversations where id = $1", [id]));
      expectZeroRows(
        await c.query("select member_id from public.conversation_members where conversation_id = $1", [id]),
      );
      expectZeroRows(await c.query("select id from public.messages where conversation_id = $1", [id]));
    });
  });

  it("staff see nothing either — the boundary is unchanged by groups", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'private')", [
        id,
        USERS.seller1,
      ]);

      for (const staff of [USERS.admin, USERS.moderator]) {
        await setIdentity(c, staff);
        expectZeroRows(await c.query("select id from public.conversations where id = $1", [id]));
        expectZeroRows(
          await c.query("select member_id from public.conversation_members where conversation_id = $1", [id]),
        );
        expectZeroRows(await c.query("select id from public.messages where conversation_id = $1", [id]));
      }
    });
  });

  it("anon sees nothing", async () => {
    const client = await pool.connect();
    let id: string;
    try {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [USERS.seller1]);
      await client.query("set local role authenticated");
      id = await makeGroup(client);

      await client.query("set local role anon");
      await client.query("select set_config('request.jwt.claim.sub', '', true)");
      expectZeroRows(await client.query("select id from public.conversations where id = $1", [id]));
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  });
});

describe("posting to a group", () => {
  it("a member can send", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await setIdentity(c, USERS.buyer2);
      const r = await c.query(
        "insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'See you there')",
        [id, USERS.buyer2],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("a non-member cannot", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await setIdentity(c, USERS.seller2);
      await expectRejected(
        c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'butting in')", [
          id,
          USERS.seller2,
        ]),
        /row-level security/i,
      );
    });
  });

  it("a member cannot post as somebody else", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await setIdentity(c, USERS.buyer1);
      await expectRejected(
        c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'spoofed')", [
          id,
          USERS.buyer2,
        ]),
        /row-level security/i,
      );
    });
  });

  it("a block taken out AFTER the group formed silences the blocked member", async () => {
    // The deliberate trade-off recorded in 0087's header. Blocking is absolute
    // today because every thread is two people, and preserving that is the
    // safer default: the alternative would mean someone you blocked precisely
    // so as not to hear from them could still appear in a room you are in.
    //
    // The cost is exactly what this test pins down — one member can silence
    // another in a shared group by blocking them. That errs toward whoever
    // pressed block.
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);

      await setIdentity(c, USERS.buyer2);
      expect(
        (
          await c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'before')", [
            id,
            USERS.buyer2,
          ])
        ).rowCount,
      ).toBe(1);

      await block(c, USERS.buyer1, USERS.buyer2);

      await setIdentity(c, USERS.buyer2);
      await expectRejected(
        c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'after')", [
          id,
          USERS.buyer2,
        ]),
        /row-level security/i,
      );
    });
  });

  it("and the members who did not block anyone are unaffected", async () => {
    // The blocked pair is buyer1/buyer2; seller1 blocked nobody and should
    // still be able to talk. Without this, a policy that silenced the whole
    // group on any block would pass the test above and be wrong.
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await block(c, USERS.buyer1, USERS.buyer2);

      await setIdentity(c, USERS.seller1);
      const r = await c.query(
        "insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'still here')",
        [id, USERS.seller1],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("add_conversation_member: who may put someone in a group", () => {
  it("the owner can add an eligible golfer", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await connect(c, USERS.seller1, [USERS.moderator]);
      await connect(c, USERS.buyer1, [USERS.moderator]);
      await connect(c, USERS.buyer2, [USERS.moderator]);

      await setIdentity(c, USERS.seller1);
      await c.query("select public.add_conversation_member($1, $2)", [id, USERS.moderator]);

      const members = await c.query("select member_id from public.conversation_members where conversation_id = $1", [id]);
      expect(members.rowCount).toBe(4);
    });
  });

  it("an ordinary member cannot", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await connect(c, USERS.buyer1, [USERS.moderator]);

      await setIdentity(c, USERS.buyer1);
      await expectRejected(
        c.query("select public.add_conversation_member($1, $2)", [id, USERS.moderator]),
        /only whoever started the group/i,
      );
    });
  });

  it("a complete stranger cannot", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await setIdentity(c, USERS.seller2);
      await expectRejected(
        c.query("select public.add_conversation_member($1, $2)", [id, USERS.seller2]),
        /only whoever started the group/i,
      );
    });
  });

  it("refuses somebody an existing member has blocked", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await connect(c, USERS.seller1, [USERS.moderator]);
      await block(c, USERS.buyer1, USERS.moderator);

      await setIdentity(c, USERS.seller1);
      await expectRejected(
        c.query("select public.add_conversation_member($1, $2)", [id, USERS.moderator]),
        /blocked them/i,
      );
    });
  });

  it("refuses somebody the owner cannot message", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await setIdentity(c, USERS.seller1);
      await expectRejected(
        c.query("select public.add_conversation_member($1, $2)", [id, USERS.seller2]),
        /connected with/i,
      );
    });
  });

  it("refuses to add anyone to a DIRECT conversation", async () => {
    // The fixture conversation is seller1 <-> buyer1. Turning a two-person
    // thread into a three-person one behind the other participant's back is
    // not something an owner concept even exists for here.
    await withRole("authenticated", USERS.seller1, async (c) => {
      await connect(c, USERS.seller1, [USERS.buyer2]);
      await expectRejected(
        c.query("select public.add_conversation_member($1, $2)", [ids.conversationId, USERS.buyer2]),
        /only be added to a group/i,
      );
    });
  });

  it("adding someone already in it is a no-op, not an error", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await setIdentity(c, USERS.seller1);
      await c.query("select public.add_conversation_member($1, $2)", [id, USERS.buyer1]);
      const members = await c.query("select member_id from public.conversation_members where conversation_id = $1", [id]);
      expect(members.rowCount).toBe(3);
    });
  });
});

describe("leaving, and renaming", () => {
  it("a member can leave a group, and then sees nothing of it", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'hello')", [
        id,
        USERS.seller1,
      ]);

      await setIdentity(c, USERS.buyer2);
      const left = await c.query(
        "delete from public.conversation_members where conversation_id = $1 and member_id = $2",
        [id, USERS.buyer2],
      );
      expect(left.rowCount).toBe(1);

      // Membership was the whole basis of access, so it goes with them.
      expectZeroRows(await c.query("select id from public.conversations where id = $1", [id]));
      expectZeroRows(await c.query("select id from public.messages where conversation_id = $1", [id]));
    });
  });

  it("a member cannot remove somebody else", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await setIdentity(c, USERS.buyer2);
      expectZeroRows(
        await c.query("delete from public.conversation_members where conversation_id = $1 and member_id = $2", [
          id,
          USERS.buyer1,
        ]),
      );
    });
  });

  it("the owner can rename the group", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await setIdentity(c, USERS.seller1);
      const r = await c.query("update public.conversations set title = $1 where id = $2", ["Sunday fourball", id]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("an ordinary member cannot rename it", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await setIdentity(c, USERS.buyer1);
      expectZeroRows(await c.query("update public.conversations set title = $1 where id = $2", ["Mine now", id]));
    });
  });

  it("even the owner may change nothing but the title", async () => {
    // prevent_conversation_tampering() is what still guards this — it is the
    // one path that CAN update a conversation now, so it is the one path that
    // still needs the trigger.
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await setIdentity(c, USERS.seller1);
      await expectRejected(
        c.query("update public.conversations set kind = 'direct' where id = $1", [id]),
        /only a group title/i,
      );
    });
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await setIdentity(c, USERS.seller1);
      await expectRejected(
        c.query("update public.conversations set last_message_at = now() where id = $1", [id]),
        /only a group title/i,
      );
    });
  });
});

describe("the rest of the system still works on a group", () => {
  it("a direct conversation still fills in its own member rows", async () => {
    // The trigger that lets startConversation(), /api/app/conversations and
    // linkConversationToOrder() carry on inserting a conversation exactly as
    // they always have. Without it every insert site would need to learn about
    // a second table, and one that forgot would create a thread its own
    // participants could not read.
    await withRole("authenticated", USERS.seller2, async (c) => {
      await c.query("update public.listings set sale_type = 'offers_allowed' where id = $1", [
        ids.listings.seller2Active,
      ]);
      await setIdentity(c, USERS.buyer2);
      await c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 90)", [
        ids.listings.seller2Active,
        USERS.buyer2,
      ]);

      await setIdentity(c, USERS.seller2);
      const { rows } = await c.query<{ id: string }>(
        "insert into public.conversations (user_a_id, user_b_id) values ($1, $2) returning id",
        [USERS.seller2, USERS.buyer2],
      );

      const members = await c.query<{ member_id: string }>(
        "select member_id from public.conversation_members where conversation_id = $1 order by member_id",
        [rows[0].id],
      );
      expect(members.rowCount).toBe(2);
      expect(members.rows.map((r) => r.member_id).sort()).toEqual(
        [USERS.seller2, USERS.buyer2].sort(),
      );
    });
  });

  it("starting a direct conversation still works WITH RETURNING", async () => {
    // This is the regression test for the bug that nearly shipped, and the
    // reason the SELECT policy on `conversations` keeps a pair clause.
    //
    // `insert ... returning` re-checks the SELECT policy against the new row,
    // and it does so BEFORE the statement's AFTER ROW triggers fire — so the
    // member rows the trigger is about to create do not exist yet. Postgres
    // reports that as "new row violates row-level security policy", which
    // reads exactly like a WITH CHECK failure and is not one.
    //
    // PostgREST issues RETURNING for every `.insert(...).select(...)`, which
    // is what startConversation() and /api/app/conversations both do. The
    // version of this test WITHOUT `returning id` passed while the app was
    // broken.
    await withRole("authenticated", USERS.seller2, async (c) => {
      await c.query("update public.listings set sale_type = 'offers_allowed' where id = $1", [
        ids.listings.seller2Active,
      ]);
      await setIdentity(c, USERS.buyer2);
      await c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 90)", [
        ids.listings.seller2Active,
        USERS.buyer2,
      ]);

      await setIdentity(c, USERS.seller2);
      const { rows } = await c.query<{ id: string }>(
        "insert into public.conversations (user_a_id, user_b_id) values ($1, $2) returning id",
        [USERS.seller2, USERS.buyer2],
      );
      expect(rows).toHaveLength(1);
    });
  });

  it("a client still cannot insert a group directly, bypassing the eligibility checks", async () => {
    // create_group_conversation() is the only door, and this is why it can be:
    // the shape check forces a group's pair columns to null, and the INSERT
    // policy needs one of them to be the caller. `null = uid` is null, so the
    // policy can never be satisfied for a group.
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("insert into public.conversations (kind, title) values ('group', 'Sneaky')"),
        /row-level security/i,
      );
    });
  });

  it("a group's unread messages count toward the badge like any other", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);

      await setIdentity(c, USERS.buyer1);
      const before = await c.query<{ message_count: string }>("select message_count from public.inbox_unread_counts()");

      await setIdentity(c, USERS.seller1);
      await c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'nine o clock')", [
        id,
        USERS.seller1,
      ]);

      await setIdentity(c, USERS.buyer1);
      const after = await c.query<{ message_count: string }>("select message_count from public.inbox_unread_counts()");
      expect(Number(after.rows[0].message_count)).toBe(Number(before.rows[0].message_count) + 1);

      // And the per-row pill agrees with it.
      const per = await c.query<{ unread_count: string }>(
        "select unread_count from public.conversation_unread_counts() where conversation_id = $1",
        [id],
      );
      expect(Number(per.rows[0].unread_count)).toBe(1);
    });
  });

  it("archiving a group takes it out of the badge, for that member only", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'nine o clock')", [
        id,
        USERS.seller1,
      ]);

      await setIdentity(c, USERS.buyer1);
      const before = await c.query<{ message_count: string }>("select message_count from public.inbox_unread_counts()");
      await c.query(
        "update public.conversation_members set archived_at = now() where conversation_id = $1 and member_id = $2",
        [id, USERS.buyer1],
      );
      const after = await c.query<{ message_count: string }>("select message_count from public.inbox_unread_counts()");
      expect(Number(after.rows[0].message_count)).toBe(Number(before.rows[0].message_count) - 1);

      // buyer2 archived nothing and still has it.
      await setIdentity(c, USERS.buyer2);
      const theirs = await c.query<{ message_count: string }>("select message_count from public.inbox_unread_counts()");
      expect(Number(theirs.rows[0].message_count)).toBeGreaterThan(0);
    });
  });

  it("a group photo is readable by its members and nobody else", async () => {
    // 0086's storage policy was written against the pair columns; 0087 points
    // it at membership instead. A group photo would be readable by nobody at
    // all if that had been missed — and nobody would report it as a security
    // bug, only as a broken picture.
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      const name = `${id}/group-photo.jpg`;

      await c.query("set local role service_role");
      await c.query("insert into storage.objects (bucket_id, name) values ('message-images', $1)", [name]);
      await c.query("set local role authenticated");

      for (const member of [USERS.seller1, USERS.buyer1, USERS.buyer2]) {
        await setIdentity(c, member);
        expect(
          (
            await c.query("select name from storage.objects where bucket_id = 'message-images' and name = $1", [name])
          ).rowCount,
        ).toBe(1);
      }

      await setIdentity(c, USERS.seller2);
      expectZeroRows(
        await c.query("select name from storage.objects where bucket_id = 'message-images' and name = $1", [name]),
      );
    });
  });

  it("a group's messages are searchable by its members and nobody else", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const id = await makeGroup(c);
      await c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'bring waterproofs')", [
        id,
        USERS.seller1,
      ]);

      await setIdentity(c, USERS.buyer1);
      expect((await c.query("select id from public.search_my_messages('waterproofs')")).rowCount).toBe(1);

      await setIdentity(c, USERS.seller2);
      expectZeroRows(await c.query("select id from public.search_my_messages('waterproofs')"));
    });
  });
});
