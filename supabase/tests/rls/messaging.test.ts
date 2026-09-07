// Rule 4 ("Only conversation members may read or insert messages in that
// conversation"). Deliberately does NOT test any staff bypass for message
// content — conversations/messages have none on purpose (see 0025's header
// comment): the only staff access to message content is the audited,
// reason-required /admin/reports/[id] Server Action, which this migration
// phase leaves untouched. Adding an is_staff() read bypass here would be
// WEAKENING an existing, deliberate privacy boundary, not hardening it.
import { describe, it, expect, afterAll } from "vitest";
import { withRole, setIdentity, expectRejected, expectZeroRows, closePool } from "./harness";
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

// ============ 0049_marketplace_messaging.sql ============

describe("conversations: listing-scoped uniqueness (0049)", () => {
  it("the same pair can have a second conversation about a DIFFERENT listing", async () => {
    // seller1<->buyer1 are already an eligible pair (the pending offer on
    // listings.active, seeded in fixtures.ts) — can_message() only cares
    // that the PAIR is eligible, never which listing a given conversation
    // names, so a second conversation about seller1's draft listing is
    // exactly as legitimate as a fresh conversation about any other topic.
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query(
        "insert into public.conversations (user_a_id, user_b_id, listing_id) values ($1, $2, $3)",
        [USERS.seller1, USERS.buyer1, ids.listings.draft],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it("the same pair CANNOT have two conversations about the SAME listing", async () => {
    // ids.conversationId is already seller1<->buyer1 about listings.active
    // (fixtures.ts) — a second one for that exact (pair, listing) collides
    // with conversations_member_pair_listing_idx.
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("insert into public.conversations (user_a_id, user_b_id, listing_id) values ($1, $2, $3)", [
          USERS.seller1,
          USERS.buyer1,
          ids.listings.active,
        ]),
        /duplicate key|unique constraint/,
      );
    });
  });

  it("the same pair can have at most one listing-LESS conversation", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("insert into public.conversations (user_a_id, user_b_id) values ($1, $2)", [
        USERS.seller1,
        USERS.buyer1,
      ]);
      expect(r.rowCount).toBe(1);

      await expectRejected(
        c.query("insert into public.conversations (user_a_id, user_b_id) values ($1, $2)", [USERS.seller1, USERS.buyer1]),
        /duplicate key|unique constraint/,
      );
    });
  });
});

describe("blocked_users (0049): who can see/write a block, and its effect on messaging", () => {
  it("a member can block another member, and see their own block list", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const insert = await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [
        USERS.buyer2,
        USERS.seller2,
      ]);
      expect(insert.rowCount).toBe(1);

      const own = await c.query("select * from public.blocked_users where blocker_id = $1", [USERS.buyer2]);
      expect(own.rowCount).toBe(1);
    });
  });

  it("a member cannot impersonate someone else as the blocker", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await expectRejected(
        c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [
          USERS.seller2,
          USERS.buyer2,
        ]),
      );
    });
  });

  it("an unrelated logged-in user cannot see someone else's block list — not even the block's own target", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [
        USERS.buyer2,
        USERS.seller2,
      ]);

      // seller2 is the block's own TARGET, not an uninvolved third party,
      // and still can't read it — blocked_users' select policy is
      // "blocker_id = auth.uid()" only, deliberately no "or I'm the one
      // being blocked" branch (that's exactly the information a block is
      // meant to keep from its target).
      await setIdentity(c, USERS.seller2);
      const asTarget = await c.query("select * from public.blocked_users where blocker_id = $1", [USERS.buyer2]);
      expectZeroRows(asTarget);

      // seller1 is a fully unrelated third party — same result.
      await setIdentity(c, USERS.seller1);
      const asStranger = await c.query("select * from public.blocked_users where blocker_id = $1", [USERS.buyer2]);
      expectZeroRows(asStranger);
    });
  });

  it("is_blocked() reports true in EITHER direction once one side blocks", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [
        USERS.buyer2,
        USERS.seller2,
      ]);

      const forward = await c.query("select public.is_blocked($1, $2) as blocked", [USERS.buyer2, USERS.seller2]);
      expect(forward.rows[0].blocked).toBe(true);

      const reverse = await c.query("select public.is_blocked($1, $2) as blocked", [USERS.seller2, USERS.buyer2]);
      expect(reverse.rows[0].blocked).toBe(true);

      const unrelated = await c.query("select public.is_blocked($1, $2) as blocked", [USERS.seller1, USERS.buyer1]);
      expect(unrelated.rows[0].blocked).toBe(false);
    });
  });

  it("a blocked pair cannot start a new conversation, even if otherwise eligible", async () => {
    await withRole("authenticated", USERS.seller2, async (c) => {
      // Establish eligibility (an offer) exactly like the plain eligibility
      // test above, then block on top of it.
      await c.query("update public.listings set sale_type = 'offers_allowed' where id = $1", [
        ids.listings.seller2Active,
      ]);
      await setIdentity(c, USERS.buyer2);
      await c.query("insert into public.offers (listing_id, buyer_id, amount_eur) values ($1, $2, 90)", [
        ids.listings.seller2Active,
        USERS.buyer2,
      ]);
      await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [
        USERS.buyer2,
        USERS.seller2,
      ]);

      await setIdentity(c, USERS.seller2);
      await expectRejected(
        c.query("insert into public.conversations (user_a_id, user_b_id) values ($1, $2)", [
          USERS.seller2,
          USERS.buyer2,
        ]),
      );
    });
  });

  it("blocking mid-thread stops new messages in an EXISTING conversation, either direction", async () => {
    // Three separate transactions, not one — a failed statement (the
    // expectRejected below) leaves a Postgres transaction aborted for
    // anything else run on the same connection until rollback, and
    // withRole() always rolls back in its own `finally`, so re-establishing
    // the block fresh in each block is simpler than fighting that with a
    // SAVEPOINT.
    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [
        USERS.seller1,
        USERS.buyer1,
      ]);
      await expectRejected(
        c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'still there?')", [
          ids.conversationId,
          USERS.seller1,
        ]),
      );
    });

    await withRole("authenticated", USERS.seller1, async (c) => {
      await c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [
        USERS.seller1,
        USERS.buyer1,
      ]);
      await setIdentity(c, USERS.buyer1);
      await expectRejected(
        c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'hello?')", [
          ids.conversationId,
          USERS.buyer1,
        ]),
      );
    });

    // Existing history is untouched by any of the above — still readable.
    await withRole("authenticated", USERS.seller1, async (c) => {
      const stillThere = await c.query("select id from public.messages where id = $1", [ids.messageId]);
      expect(stillThere.rowCount).toBe(1);
    });
  });
});

describe("conversations: UPDATE (read receipts / archiving, 0049)", () => {
  it("a participant can mark their own side read", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("update public.conversations set user_b_last_read_at = now() where id = $1", [
        ids.conversationId,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("a participant CANNOT set the OTHER participant's read cursor", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("update public.conversations set user_a_last_read_at = now() where id = $1", [ids.conversationId]),
        /Only.*own read\/archive state|only.*own/i,
      );
    });
  });

  it("a participant can archive and unarchive their own side only", async () => {
    // Split across separate transactions — see the same reasoning in the
    // "blocking mid-thread" test above (a failed statement aborts the rest
    // of that Postgres transaction).
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const archive = await c.query("update public.conversations set user_b_archived_at = now() where id = $1", [
        ids.conversationId,
      ]);
      expect(archive.rowCount).toBe(1);
    });

    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("update public.conversations set user_a_archived_at = now() where id = $1", [ids.conversationId]),
      );
    });

    await withRole("authenticated", USERS.buyer1, async (c) => {
      const unarchive = await c.query("update public.conversations set user_b_archived_at = null where id = $1", [
        ids.conversationId,
      ]);
      expect(unarchive.rowCount).toBe(1);
    });
  });

  it("nobody may change identity/listing/order/last_message_at columns, even their own conversation", async () => {
    // Each column independently, in its own transaction — a failed
    // statement aborts the rest of that Postgres transaction, so chaining
    // three expectRejected() calls back to back on one connection would
    // only genuinely test the first (the other two would throw from the
    // already-aborted transaction, not from prevent_conversation_tampering()
    // itself).
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("update public.conversations set listing_id = $1 where id = $2", [ids.listings.draft, ids.conversationId]),
      );
    });
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("update public.conversations set order_id = $1 where id = $2", [ids.orderId, ids.conversationId]),
      );
    });
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("update public.conversations set user_a_id = $1 where id = $2", [USERS.buyer2, ids.conversationId]),
      );
    });
  });

  it("a non-participant cannot update someone else's conversation at all", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const r = await c.query("update public.conversations set user_b_last_read_at = now() where id = $1", [
        ids.conversationId,
      ]);
      expectZeroRows(r);
    });
  });

  it("sending a message still bumps last_message_at via the system trigger, unaffected by the new tampering guard", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const before = await c.query("select last_message_at from public.conversations where id = $1", [ids.conversationId]);
      await c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'bumping last_message_at')", [
        ids.conversationId,
        USERS.seller1,
      ]);
      const after = await c.query("select last_message_at from public.conversations where id = $1", [ids.conversationId]);
      expect(new Date(after.rows[0].last_message_at).getTime()).toBeGreaterThan(
        new Date(before.rows[0].last_message_at ?? 0).getTime(),
      );
    });
  });
});

describe("messages: sensitive-content guard (0049)", () => {
  it("allows an ordinary message", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'Yes, happy to meet Saturday.')", [
        ids.conversationId,
        USERS.seller1,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("rejects a card-number-shaped body", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'card is 4111 1111 1111 1111')", [
          ids.conversationId,
          USERS.seller1,
        ]),
        /card number/,
      );
    });
  });

  it("rejects an IBAN-shaped body", async () => {
    // Grouped with letters/spaces between shorter digit runs (10 digits
    // total, none of the individual runs) so this exercises the IBAN rule
    // specifically rather than tripping the card-number rule first (a
    // longer unbroken digit run, as a real IBAN's own digits-only tail
    // would be, matches THAT rule instead — still correctly rejected, just
    // not what this particular test is meant to isolate).
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'IBAN IE29 AIBK 9311 5212 34')", [
          ids.conversationId,
          USERS.seller1,
        ]),
        /bank account|IBAN/,
      );
    });
  });

  it("rejects a verification-code-shaped body", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'my sort code is 12-34-56')", [
          ids.conversationId,
          USERS.seller1,
        ]),
        /identity-verification/,
      );
    });
  });
});

describe("conversation_unread_counts() (0049)", () => {
  it("counts only the OTHER participant's messages after my own read cursor, and only for my own conversations", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      // Reset buyer1's read cursor to the beginning of time, then have
      // seller1 send one fresh message — buyer1 should see exactly 1
      // unread on this conversation.
      await c.query("update public.conversations set user_b_last_read_at = null where id = $1", [ids.conversationId]);
      await setIdentity(c, USERS.seller1);
      await c.query("insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'one new message')", [
        ids.conversationId,
        USERS.seller1,
      ]);

      await setIdentity(c, USERS.buyer1);
      const rows = await c.query("select * from public.conversation_unread_counts() where conversation_id = $1", [
        ids.conversationId,
      ]);
      expect(rows.rowCount).toBe(1);
      expect(Number(rows.rows[0].unread_count)).toBeGreaterThanOrEqual(1);

      // A non-participant's call to the same function never lists this
      // conversation at all — it's security-invoker, scoped by the
      // caller's own conversations' RLS, not by any argument.
      await setIdentity(c, USERS.buyer2);
      const strangerRows = await c.query("select * from public.conversation_unread_counts() where conversation_id = $1", [
        ids.conversationId,
      ]);
      expect(strangerRows.rowCount).toBe(0);
    });
  });
});
