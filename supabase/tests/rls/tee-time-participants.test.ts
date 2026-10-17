// 0165: a golfer can always read a round they're part of.
//
// Before 0165 anyone but the host could read a tee_time_invites row only
// while it was 'open'. So the moment a round was marked full, swept to
// 'completed' or cancelled, it vanished for the golfers in it — including
// the "Cancelled by <host>" card My rounds exists to show.
//
// The fixture round (fixtures.ts) is hosted by seller1: buyer1 and buyer2
// confirmed, moderator pending, admin declined. seller2 has nothing to do
// with it, and is the negative half — the widening is for people IN the
// round, not for anyone who can name its id.
//
// Seed and read in one withRole() transaction: the harness always rolls back.
import type { PoolClient } from "pg";
import { describe, it, expect, afterAll } from "vitest";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

async function setStatus(c: PoolClient, status: string): Promise<void> {
  await c.query("set local role service_role");
  await c.query("update public.tee_time_invites set status = $2, spaces_available = 0 where id = $1", [
    ids.teeTime.inviteId,
    status,
  ]);
  await c.query("set local role authenticated");
}

/** Does `userId` see the fixture round once it is in `status`? */
async function seesRound(userId: string, status: string): Promise<boolean> {
  return withRole("authenticated", userId, async (c) => {
    await setStatus(c, status);
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const r = await c.query("select id, status from public.tee_time_invites where id = $1", [ids.teeTime.inviteId]);
    return r.rowCount === 1;
  });
}

describe("tee_time_invites SELECT: golfers in the round (0165)", () => {
  for (const status of ["full", "cancelled", "completed"]) {
    it(`a confirmed golfer still sees it once ${status}`, async () => {
      expect(await seesRound(USERS.buyer1, status)).toBe(true);
      expect(await seesRound(USERS.buyer2, status)).toBe(true);
    });
  }

  it("a golfer still waiting on the host sees it cancelled", async () => {
    expect(await seesRound(USERS.moderator, "cancelled")).toBe(true);
  });

  it("a golfer the host turned down sees it cancelled", async () => {
    expect(await seesRound(USERS.admin, "cancelled")).toBe(true);
  });

  it("the host still sees their own round whatever its status", async () => {
    expect(await seesRound(USERS.seller1, "cancelled")).toBe(true);
    expect(await seesRound(USERS.seller1, "full")).toBe(true);
  });
});

describe("tee_time_invites SELECT: what 0165 did NOT widen", () => {
  for (const status of ["full", "cancelled", "completed"]) {
    it(`a member with nothing to do with the round does not see it once ${status}`, async () => {
      expect(await seesRound(USERS.seller2, status)).toBe(false);
    });
  }

  it("anon sees no closed round", async () => {
    // Since 0132 an anon read of tee_time_invites is refused outright
    // (tee_time_invited() is not granted to anon), and 0165 leaves that as
    // it was. Either answer — refused, or no rows — means anon can't see it.
    await withRole("anon", null, async (c) => {
      await c.query("set local role service_role");
      await c.query("update public.tee_time_invites set status = 'cancelled' where id = $1", [ids.teeTime.inviteId]);
      await c.query("set local role anon");
      await c.query("savepoint anon_read");
      const seen = await c
        .query("select id from public.tee_time_invites where id = $1", [ids.teeTime.inviteId])
        .then((r) => r.rowCount ?? 0)
        .catch((err: Error) => {
          expect(err.message).toMatch(/permission denied/);
          return 0;
        });
      await c.query("rollback to savepoint anon_read");
      expect(seen).toBe(0);
    });
  });

  it("a full round still shows its players only to its players", async () => {
    // 0165 is about the round, not the people on it: tee_time_interests'
    // own rule (0078/0084) is untouched.
    await withRole("authenticated", USERS.seller2, async (c) => {
      await setStatus(c, "full");
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [USERS.seller2]);
      const r = await c.query("select member_id from public.tee_time_interests where invite_id = $1", [
        ids.teeTime.inviteId,
      ]);
      expect(r.rowCount).toBe(0);
    });
  });
});
