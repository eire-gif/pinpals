// Rule 4 ("Only conversation members may read or insert messages in that
// conversation"). Deliberately does NOT test any staff bypass for message
// content — conversations/messages have none on purpose (see 0025's header
// comment): the only staff access to message content is the audited,
// reason-required /admin/reports/[id] Server Action, which this migration
// phase leaves untouched. Adding an is_staff() read bypass here would be
// WEAKENING an existing, deliberate privacy boundary, not hardening it.
import { describe, it, expect, afterAll } from "vitest";
import { withRole, setIdentity, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

describe("conversations/messages: SELECT (rule 4)", () => {
  it("a participant can read their own conversation and its messages", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const conv = await c.query("select id from public.conversations where id = $1", [ids.conversationId]);
      expect(conv.rowCount).toBe(1);
      const msg = await c.query("select id from public.messages where id = $1", [ids.messageId]);
      expect(msg.rowCount).toBe(1);
    });
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const conv = await c.query("select id from public.conversations where id = $1", [ids.conversationId]);
      expect(conv.rowCount).toBe(1);
    });
  });

  it("a non-participant cannot read the conversation or its messages", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const conv = await c.query("select id from public.conversations where id = $1", [ids.conversationId]);
      expect(conv.rowCount).toBe(0);
      const msg = await c.query("select id from public.messages where id = $1", [ids.messageId]);
      expect(msg.rowCount).toBe(0);
    });
  });

  it("anon cannot read any conversation or message", async () => {
    await withRole("anon", null, async (c) => {
      const conv = await c.query("select id from public.conversations where id = $1", [ids.conversationId]);
      expect(conv.rowCount).toBe(0);
    });
  });

  it("staff have NO special read access to conversations/messages (deliberate, unchanged boundary)", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      const conv = await c.query("select id from public.conversations where id = $1", [ids.conversationId]);
      expect(conv.rowCount).toBe(0);
      const msg = await c.query("select id from public.messages where id = $1", [ids.messageId]);
      expect(msg.rowCount).toBe(0);
    });
  });
});

describe("conversations: INSERT (only between two eligible, can_message() users)", () => {
  it("two users with a legitimate reason to talk (an offer between them) can start a conversation", async () => {
    // seller1<->buyer1 already have a fixture conversation, and
    // conversations are unique per unordered pair (0025's
    // conversations_member_pair_idx), so this test establishes a fresh
    // eligible pair instead: buyer2 makes an offer on seller2's listing
    // (satisfying can_message()'s offer-relationship clause), then seller2
    // starts the conversation — all in one transaction so the uncommitted
    // offer is visible to the insert policy's can_message() check.
    await withRole("authenticated", USERS.seller2, async (c) => {
      // seller2Active is fixed_price by default in the fixture (0048's
      // prepare_and_validate_offer() now requires offers_allowed) — flip it
      // first, as its own seller, same as auctions-and-bids.test.ts does for
      // its own auction fixtures.
      await c.query("update public.listings set sale_type = 'offers_allowed' where id = $1", [
        ids.listings.seller2Active,
      ]);

      await setIdentity(c, USERS.buyer2);
      await c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 90)", [
        ids.listings.seller2Active,
        USERS.buyer2,
      ]);

      await setIdentity(c, USERS.seller2);
      const r = await c.query("insert into public.conversations (user_a_id, user_b_id) values ($1, $2)", [
        USERS.seller2,
        USERS.buyer2,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("two users with no eligible relationship cannot start a conversation", async () => {
    await withRole("authenticated", USERS.seller2, async (c) => {
      await expectRejected(
        c.query("insert into public.conversations (user_a_id, user_b_id) values ($1, $2)", [
          USERS.seller2,
          USERS.buyer2,
        ]),
      );
    });
  });

  it("a user cannot start a conversation they are not a party to", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await expectRejected(
        c.query("insert into public.conversations (user_a_id, user_b_id) values ($1, $2)", [
          USERS.seller1,
          USERS.buyer1,
        ]),
      );
    });
  });

  it("anon cannot start a conversation", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("insert into public.conversations (user_a_id, user_b_id) values ($1, $2)", [
          USERS.seller1,
          USERS.buyer1,
        ]),
      );
    });
  });
});

describe("messages: INSERT (only a participant, in their own conversation)", () => {
  it("a participant can send a message in their own conversation", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query(
        "insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Yes, still available.')",
        [ids.conversationId, USERS.seller1],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("a non-participant cannot send a message into someone else's conversation", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await expectRejected(
        c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'butting in')", [
          ids.conversationId,
          USERS.buyer2,
        ]),
      );
    });
  });

  it("a participant cannot send a message impersonating the other participant as sender", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'spoofed')", [
          ids.conversationId,
          USERS.buyer1,
        ]),
      );
    });
  });

  it("anon cannot send a message", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'anon')", [
          ids.conversationId,
          USERS.seller1,
        ]),
      );
    });
  });
});

describe("messages: UPDATE/DELETE (no client-writable path at all)", () => {
  it("not even the sender can edit or delete their own message", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("update public.messages set body = 'edited' where id = $1", [ids.messageId]),
        /permission denied/,
      );
    });
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("delete from public.messages where id = $1", [ids.messageId]),
        /permission denied/,
      );
    });
  });
});
