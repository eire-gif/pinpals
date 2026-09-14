// Migration 0078 widened the tee_time_interests SELECT policy so that golfers
// who have confirmed a place on the same round can see each other. A widening
// is exactly the kind of change that needs a test proving what it did NOT
// widen, so most of what follows is the negative half: pending and declined
// requests stay private, and a stranger still sees nothing at all.
//
// The fixture round (fixtures.ts) is hosted by seller1 with four interests on
// it — buyer1 and buyer2 confirmed, moderator pending, admin declined — which
// is every status a reader could hold or want to read.
import { describe, it, expect, afterAll } from "vitest";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

/** The member_ids this identity can see on the fixture round, sorted so the
 * assertions read as sets rather than depending on row order. */
async function visibleMembers(userId: string): Promise<string[]> {
  return withRole("authenticated", userId, async (c) => {
    const r = await c.query<{ member_id: string }>(
      "select member_id from public.tee_time_interests where invite_id = $1 order by member_id",
      [ids.teeTime.inviteId],
    );
    return r.rows.map((row) => row.member_id);
  });
}

describe("tee_time_interests SELECT: the host", () => {
  it("still sees every request on their own round, whatever its status", async () => {
    // Unchanged by 0078, and the thing most worth re-proving: the host is how
    // the round gets filled, and they need the pending ones most of all.
    expect(await visibleMembers(USERS.seller1)).toEqual(
      [USERS.buyer1, USERS.buyer2, USERS.moderator, USERS.admin].sort(),
    );
  });
});

describe("tee_time_interests SELECT: a confirmed golfer", () => {
  it("sees the other confirmed golfer — the point of 0078", async () => {
    const visible = await visibleMembers(USERS.buyer1);
    expect(visible).toContain(USERS.buyer2);
  });

  it("sees their own row too", async () => {
    expect(await visibleMembers(USERS.buyer1)).toContain(USERS.buyer1);
  });

  it("sees ONLY the confirmed golfers — not who else asked", async () => {
    // The negative half. A golfer who asked and was turned down has not
    // joined anything, and the players have no business knowing they tried.
    const visible = await visibleMembers(USERS.buyer1);
    expect(visible).not.toContain(USERS.moderator); // pending
    expect(visible).not.toContain(USERS.admin); // declined
    expect(visible).toEqual([USERS.buyer1, USERS.buyer2].sort());
  });

  it("is symmetric — the other confirmed golfer sees the same list", async () => {
    expect(await visibleMembers(USERS.buyer2)).toEqual([USERS.buyer1, USERS.buyer2].sort());
  });
});

describe("tee_time_interests SELECT: everyone else", () => {
  it("a member with a PENDING request sees only their own row", async () => {
    // Asking is not joining. Someone still waiting on the host must not learn
    // the round is already half full, or who is in it.
    expect(await visibleMembers(USERS.moderator)).toEqual([USERS.moderator]);
  });

  it("a member whose request was DECLINED sees only their own row", async () => {
    expect(await visibleMembers(USERS.admin)).toEqual([USERS.admin]);
  });

  it("an unrelated member sees nothing on the round", async () => {
    expect(await visibleMembers(USERS.seller2)).toEqual([]);
  });

  it("anon sees nothing", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select member_id from public.tee_time_interests where invite_id = $1", [
        ids.teeTime.inviteId,
      ]);
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("has_confirmed_place()", () => {
  it("is true for a confirmed golfer and false for everyone else", async () => {
    for (const [userId, expected] of [
      [USERS.buyer1, true],
      [USERS.buyer2, true],
      [USERS.moderator, false], // pending
      [USERS.admin, false], // declined
      [USERS.seller2, false], // never asked
      [USERS.seller1, false], // the HOST — hosting is not a confirmed place
    ] as const) {
      const actual = await withRole("authenticated", userId, async (c) => {
        const r = await c.query<{ ok: boolean }>("select public.has_confirmed_place($1) as ok", [
          ids.teeTime.inviteId,
        ]);
        return r.rows[0].ok;
      });
      expect(actual, userId).toBe(expected);
    }
  });

  it("answers only about the caller, so it leaks nothing when called for someone else's round", async () => {
    // It takes an invite id but derives the member from auth.uid(), so an
    // attacker walking every invite id learns only their own status. This is
    // what makes it safe to grant to `authenticated` at all.
    const asStranger = await withRole("authenticated", USERS.seller2, async (c) => {
      const r = await c.query<{ ok: boolean }>("select public.has_confirmed_place($1) as ok", [
        ids.teeTime.inviteId,
      ]);
      return r.rows[0].ok;
    });
    expect(asStranger).toBe(false);
  });

  it("is not callable by anon", async () => {
    await withRole("anon", null, async (c) => {
      await expect(
        c.query("select public.has_confirmed_place($1)", [ids.teeTime.inviteId]),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});

describe("tee_time_interests INSERT still returns its own row", () => {
  it("expressing interest works — the RETURNING select passes on the first policy clause", async () => {
    // The regression 0052 exists to prevent: supabase-js appends RETURNING to
    // every insert, so the SELECT policy runs against the new row. A fresh
    // interest is member_id = auth.uid() and status 'pending', which passes
    // without ever reaching 0078's new clause.
    await withRole("authenticated", USERS.seller2, async (c) => {
      const r = await c.query(
        "insert into public.tee_time_interests (invite_id, member_id) values ($1, $2) returning id, status",
        [ids.teeTime.inviteId, USERS.seller2],
      );
      expect(r.rowCount).toBe(1);
      expect(r.rows[0].status).toBe("pending");
    });
  });
});
