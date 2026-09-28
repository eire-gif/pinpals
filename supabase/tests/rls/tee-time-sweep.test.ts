// 0084's nightly sweep. Nothing ever moved an invite out of 'open' before
// it, so a round played last March is still an open invite today — filtered
// out of browse by a play_date predicate in four separate places, which is
// four chances to forget.
//
// What this file is really protecting is the boundary: the sweep must close
// what is over and touch nothing else. Closing a round that has not happened
// yet would take it out of browse and strand everyone who had confirmed a
// place on it.
//
// Every test seeds and asserts inside ONE withRole() transaction, because the
// harness always rolls back.
import type { PoolClient } from "pg";
import { describe, it, expect, afterAll } from "vitest";
import { withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

/** An invite `days` from today — negative for the past. Returns its id. */
async function seedInvite(
  c: PoolClient,
  days: number,
  status: string
): Promise<number> {
  const { rows } = await c.query<{ id: string }>(
    `insert into public.tee_time_invites
       (member_id, club_name, county, play_date, spaces_available, status, expires_at)
     values ($1, 'Sweep Test Links', 'Dublin', current_date + $2::int, 3, $3,
             (current_date + $2::int + time '23:59:59') at time zone 'UTC')
     returning id`,
    [USERS.seller1, days, status]
  );
  return Number(rows[0].id);
}

async function statusOf(c: PoolClient, id: number): Promise<string> {
  const { rows } = await c.query<{ status: string }>(
    "select status from public.tee_time_invites where id = $1",
    [id]
  );
  return rows[0].status;
}

describe("complete_past_tee_times()", () => {
  it("closes an open round a clear day past its date", async () => {
    await withRole("service_role", null, async (c) => {
      const id = await seedInvite(c, -2, "open");
      await c.query("select public.complete_past_tee_times()");
      expect(await statusOf(c, id)).toBe("completed");
    });
  });

  it("closes a full round too — filled is not the same as finished", async () => {
    await withRole("service_role", null, async (c) => {
      const id = await seedInvite(c, -5, "full");
      await c.query("select public.complete_past_tee_times()");
      expect(await statusOf(c, id)).toBe("completed");
    });
  });

  it("leaves yesterday's round alone", async () => {
    // The boundary, and the one worth being careful about: a four-ball on
    // Sunday evening is not finished at one minute past midnight. A full
    // clear day has to pass.
    await withRole("service_role", null, async (c) => {
      const id = await seedInvite(c, -1, "open");
      await c.query("select public.complete_past_tee_times()");
      expect(await statusOf(c, id)).toBe("open");
    });
  });

  it("leaves today's round alone", async () => {
    await withRole("service_role", null, async (c) => {
      const id = await seedInvite(c, 0, "open");
      await c.query("select public.complete_past_tee_times()");
      expect(await statusOf(c, id)).toBe("open");
    });
  });

  it("leaves a future round alone", async () => {
    await withRole("service_role", null, async (c) => {
      const id = await seedInvite(c, 14, "open");
      await c.query("select public.complete_past_tee_times()");
      expect(await statusOf(c, id)).toBe("open");
    });
  });

  it("leaves a cancelled round cancelled", async () => {
    // Moving it to 'completed' would claim a round happened that did not.
    await withRole("service_role", null, async (c) => {
      const id = await seedInvite(c, -9, "cancelled");
      await c.query("select public.complete_past_tee_times()");
      expect(await statusOf(c, id)).toBe("cancelled");
    });
  });

  it("is idempotent — a second run closes nothing", async () => {
    await withRole("service_role", null, async (c) => {
      await seedInvite(c, -3, "open");
      await c.query("select public.complete_past_tee_times()");
      const { rows } = await c.query<{ complete_past_tee_times: number }>(
        "select public.complete_past_tee_times()"
      );
      expect(Number(rows[0].complete_past_tee_times)).toBe(0);
    });
  });

  it("keeps the interests on a round it closes", async () => {
    // Confirmed rounds shows a 'Played' list, which is the record of who a
    // member has played with. Closing the invite must not take it away.
    await withRole("service_role", null, async (c) => {
      const id = await seedInvite(c, -4, "full");
      await c.query(
        `insert into public.tee_time_interests (invite_id, member_id, status)
         values ($1, $2, 'confirmed')`,
        [id, USERS.buyer1]
      );

      await c.query("select public.complete_past_tee_times()");

      const { rows } = await c.query<{ status: string }>(
        "select status from public.tee_time_interests where invite_id = $1",
        [id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("confirmed");
    });
  });

  it("is unreachable from a browser, signed in or not", async () => {
    // A member closing other people's rounds is not a thing that should be
    // expressible. function-grants.test.ts asserts the grant table; this
    // asserts the behaviour.
    for (const [role, userId] of [
      ["authenticated", USERS.seller1],
      ["anon", null],
    ] as const) {
      await withRole(role, userId, async (c) => {
        await expectRejected(
          c.query("select public.complete_past_tee_times()"),
          /permission denied/
        );
      });
    }
  });
});
