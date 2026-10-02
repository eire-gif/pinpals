// 0083_unified_inbox.sql — the two functions every surface now counts with.
//
// These are SECURITY INVOKER, which is the whole reason they are safe: they
// aggregate over rows the caller's own policies already let them read, and
// write only to columns those policies (and 0045/0049's tampering triggers)
// already let them write. The tests that matter most here are therefore the
// negative ones — that a member's numbers never include anyone else's rows,
// and that clearing their inbox never touches anyone else's.
//
// Two habits worth keeping if you extend this file:
//
//   Seed and assert inside ONE withRole() transaction. The harness always
//   rolls back, so a beforeAll seed would be gone by the time a test ran.
//
//   Assert on the CHANGE, not on an absolute alert count. The fixture's
//   offers and bids fire notify_user() through their own triggers, so
//   seller1 starts with three alerts rather than the one fixtures.ts inserts
//   by hand — and a test pinned to "1" would break the next time somebody
//   adds an offer to the fixture for an unrelated reason.
import type { PoolClient } from "pg";
import { describe, it, expect, afterAll } from "vitest";
import { withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

type CountsRow = { message_count: string; alert_count: string };
type ReadAtRow = { read_at: string | null };
/** 0087 moved read state onto conversation_members — one row per member
 *  with that member's own cursor, instead of four columns on the
 *  conversation and a "which side am I" CASE around every read of them. */
type CursorRow = { member_id: string; last_read_at: string | null };

const MY_CURSOR =
  "update public.conversation_members set last_read_at = now() where conversation_id = $1 and member_id = $2";
const MY_ARCHIVE =
  "update public.conversation_members set archived_at = now() where conversation_id = $1 and member_id = $2";
const CURSORS =
  "select member_id, last_read_at from public.conversation_members where conversation_id = $1 order by member_id";

/** The badge, as the caller's own RLS sees it. bigint comes back from pg as a
 *  string — Number() here rather than at every call site. */
async function counts(c: PoolClient): Promise<{ messages: number; alerts: number }> {
  const { rows } = await c.query<CountsRow>("select * from public.inbox_unread_counts()");
  return {
    messages: Number(rows[0].message_count),
    alerts: Number(rows[0].alert_count),
  };
}

describe("inbox_unread_counts(): what a member's badge is made of", () => {
  it("counts the other side's unread messages, and the caller's unread alerts", async () => {
    // Fixture: one conversation seller1 <-> buyer1, a single message from
    // buyer1, no read cursor — plus alerts from the offers on seller1's
    // listings.
    await withRole("authenticated", USERS.seller1, async (c) => {
      const { messages, alerts } = await counts(c);
      expect(messages).toBe(1);
      expect(alerts).toBeGreaterThan(0);
    });
  });

  it("never counts a member's own messages against them", async () => {
    // buyer1 sent the only message in that conversation.
    await withRole("authenticated", USERS.buyer1, async (c) => {
      expect((await counts(c)).messages).toBe(0);
    });
  });

  it("returns a row of zeroes for a member with neither, rather than no row", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      expect(await counts(c)).toEqual({ messages: 0, alerts: 0 });
    });
  });

  it("stops counting messages once the caller's read cursor passes them", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query(MY_CURSOR, [ids.conversationId, USERS.seller1]);
      expect((await counts(c)).messages).toBe(0);
    });
  });

  it("leaves archived conversations out of the number", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query(MY_ARCHIVE, [ids.conversationId, USERS.seller1]);
      expect((await counts(c)).messages).toBe(0);
    });
  });

  it("does not count new_message alerts — the conversation already is the row", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const before = (await counts(c)).alerts;

      await c.query("set local role service_role");
      await c.query(
        `insert into public.notifications (user_id, type, title, body, data)
         values ($1, 'new_message', 'New message', 'Brian sent you a message', '{}'::jsonb)`,
        [USERS.seller1],
      );
      await c.query("set local role authenticated");

      expect((await counts(c)).alerts).toBe(before);
    });
  });

  it("does count a real alert", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const before = (await counts(c)).alerts;

      await c.query("set local role service_role");
      await c.query(
        `insert into public.notifications (user_id, type, title, body, data)
         values ($1, 'auction_won', 'You won', 'Lot 4', '{}'::jsonb)`,
        [USERS.seller1],
      );
      await c.query("set local role authenticated");

      expect((await counts(c)).alerts).toBe(before + 1);
    });
  });

  it("never leaks another member's alerts into the caller's count", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await c.query("set local role service_role");
      await c.query(
        `insert into public.notifications (user_id, type, title, body, data)
         values ($1, 'auction_won', 'Not yours', 'Lot 9', '{}'::jsonb)`,
        [USERS.seller1],
      );
      await c.query("set local role authenticated");

      expect(await counts(c)).toEqual({ messages: 0, alerts: 0 });
    });
  });

  it("is unreachable from a signed-out browser", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("select * from public.inbox_unread_counts()"),
        /permission denied/,
      );
    });
  });
});

describe("mark_inbox_read(): clearing it", () => {
  it("takes both numbers to zero in one call", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const before = await counts(c);
      expect(before.messages + before.alerts).toBeGreaterThan(0);

      await c.query("select public.mark_inbox_read()");

      expect(await counts(c)).toEqual({ messages: 0, alerts: 0 });
    });
  });

  it("marks read without deleting anything", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query("select public.mark_inbox_read()");

      const alerts = await c.query<ReadAtRow>("select read_at from public.notifications where id = $1", [ids.notificationId]);
      expect(alerts.rows).toHaveLength(1);
      expect(alerts.rows[0].read_at).not.toBeNull();

      const messages = await c.query("select id from public.messages where id = $1", [ids.messageId]);
      expect(messages.rowCount).toBe(1);
    });
  });

  it("clears delivery-only new_message rows too, so none is left permanently unread", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query("set local role service_role");
      const inserted = await c.query<{ id: string }>(
        `insert into public.notifications (user_id, type, title, body, data)
         values ($1, 'new_message', 'New message', 'Brian sent you a message', '{}'::jsonb)
         returning id`,
        [USERS.seller1],
      );
      await c.query("set local role authenticated");

      await c.query("select public.mark_inbox_read()");

      const after = await c.query<ReadAtRow>("select read_at from public.notifications where id = $1", [inserted.rows[0].id]);
      expect(after.rows[0].read_at).not.toBeNull();
    });
  });

  it("leaves an archived thread's cursor alone — the member already dealt with it", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query(MY_ARCHIVE, [ids.conversationId, USERS.seller1]);
      await c.query("select public.mark_inbox_read()");

      const { rows } = await c.query<CursorRow>(
        "select member_id, last_read_at from public.conversation_members where conversation_id = $1 and member_id = $2",
        [ids.conversationId, USERS.seller1],
      );
      expect(rows[0].last_read_at).toBeNull();
    });
  });

  it("moves only the caller's own cursor, never the other participant's", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query("select public.mark_inbox_read()");

      // Read back as the service role: a member can see their own member row
      // but the point of this test is the OTHER member's, which their own RLS
      // correctly hides.
      await c.query("set local role service_role");
      const { rows } = await c.query<CursorRow>(CURSORS, [ids.conversationId]);
      const mine = rows.find((r) => r.member_id === USERS.seller1);
      const theirs = rows.find((r) => r.member_id === USERS.buyer1);
      expect(mine?.last_read_at).not.toBeNull();
      expect(theirs?.last_read_at).toBeNull();
    });
  });

  it("a stranger calling it cannot touch someone else's rows", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await c.query("select public.mark_inbox_read()");

      // Read back as the service role, because buyer2 cannot see either row.
      await c.query("set local role service_role");

      const alert = await c.query<ReadAtRow>("select read_at from public.notifications where id = $1", [ids.notificationId]);
      expect(alert.rows[0].read_at).toBeNull();

      const conv = await c.query<CursorRow>(CURSORS, [ids.conversationId]);
      expect(conv.rows).toHaveLength(2);
      for (const row of conv.rows) expect(row.last_read_at).toBeNull();
    });
  });

  it("is unreachable from a signed-out browser", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("select public.mark_inbox_read()"),
        /permission denied/,
      );
    });
  });
});
