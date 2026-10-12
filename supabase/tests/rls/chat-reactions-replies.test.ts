// 0130_chat_reactions_replies.sql — reactions, replies, reply privately,
// delete for me / for everyone, and the typing topic.
//
// Fixture: seller1 <-> buyer1 have a direct thread (ids.conversationId) with
// one message from buyer1. buyer2 and seller2 are outsiders to it.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, setIdentity, expectRejected, closePool, pool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();
afterAll(closePool);

/** expectRejected inside a savepoint, so the test can carry on afterwards. */
async function refused(c: PoolClient, run: () => Promise<unknown>, pattern?: RegExp): Promise<void> {
  await c.query("savepoint r");
  await expectRejected(run(), pattern);
  await c.query("rollback to savepoint r");
}

async function asService<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

async function connect(c: PoolClient, a: string, b: string): Promise<void> {
  await asService(c, () =>
    c.query(
      `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
      [a, b],
    ),
  );
}

async function send(c: PoolClient, conversationId: string, body: string, replyTo: string | null = null): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into public.messages (conversation_id, sender_id, body, reply_to_id)
     values ($1, (select auth.uid()), $2, $3) returning id`,
    [conversationId, body, replyTo],
  );
  return rows[0].id;
}

/** seller1 starts a group with buyer1 and buyer2; buyer1 and buyer2 are NOT
 *  connected to each other, which is the "Reply privately" case. */
async function makeGroup(c: PoolClient): Promise<string> {
  await connect(c, USERS.seller1, USERS.buyer1);
  await connect(c, USERS.seller1, USERS.buyer2);
  await setIdentity(c, USERS.seller1);
  const { rows } = await c.query<{ id: string }>(
    "select public.create_group_conversation('Saturday fourball', $1::uuid[]) as id",
    [[USERS.buyer1, USERS.buyer2]],
  );
  return rows[0].id;
}

describe("reactions", () => {
  it("a member sets, changes and takes off one reaction; others in the thread see it", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const msg = await send(c, ids.conversationId, "Still for sale?");
      const set = await c.query("select public.react_to_message($1, '👍') as e", [msg]);
      expect(set.rows[0].e).toBe("👍");
      const changed = await c.query("select public.react_to_message($1, '⛳') as e", [msg]);
      expect(changed.rows[0].e).toBe("⛳");

      await setIdentity(c, USERS.buyer1);
      const seen = await c.query("select member_id, emoji from public.message_reactions where message_id = $1", [msg]);
      expect(seen.rows).toEqual([{ member_id: USERS.seller1, emoji: "⛳" }]);

      await setIdentity(c, USERS.seller1);
      const off = await c.query("select public.react_to_message($1, '⛳') as e", [msg]);
      expect(off.rows[0].e).toBeNull();
      const none = await c.query("select 1 from public.message_reactions where message_id = $1", [msg]);
      expect(none.rowCount).toBe(0);
    });
  });

  it("an outsider can neither react nor see reactions", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const msg = await send(c, ids.conversationId, "Hello");
      await c.query("select public.react_to_message($1, '❤️')", [msg]);
      await setIdentity(c, USERS.buyer2);
      await refused(c, () => c.query("select public.react_to_message($1, '👍')", [msg]), /isn't available/);
      const seen = await c.query("select 1 from public.message_reactions where message_id = $1", [msg]);
      expect(seen.rowCount).toBe(0);
    });
  });

  it("refuses text that isn't an emoji, and direct writes to the table", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const msg = await send(c, ids.conversationId, "Hello");
      await refused(c, () => c.query("select public.react_to_message($1, 'lol')", [msg]), /Choose an emoji/);
      await refused(c, () => c.query("select public.react_to_message($1, 'привет')", [msg]), /Choose an emoji/);
      // A ZWJ sequence is one emoji.
      const zwj = await c.query("select public.react_to_message($1, '🏌️‍♀️') as e", [msg]);
      expect(zwj.rows[0].e).toBe("🏌️‍♀️");
      await refused(c, () => c.query(
          "insert into public.message_reactions (message_id, member_id, conversation_id, emoji) values ($1, $2, $3, '👍')",
          [msg, USERS.seller1, ids.conversationId],
        ));
    });
  });

  it("is refused while someone in the thread is blocked", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const msg = await send(c, ids.conversationId, "Hello");
      await asService(c, () =>
        c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [USERS.buyer1, USERS.seller1]),
      );
      await refused(c, () => c.query("select public.react_to_message($1, '👍')", [msg]), /can't react/);
    });
  });
});

describe("replies", () => {
  it("snapshots the quoted message from the database, ignoring anything the client sent", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const original = await send(c, ids.conversationId, "Driver is €120");
      await setIdentity(c, USERS.buyer1);
      const { rows } = await c.query<{ id: string; reply_snapshot: Record<string, unknown>; deleted_at: string | null }>(
        `insert into public.messages (conversation_id, sender_id, body, reply_to_id, reply_snapshot, deleted_at)
         values ($1, $2, 'Would you take €100?', $3, '{"body":"forged"}', now())
         returning id, reply_snapshot, deleted_at`,
        [ids.conversationId, USERS.buyer1, original],
      );
      expect(rows[0].deleted_at).toBeNull();
      expect(rows[0].reply_snapshot).toEqual({ sender_id: USERS.seller1, body: "Driver is €120", photo: false, group: null });
    });
  });

  it("refuses to quote a message from a conversation the sender can't read", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const group = await makeGroup(c);
      const inGroup = await send(c, group, "Tee at 9");
      // seller2 is in neither; give them a thread with seller1 to try from.
      await connect(c, USERS.seller1, USERS.seller2);
      await setIdentity(c, USERS.seller2);
      const { rows } = await c.query<{ id: string }>(
        "insert into public.conversations (user_a_id, user_b_id) values ($1, $2) returning id",
        [USERS.seller1, USERS.seller2].sort(),
      );
      await refused(c, () => send(c, rows[0].id, "Saw this", inGroup), /can't be replied to/);
    });
  });

  it("reply privately: opens a direct thread with the message's author, and quotes the group message", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const group = await makeGroup(c);
      await setIdentity(c, USERS.buyer2);
      const inGroup = await send(c, group, "Anyone got a spare putter?");

      // buyer1 and buyer2 aren't connected, and sharing a group does NOT
      // make them so — can_message() is unchanged (no chaining through
      // group invitations).
      await setIdentity(c, USERS.buyer1);
      const ok = await c.query("select public.can_message($1, $2) as ok", [USERS.buyer1, USERS.buyer2]);
      expect(ok.rows[0].ok).toBe(false);

      const direct = await c.query<{ id: string }>("select public.start_private_reply($1) as id", [inGroup]);
      const again = await c.query<{ id: string }>("select public.start_private_reply($1) as id", [inGroup]);
      expect(again.rows[0].id).toBe(direct.rows[0].id);

      const reply = await send(c, direct.rows[0].id, "I have one, €40", inGroup);
      const snap = await c.query("select reply_snapshot from public.messages where id = $1", [reply]);
      expect(snap.rows[0].reply_snapshot).toMatchObject({ sender_id: USERS.buyer2, group: "Saturday fourball" });

      // Not into a third person's thread.
      await refused(c, () => send(c, ids.conversationId, "Look", inGroup), /can't be replied to/);
    });
  });

  it("reply privately is refused for your own message, an outsider, or an author who has left", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const group = await makeGroup(c);
      await setIdentity(c, USERS.buyer2);
      const inGroup = await send(c, group, "Tee at 9");
      await refused(c, () => c.query("select public.start_private_reply($1)", [inGroup]), /can't reply privately/);

      await setIdentity(c, USERS.seller2);
      await refused(c, () => c.query("select public.start_private_reply($1)", [inGroup]), /can't reply privately/);

      await setIdentity(c, USERS.buyer2);
      await c.query("delete from public.conversation_members where conversation_id = $1 and member_id = $2", [group, USERS.buyer2]);
      await setIdentity(c, USERS.buyer1);
      await refused(c, () => c.query("select public.start_private_reply($1)", [inGroup]), /can't reply privately/);
    });
  });

  it("is refused between members who have blocked each other", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const group = await makeGroup(c);
      await setIdentity(c, USERS.buyer2);
      const inGroup = await send(c, group, "Hi all");
      await asService(c, () =>
        c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [USERS.buyer2, USERS.buyer1]),
      );
      await setIdentity(c, USERS.buyer1);
      await refused(c, () => c.query("select public.start_private_reply($1)", [inGroup]), /can't message/);
    });
  });

  it("a deleted original turns its quotes into 'deleted', with the words gone", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const original = await send(c, ids.conversationId, "My number is 087 000 0000");
      await setIdentity(c, USERS.buyer1);
      const reply = await send(c, ids.conversationId, "Thanks", original);
      await setIdentity(c, USERS.seller1);
      await c.query("select public.delete_message_for_everyone($1)", [original]);
      const snap = await c.query("select reply_snapshot from public.messages where id = $1", [reply]);
      expect(snap.rows[0].reply_snapshot).toEqual({ deleted: true });
      await refused(c, () => send(c, ids.conversationId, "again", original), /can't be replied to/);
    });
  });
});

describe("delete for everyone", () => {
  it("blanks the sender's own message, keeps the row, and archives the original away from members", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const msg = await send(c, ids.conversationId, "Oops wrong chat");
      await c.query("select public.react_to_message($1, '😂')", [msg]);
      await c.query("select public.delete_message_for_everyone($1)", [msg]);

      await setIdentity(c, USERS.buyer1);
      const row = await c.query("select body, image_path, deleted_at from public.messages where id = $1", [msg]);
      expect(row.rows[0].body).toBe("This message was deleted");
      expect(row.rows[0].deleted_at).not.toBeNull();
      const reactions = await c.query("select 1 from public.message_reactions where message_id = $1", [msg]);
      expect(reactions.rowCount).toBe(0);
      await refused(c, () => c.query("select body from public.message_deletions"), /permission denied/);

      await asService(c, async () => {
        const archived = await c.query("select body from public.message_deletions where message_id = $1", [msg]);
        expect(archived.rows[0].body).toBe("Oops wrong chat");
      });
    });
  });

  it("refuses someone else's message, and one older than 48 hours", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await refused(c, () => c.query("select public.delete_message_for_everyone($1)", [ids.messageId]), /your own messages/);
      const old = await send(c, ids.conversationId, "Last week");
      await asService(c, () => c.query("update public.messages set created_at = now() - interval '3 days' where id = $1", [old]));
      await refused(c, () => c.query("select public.delete_message_for_everyone($1)", [old]), /48 hours/);
    });
  });

  it("members still can't update or delete messages directly", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const msg = await send(c, ids.conversationId, "Mine");
      await refused(c, () => c.query("update public.messages set body = 'edited' where id = $1", [msg]));
      await refused(c, () => c.query("delete from public.messages where id = $1", [msg]));
    });
  });
});

describe("mark_conversation_read", () => {
  it("moves only my own cursor, on the server's clock", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query("select public.mark_conversation_read($1)", [ids.conversationId]);
      const rows = await c.query<{ member_id: string; fresh: boolean }>(
        "select member_id, last_read_at is not distinct from now() as fresh from public.conversation_members where conversation_id = $1",
        [ids.conversationId],
      );
      expect(rows.rows.find((r) => r.member_id === USERS.seller1)?.fresh).toBe(true);
      expect(rows.rows.find((r) => r.member_id === USERS.buyer1)?.fresh).toBe(false);
    });
  });
});

describe("delete for me", () => {
  it("hides a message from your own copy only", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query("select public.hide_message_for_me($1)", [ids.messageId]);
      const mine = await c.query("select message_id from public.message_hides");
      expect(mine.rows.map((r) => String(r.message_id))).toEqual([String(ids.messageId)]);
      await setIdentity(c, USERS.buyer1);
      const theirs = await c.query("select 1 from public.message_hides");
      expect(theirs.rowCount).toBe(0);
      await setIdentity(c, USERS.buyer2);
      await refused(c, () => c.query("select public.hide_message_for_me($1)", [ids.messageId]), /isn't available/);
    });
  });
});

describe("typing topic", () => {
  async function canPublish(userId: string, topic: string): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await client.query("set local role authenticated");
      await client.query("savepoint s");
      try {
        await client.query(
          "insert into realtime.messages (topic, extension, event, private, payload) values ($1, 'broadcast', 'typing', true, '{}')",
          [topic],
        );
        return true;
      } catch {
        await client.query("rollback to savepoint s");
        return false;
      }
    } finally {
      await client.query("rollback");
      client.release();
    }
  }

  it("members publish on typing-<id> only; never on conversation-<id> or someone else's thread", async () => {
    expect(await canPublish(USERS.seller1, `typing-${ids.conversationId}`)).toBe(true);
    expect(await canPublish(USERS.buyer2, `typing-${ids.conversationId}`)).toBe(false);
    expect(await canPublish(USERS.seller1, `conversation-${ids.conversationId}`)).toBe(false);
    expect(await canPublish(USERS.seller1, `inbox-${USERS.seller1}`)).toBe(false);
  });
});
