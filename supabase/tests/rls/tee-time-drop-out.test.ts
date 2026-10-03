// Migration 0090 — a golfer can drop out of a round after confirming.
//
// confirm_tee_time_place(id, false) used to accept only an open offer
// ('accepted'). It now accepts a confirmed place too, hands the space back
// under the same lock, and refuses a round that has already been played.
//
// Fixture round (fixtures.ts): hosted by seller1, 14 days out, open with 3
// spaces; buyer1 and buyer2 confirmed, moderator pending, admin declined.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, setIdentity, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

/** Arrange the round as superuser-ish setup inside the test transaction,
 *  then go back to being the member. Rolled back with everything else. */
async function arrange(c: PoolClient, sql: string, params: unknown[] = []) {
  await c.query("set local role service_role");
  try {
    await c.query(sql, params);
  } finally {
    await c.query("set local role authenticated");
  }
}

async function invite(c: PoolClient) {
  await c.query("set local role service_role");
  try {
    const r = await c.query<{ spaces_available: number; status: string }>(
      "select spaces_available, status from public.tee_time_invites where id = $1",
      [ids.teeTime.inviteId],
    );
    return r.rows[0];
  } finally {
    await c.query("set local role authenticated");
  }
}

const dropOut = (c: PoolClient, interestId: string) =>
  c.query<{ new_status: string }>("select * from public.confirm_tee_time_place($1, false)", [interestId]);

describe("confirm_tee_time_place(…, false) on a CONFIRMED place", () => {
  it("lets the golfer drop out: their row becomes declined", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await dropOut(c, ids.teeTime.confirmedBuyer1);
      expect(r.rows[0].new_status).toBe("declined");
      const mine = await c.query<{ status: string }>(
        "select status from public.tee_time_interests where id = $1",
        [ids.teeTime.confirmedBuyer1],
      );
      expect(mine.rows[0].status).toBe("declined");
    });
  });

  it("hands the space back and reopens a full round", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await arrange(c, "update public.tee_time_invites set spaces_available = 0, status = 'full' where id = $1", [
        ids.teeTime.inviteId,
      ]);
      await dropOut(c, ids.teeTime.confirmedBuyer1);
      expect(await invite(c)).toEqual({ spaces_available: 1, status: "open" });
    });
  });

  it("never takes the count past a fourball's three spaces", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await dropOut(c, ids.teeTime.confirmedBuyer1);
      expect((await invite(c)).spaces_available).toBe(3);
    });
  });

  it("leaves a round the host has cancelled cancelled", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await arrange(c, "update public.tee_time_invites set spaces_available = 1, status = 'cancelled' where id = $1", [
        ids.teeTime.inviteId,
      ]);
      await dropOut(c, ids.teeTime.confirmedBuyer1);
      expect(await invite(c)).toEqual({ spaces_available: 1, status: "cancelled" });
    });
  });

  it("removes them from what the other player sees", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await dropOut(c, ids.teeTime.confirmedBuyer1);
      await setIdentity(c, USERS.buyer2);
      const r = await c.query<{ member_id: string }>(
        "select member_id from public.tee_time_interests where invite_id = $1 and status = 'confirmed'",
        [ids.teeTime.inviteId],
      );
      expect(r.rows.map((row) => row.member_id)).toEqual([USERS.buyer2]);
    });
  });

  it("refuses a round that has already been played", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await arrange(c, "update public.tee_time_invites set play_date = current_date - 2 where id = $1", [
        ids.teeTime.inviteId,
      ]);
      await expectRejected(dropOut(c, ids.teeTime.confirmedBuyer1), /already been played/);
    });
  });

  it("allows dropping out on the day itself", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await arrange(
        c,
        "update public.tee_time_invites set play_date = (now() at time zone 'Europe/Dublin')::date where id = $1",
        [ids.teeTime.inviteId],
      );
      const r = await dropOut(c, ids.teeTime.confirmedBuyer1);
      expect(r.rows[0].new_status).toBe("declined");
    });
  });
});

describe("what dropping out still refuses", () => {
  it("someone else's place", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await expectRejected(dropOut(c, ids.teeTime.confirmedBuyer1), /another member/);
    });
  });

  it("a request the host hasn't answered", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      await expectRejected(dropOut(c, ids.teeTime.pendingModerator), /hasn't offered you a place/);
    });
  });

  it("a place already given up — no second space handed back", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      await expectRejected(dropOut(c, ids.teeTime.declinedAdmin), /not in this round/);
    });
  });

  it("re-confirming a place after dropping out", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await dropOut(c, ids.teeTime.confirmedBuyer1);
      await expectRejected(
        c.query("select * from public.confirm_tee_time_place($1, true)", [ids.teeTime.confirmedBuyer1]),
        /no longer awaiting confirmation/,
      );
    });
  });

  it("anon", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(dropOut(c, ids.teeTime.confirmedBuyer1));
    });
  });
});

// ---------------------------------------------------------------------------
// Migration 0091 — asking again after dropping out.
// ---------------------------------------------------------------------------

const rejoin = (c: PoolClient) =>
  c.query<{ interest_id: string }>("select * from public.rejoin_tee_time($1)", [ids.teeTime.inviteId]);

describe("rejoin_tee_time after dropping out (0091)", () => {
  it("marks a golfer's own drop-out as withdrawn", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await dropOut(c, ids.teeTime.confirmedBuyer1);
      const r = await c.query<{ withdrawn_at: string | null }>(
        "select withdrawn_at from public.tee_time_interests where id = $1",
        [ids.teeTime.confirmedBuyer1],
      );
      expect(r.rows[0].withdrawn_at).not.toBeNull();
    });
  });

  it("lets them ask again: back to pending, withdrawn cleared", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await dropOut(c, ids.teeTime.confirmedBuyer1);
      const r = await rejoin(c);
      expect(r.rows[0].interest_id).toBe(ids.teeTime.confirmedBuyer1);
      const row = await c.query<{ status: string; withdrawn_at: string | null }>(
        "select status, withdrawn_at from public.tee_time_interests where id = $1",
        [ids.teeTime.confirmedBuyer1],
      );
      expect(row.rows[0]).toEqual({ status: "pending", withdrawn_at: null });
    });
  });

  it("does not let someone the HOST declined ask again", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      await expectRejected(rejoin(c), /already answered/);
    });
  });

  it("refuses while their request is still live", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      await expectRejected(rejoin(c), /already expressed interest/);
    });
  });

  it("refuses a round that is no longer open", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await dropOut(c, ids.teeTime.confirmedBuyer1);
      await arrange(c, "update public.tee_time_invites set status = 'cancelled' where id = $1", [ids.teeTime.inviteId]);
      await expectRejected(rejoin(c), /no longer open/);
    });
  });

  it("refuses a round that has been played", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await dropOut(c, ids.teeTime.confirmedBuyer1);
      await arrange(c, "update public.tee_time_invites set play_date = current_date - 3 where id = $1", [
        ids.teeTime.inviteId,
      ]);
      await expectRejected(rejoin(c), /no longer open/);
    });
  });

  it("refuses the host on their own round", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(rejoin(c), /your own invite/);
    });
  });

  it("is not available to anon", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(rejoin(c));
    });
  });
});
