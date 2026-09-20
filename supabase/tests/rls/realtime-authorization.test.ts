// Realtime Authorization (0082_realtime_authorization.sql).
//
// These policies are the whole of the answer to "may this client join this
// private broadcast topic". Realtime asks the question as an ordinary SELECT
// against realtime.messages for the topic being joined, so that is exactly
// how they are tested here.
//
// They matter more than a display-only feature usually would, because the two
// topics carry different things. `conversation-<id>` carries the message row
// itself — body and all — so a policy that admitted a non-participant would
// leak private message content live, without any of it passing the
// public.messages policies tested in messaging.test.ts. `inbox-<userId>`
// carries only a 140-character preview, but it is still someone else's mail.
//
// Receiving only. Publishing onto these topics happens server-side with the
// service-role key (src/lib/realtime.ts), so there is deliberately no policy
// letting a member write one — forging a "new message" still requires a real,
// RLS-checked insert into public.messages.
import { describe, it, expect, afterAll } from "vitest";
import { pool, withRole, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

// A conversation id belonging to nobody — it proves the policy checks
// participation rather than merely the topic's shape.
const STRANGER_CONVERSATION_ID = 999_999;

afterAll(closePool);

/**
 * The candidate rows, and who can see them.
 *
 * Not built on withRole(), and the reason is worth stating: withRole() opens
 * the transaction and switches role in one step, then always rolls back — so
 * a seed written in one call is gone before the next call can read it. These
 * policies need a row to exist and then to be read AS someone, which is one
 * transaction, seeded first and read after the role switch.
 *
 * The insert runs as the pool's own superuser connection, before `set local
 * role`, which is the only way to get rows in when no policy grants INSERT —
 * the same position Supabase's Realtime service is in when it writes one.
 * Everything is rolled back, so nothing leaks into another test file.
 */
async function visibleTo(
  userId: string | null,
  role: "authenticated" | "anon"
): Promise<{ topic: string; extension: string }[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into realtime.messages (topic, extension, event, private, payload)
       values ($1, 'broadcast', 'new_message', true, '{}'::jsonb),
              ($2, 'broadcast', 'new_message', true, '{}'::jsonb),
              ($3, 'broadcast', 'new_message', true, '{}'::jsonb),
              ($4, 'broadcast', 'new_message', true, '{}'::jsonb),
              ($1, 'presence',  'new_message', true, '{}'::jsonb)`,
      [
        `conversation-${ids.conversationId}`,
        `conversation-${STRANGER_CONVERSATION_ID}`,
        `inbox-${USERS.seller1}`,
        `inbox-${USERS.buyer2}`,
      ]
    );
    await client.query(
      "select set_config('request.jwt.claim.sub', $1, true)",
      [userId ?? ""]
    );
    await client.query(`set local role ${role}`);

    const result = await client.query<{ topic: string; extension: string }>(
      "select topic, extension from realtime.messages order by topic, extension"
    );
    return result.rows;
  } finally {
    try {
      await client.query("rollback");
    } catch {
      // Already aborted by a failed statement — rollback clears it either way.
    }
    client.release();
  }
}

const topicsFor = async (
  userId: string | null,
  role: "authenticated" | "anon" = "authenticated"
) => (await visibleTo(userId, role)).map((r) => r.topic);

describe("realtime broadcast: conversation topics", () => {
  it("both participants may receive on their own conversation's topic", async () => {
    for (const user of [USERS.seller1, USERS.buyer1]) {
      expect(await topicsFor(user)).toContain(
        `conversation-${ids.conversationId}`
      );
    }
  });

  it("a non-participant may not — even knowing the conversation id", async () => {
    expect(await topicsFor(USERS.buyer2)).not.toContain(
      `conversation-${ids.conversationId}`
    );
  });

  it("nobody may receive on a conversation that doesn't exist", async () => {
    for (const user of [USERS.seller1, USERS.buyer1, USERS.buyer2, USERS.admin]) {
      expect(await topicsFor(user)).not.toContain(
        `conversation-${STRANGER_CONVERSATION_ID}`
      );
    }
  });

  it("staff have no bypass here either — the same deliberate boundary as messaging.test.ts", async () => {
    expect(await topicsFor(USERS.admin)).not.toContain(
      `conversation-${ids.conversationId}`
    );
  });

  it("covers the broadcast extension only, never presence or postgres_changes", async () => {
    const rows = await visibleTo(USERS.seller1, "authenticated");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.extension === "broadcast")).toBe(true);
  });
});

describe("realtime broadcast: inbox topics", () => {
  it("a member may receive on their own inbox topic", async () => {
    expect(await topicsFor(USERS.seller1)).toContain(`inbox-${USERS.seller1}`);
  });

  it("a member may not receive on anyone else's", async () => {
    expect(await topicsFor(USERS.seller1)).not.toContain(
      `inbox-${USERS.buyer2}`
    );
  });
});

describe("realtime broadcast: anon", () => {
  it("sees nothing at all", async () => {
    expect(await topicsFor(null, "anon")).toEqual([]);
  });
});

describe("realtime_conversation_id: a topic is untrusted input", () => {
  // The policy casts part of the topic to bigint, and the topic is whatever
  // string a client asked to subscribe to. A malformed one has to return NULL
  // rather than raise: an exception from inside a policy is an error, not a
  // denial, and Realtime would surface it rather than simply refusing.
  it("returns null for anything that isn't conversation-<digits>", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const tooLong = `conversation-${"9".repeat(40)}`;
      const result = await c.query<{ topic: string; parsed: string | null }>(
        `select t as topic, public.realtime_conversation_id(t) as parsed
         from unnest($1::text[]) as t`,
        [
          [
            "conversation-42",
            "conversation-",
            "conversation-abc",
            "conversation-1a",
            " conversation-42",
            "inbox-someone",
            "",
            // Longer than bigint can hold: without the digit bound in the
            // function's own regex this raises "value out of range".
            tooLong,
          ],
        ]
      );

      const parsed = Object.fromEntries(
        result.rows.map((r) => [r.topic, r.parsed])
      );
      expect(parsed["conversation-42"]).toBe("42");
      for (const bad of [
        "conversation-",
        "conversation-abc",
        "conversation-1a",
        " conversation-42",
        "inbox-someone",
        "",
        tooLong,
      ]) {
        expect(parsed[bad]).toBeNull();
      }
    });
  });
});
