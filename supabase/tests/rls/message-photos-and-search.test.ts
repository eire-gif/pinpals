// 0086_message_photos_and_search.sql.
//
// Two new pieces of surface, and both of them are boundaries rather than
// features: who can see a photo somebody sent inside a conversation, and
// whose messages a search can reach. Neither is visible in the app if it is
// wrong — a policy that is too permissive shows nothing unusual to the person
// it is too permissive for — so they are tested here rather than by looking
// at a screen.
//
// The same deliberate omission as messaging.test.ts applies throughout:
// staff have NO read access to message content anywhere, and that includes
// photos. The only staff route to a conversation is the audited,
// reason-required /admin/reports/[id] Server Action, which runs as the
// service role. A staff bypass here would be a weakening of an existing
// privacy boundary, not a hardening of one, so the tests below assert its
// ABSENCE.
import { describe, it, expect, afterAll } from "vitest";
import { withRole, expectRejected, closePool, pool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

/**
 * Seeds one object into `message-images`, as the superuser — which is how it
 * really gets there. 0086 gives `authenticated` no insert policy at all: the
 * service role is the only writer, because the server route is the only path
 * that runs a photo through sharp first.
 *
 * Outside a withRole() transaction, so it is visible to the separate
 * connections the assertions use — and removed again in a finally, since
 * nothing else rolls it back.
 */
async function withStoredPhoto<T>(
  name: string,
  fn: (path: string) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(
      "insert into storage.objects (bucket_id, name) values ('message-images', $1)",
      [name]
    );
  } finally {
    client.release();
  }

  try {
    return await fn(name);
  } finally {
    const cleanup = await pool.connect();
    try {
      await cleanup.query(
        "delete from storage.objects where bucket_id = 'message-images' and name = $1",
        [name]
      );
    } finally {
      cleanup.release();
    }
  }
}

const readPhoto = (client: { query: (q: string, v: unknown[]) => Promise<{ rowCount: number | null }> }, name: string) =>
  client.query(
    "select name from storage.objects where bucket_id = 'message-images' and name = $1",
    [name]
  );

describe("message-images: who can see a photo", () => {
  it("the bucket is private", async () => {
    // The whole design rests on this. A public bucket would serve the object
    // to anyone with the URL and the policy below would decide nothing.
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ public: boolean }>(
        "select public from storage.buckets where id = 'message-images'"
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].public).toBe(false);
    } finally {
      client.release();
    }
  });

  it("both participants can read a photo in their own conversation", async () => {
    await withStoredPhoto(`${ids.conversationId}/a.jpg`, async (name) => {
      for (const user of [USERS.seller1, USERS.buyer1]) {
        await withRole("authenticated", user, async (c) => {
          expect((await readPhoto(c, name)).rowCount).toBe(1);
        });
      }
    });
  });

  it("a member who is not in the conversation cannot", async () => {
    await withStoredPhoto(`${ids.conversationId}/b.jpg`, async (name) => {
      await withRole("authenticated", USERS.buyer2, async (c) => {
        expect((await readPhoto(c, name)).rowCount).toBe(0);
      });
    });
  });

  it("anon cannot", async () => {
    await withStoredPhoto(`${ids.conversationId}/c.jpg`, async (name) => {
      await withRole("anon", null, async (c) => {
        expect((await readPhoto(c, name)).rowCount).toBe(0);
      });
    });
  });

  it("staff have no special access to a conversation's photos", async () => {
    await withStoredPhoto(`${ids.conversationId}/d.jpg`, async (name) => {
      for (const user of [USERS.admin, USERS.moderator]) {
        await withRole("authenticated", user, async (c) => {
          expect((await readPhoto(c, name)).rowCount).toBe(0);
        });
      }
    });
  });

  it("an object in a conversation that does not exist is readable by nobody", async () => {
    // The folder is the authorization key, so a folder naming no real
    // conversation must fail closed rather than open.
    await withStoredPhoto("999999999/e.jpg", async (name) => {
      await withRole("authenticated", USERS.seller1, async (c) => {
        expect((await readPhoto(c, name)).rowCount).toBe(0);
      });
    });
  });

  it("an object whose folder is not a number is refused, not an error", async () => {
    // message_image_conversation_id() guards its own cast with a CASE for
    // exactly this. Without it the policy would RAISE on a malformed object
    // name — and a policy that raises fails the member's whole query rather
    // than declining one row, which is a far worse failure than a hidden
    // photo. The assertion that matters here is that this does not throw.
    for (const name of ["not-a-number/f.jpg", "../g.jpg", "h.jpg"]) {
      await withStoredPhoto(name, async (stored) => {
        await withRole("authenticated", USERS.seller1, async (c) => {
          expect((await readPhoto(c, stored)).rowCount).toBe(0);
        });
      });
    }
  });

  it("a member cannot put anything into the bucket themselves", async () => {
    // This is what makes the sharp pipeline unskippable. If a member could
    // insert here, a phone could upload an original photo with its EXIF —
    // and its GPS — intact, and nothing would have stripped it.
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query(
          "insert into storage.objects (bucket_id, name) values ('message-images', $1)",
          [`${ids.conversationId}/mine.jpg`]
        ),
        /row-level security/i
      );
    });
  });
});

describe("messages: a photo is a message on its own", () => {
  it("accepts an empty body when there is an image", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { rowCount } = await c.query(
        `insert into public.messages (conversation_id, sender_id, body, image_path)
         values ($1, $2, '', $3) returning id`,
        [ids.conversationId, USERS.buyer1, `${ids.conversationId}/photo.jpg`]
      );
      expect(rowCount).toBe(1);
    });
  });

  it("still refuses a message that is neither text nor a photo", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query(
          `insert into public.messages (conversation_id, sender_id, body)
           values ($1, $2, '   ')`,
          [ids.conversationId, USERS.buyer1]
        ),
        /messages_body_check/i
      );
    });
  });
});

describe("search_my_messages: whose messages a search can reach", () => {
  it("finds a participant's own message by a word in it", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "select id from public.search_my_messages('available')"
      );
      expect(rows.map((row) => row.id)).toContain(ids.messageId);
    });
  });

  it("finds nothing for someone outside the conversation", async () => {
    // SECURITY INVOKER is what does this — `messages`' own participant-only
    // SELECT policy filters the function's scan exactly as it filters a
    // direct read. If this ever returns a row, the function has been made
    // SECURITY DEFINER and is leaking every conversation in the app.
    await withRole("authenticated", USERS.buyer2, async (c) => {
      const { rowCount } = await c.query(
        "select id from public.search_my_messages('available')"
      );
      expect(rowCount).toBe(0);
    });
  });

  it("finds nothing for staff", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      const { rowCount } = await c.query(
        "select id from public.search_my_messages('available')"
      );
      expect(rowCount).toBe(0);
    });
  });

  it("anon cannot execute it at all", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(
        c.query("select id from public.search_my_messages('available')", []),
        /permission denied/i
      );
    });
  });

  it("excludes a message that has been hidden by moderation", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      // Found BEFORE it is hidden. Without this the test below would pass
      // just as happily if the search were broken, if the fixture text had
      // changed, or if the hide had silently updated nothing — and a test
      // that passes for the wrong reason is worse than no test.
      const before = await c.query(
        "select id from public.search_my_messages('available')"
      );
      expect(before.rowCount).toBe(1);

      // Hidden by the service role, which is how hideMessage() does it.
      await c.query("set local role service_role");
      const hide = await c.query(
        "update public.messages set hidden_at = now() where id = $1",
        [ids.messageId]
      );
      expect(hide.rowCount).toBe(1);
      await c.query("set local role authenticated");

      const { rowCount } = await c.query(
        "select id from public.search_my_messages('available')"
      );
      // A thread shows a hidden message as "This message was removed".
      // Finding it by its text would undo that.
      expect(rowCount).toBe(0);
    });
  });

  it("returns nothing for an empty or blank query rather than everything", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      for (const query of ["", "   "]) {
        const { rowCount } = await c.query(
          "select id from public.search_my_messages($1)",
          [query]
        );
        expect(rowCount).toBe(0);
      }
    });
  });

  it("does not raise on punctuation a member might type", async () => {
    // websearch_to_tsquery rather than to_tsquery precisely because this
    // field searches on every keystroke and to_tsquery raises a syntax error
    // on half of what anyone types. A search box that can throw is a search
    // box that breaks the screen around it.
    await withRole("authenticated", USERS.buyer1, async (c) => {
      for (const query of ["&&&", '"unclosed', "a | | b", "-", "::", "driver!!"]) {
        await expect(
          c.query("select id from public.search_my_messages($1)", [query])
        ).resolves.toBeDefined();
      }
    });
  });

  it("survives any limit a caller passes", async () => {
    // The fixture has one matching message, so this cannot demonstrate that
    // 100 is really the ceiling — what it does demonstrate is that
    // `least(greatest(coalesce(...)))` handles the values that would
    // otherwise make `limit` raise: zero, negative, null, and a number
    // outside int range on the way in. A search box that throws on a bad
    // parameter is the failure this guards.
    await withRole("authenticated", USERS.buyer1, async (c) => {
      for (const limit of [1000000, 0, -5, null]) {
        const { rows } = await c.query<{ n: string }>(
          "select count(*)::text as n from public.search_my_messages('available', $1)",
          [limit]
        );
        expect(Number(rows[0].n)).toBeLessThanOrEqual(100);
      }
    });
  });
});
