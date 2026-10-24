// Migration 0188 — trust & safety: reliability, verified members, marketplace
// message safety flags.
//
// Fixture round (fixtures.ts): hosted by seller1, 14 days out, open; buyer1
// and buyer2 confirmed. The fixture conversation (seller1 <-> buyer1) is a
// marketplace one (it has a listing_id).
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, setIdentity, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

async function asService<T>(c: PoolClient, sql: string, params: unknown[] = []) {
  await c.query("set local role service_role");
  try {
    return await c.query<T & Record<string, unknown>>(sql, params);
  } finally {
    await c.query("set local role authenticated");
  }
}

/** Move the fixture round so it starts `hours` from now (negative = past). */
async function startsIn(c: PoolClient, hours: number) {
  await asService(
    c,
    `update public.tee_time_invites
        set play_date = ((now() + make_interval(hours => $2)) at time zone 'Europe/Dublin')::date,
            exact_tee_time = ((now() + make_interval(hours => $2)) at time zone 'Europe/Dublin')::time
      where id = $1`,
    [ids.teeTime.inviteId, hours],
  );
}

const dropOut = (c: PoolClient, interestId: string) =>
  c.query("select * from public.confirm_tee_time_place($1, false)", [interestId]);

async function attendance(c: PoolClient, member: string) {
  const r = await asService<{ outcome: string }>(
    c,
    "select outcome from public.tee_time_attendance where invite_id = $1 and member_id = $2",
    [ids.teeTime.inviteId, member],
  );
  return r.rows.map((row) => row.outcome);
}

async function reliability(c: PoolClient, member: string) {
  const r = await c.query<{ rounds_played: number; no_shows: number; late_cancels: number; level: string }>(
    "select rounds_played, no_shows, late_cancels, level from public.member_reliability(array[$1]::uuid[])",
    [member],
  );
  return r.rows[0];
}

describe("late cancellations", () => {
  it("records giving back a confirmed place inside 24 hours", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await startsIn(c, 10);
      await dropOut(c, ids.teeTime.confirmedBuyer1);
      expect(await attendance(c, USERS.buyer1)).toEqual(["late_cancel"]);
    });
  });

  it("does not record a drop-out with more notice", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await startsIn(c, 48);
      await dropOut(c, ids.teeTime.confirmedBuyer1);
      expect(await attendance(c, USERS.buyer1)).toEqual([]);
    });
  });

  it("records a host calling off a round with players inside 24 hours", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await startsIn(c, 5);
      await c.query("update public.tee_time_invites set status = 'cancelled' where id = $1", [ids.teeTime.inviteId]);
      expect(await attendance(c, USERS.seller1)).toEqual(["late_cancel"]);
    });
  });
});

describe("no-shows", () => {
  it("lets the host mark a confirmed golfer after the round, and counts it", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await startsIn(c, -5);
      await c.query("select public.mark_tee_time_no_show($1, $2, true)", [ids.teeTime.inviteId, USERS.buyer2]);
      expect(await attendance(c, USERS.buyer2)).toEqual(["no_show"]);
      const r = await reliability(c, USERS.buyer2);
      expect(r.no_shows).toBe(1);
      expect(r.rounds_played).toBe(0);
    });
  });

  it("refuses anyone but the host", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await startsIn(c, -5);
      await expectRejected(
        c.query("select public.mark_tee_time_no_show($1, $2, true)", [ids.teeTime.inviteId, USERS.buyer2]),
        /Only the host/,
      );
    });
  });

  it("refuses before the round has started", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await startsIn(c, 5);
      await expectRejected(
        c.query("select public.mark_tee_time_no_show($1, $2, true)", [ids.teeTime.inviteId, USERS.buyer2]),
        /once the round has started/,
      );
    });
  });

  it("refuses when the golfer has a live scorecard with the host that day", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await startsIn(c, -5);
      const round = await asService<{ id: string }>(
        c,
        `insert into public.live_rounds (created_by, course_name, format, allowance, played_on)
         select $1, 'Test links', 'stableford', 0.95, play_date from public.tee_time_invites where id = $2
         returning id`,
        [USERS.seller1, ids.teeTime.inviteId],
      );
      await asService(
        c,
        `insert into public.live_round_players
           (round_id, member_id, display_name, handicap_index, course_handicap, playing_handicap, position)
         values ($1, $2, 'Host', 10, 10, 10, 1), ($1, $3, 'Buyer', 12, 12, 12, 2)`,
        [round.rows[0].id, USERS.seller1, USERS.buyer2],
      );
      await expectRejected(
        c.query("select public.mark_tee_time_no_show($1, $2, true)", [ids.teeTime.inviteId, USERS.buyer2]),
        /live scorecard/,
      );
    });
  });

  it("stops counting once the golfer disputes it", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await startsIn(c, -5);
      await c.query("select public.mark_tee_time_no_show($1, $2, true)", [ids.teeTime.inviteId, USERS.buyer2]);
      await setIdentity(c, USERS.buyer2);
      await c.query("select public.dispute_tee_time_attendance($1, 'I was there')", [ids.teeTime.inviteId]);
      const r = await reliability(c, USERS.buyer2);
      expect(r.no_shows).toBe(0);
      expect(r.rounds_played).toBe(1);
    });
  });

  it("shows the golfer their own record but not someone else's", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await startsIn(c, -5);
      await c.query("select public.mark_tee_time_no_show($1, $2, true)", [ids.teeTime.inviteId, USERS.buyer2]);
      await setIdentity(c, USERS.buyer2);
      const mine = await c.query("select 1 from public.tee_time_attendance");
      expect(mine.rowCount).toBe(1);
      await setIdentity(c, USERS.buyer1);
      const theirs = await c.query("select 1 from public.tee_time_attendance");
      expect(theirs.rowCount).toBe(0);
    });
  });
});

describe("member_reliability()", () => {
  it("calls fewer than 3 rounds on record 'new'", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await startsIn(c, -5);
      const r = await reliability(c, USERS.buyer1);
      expect(r.rounds_played).toBe(1);
      expect(r.level).toBe("new");
    });
  });
});

describe("verified members", () => {
  it("lets every member see the badge but nobody write it", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await asService(c, "insert into public.verified_members (member_id, club_name) values ($1, 'Portmarnock')", [
        USERS.seller1,
      ]);
      const r = await c.query("select member_id from public.verified_members");
      expect(r.rowCount).toBe(1);
      await expectRejected(
        c.query("insert into public.verified_members (member_id) values ($1)", [USERS.buyer1]),
      );
    });
  });

  it("keeps a member's submission to themselves", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await asService(
        c,
        `insert into public.member_verifications (member_id, golf_ireland_number, club_name, status)
         values ($1, '12345678', 'Portmarnock', 'verified')`,
        [USERS.seller1],
      );
      expect((await c.query("select 1 from public.member_verifications")).rowCount).toBe(0);
      await setIdentity(c, USERS.seller1);
      expect((await c.query("select 1 from public.member_verifications")).rowCount).toBe(1);
    });
  });
});

describe("marketplace message safety flags", () => {
  const flags = async (c: PoolClient, body: string) => {
    const r = await c.query<{ f: string[] | null }>("select public.message_safety_flags($1) as f", [body]);
    return r.rows[0].f;
  };

  it("spots links, deposits, couriers, odd payments and moving off the app", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      expect(await flags(c, "see pics at bit.ly/abc123")).toEqual(["link"]);
      expect(await flags(c, "Can you pay a deposit to hold them?")).toEqual(["pay_first"]);
      expect(await flags(c, "My courier will collect, just pay the delivery fee")).toEqual(["courier"]);
      expect(await flags(c, "I only take PayPal friends and family")).toEqual(["odd_payment"]);
      expect(await flags(c, "WhatsApp me on 087")).toEqual(["off_app"]);
    });
  });

  it("leaves ordinary messages and our own links alone", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      expect(await flags(c, "Are the irons still available? I can meet at the club on Saturday.")).toBeNull();
      expect(await flags(c, "Here it is https://pinpals.ie/marketplace/12")).toBeNull();
      expect(await flags(c, "Can post them if you like")).toBeNull();
    });
  });

  it("stamps the flags on a marketplace message as it's sent", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query<{ safety_flags: string[] | null }>(
        "insert into public.messages (conversation_id, sender_id, body) values ($1, $2, $3) returning safety_flags",
        [ids.conversationId, USERS.buyer1, "Send the money first and I'll post them"],
      );
      expect(r.rows[0].safety_flags).toEqual(["pay_first"]);
    });
  });
});
