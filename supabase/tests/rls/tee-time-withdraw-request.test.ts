// 0167: a golfer takes back a request the host hasn't answered yet.
//
// Fixture round (fixtures.ts): hosted by seller1, open with 3 spaces;
// buyer1 and buyer2 confirmed, moderator pending, admin declined.
import type { PoolClient } from "pg";
import { describe, it, expect, afterAll } from "vitest";
import { withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

const withdraw = (c: PoolClient, interestId: string) =>
  c.query<{ interest_id: string; invite_id: string }>("select * from public.withdraw_tee_time_request($1)", [interestId]);

async function row(c: PoolClient, interestId: string) {
  const r = await c.query<{ status: string; withdrawn_at: string | null }>(
    "select status, withdrawn_at from public.tee_time_interests where id = $1",
    [interestId],
  );
  return r.rows[0];
}

async function spaces(c: PoolClient): Promise<number> {
  await c.query("set local role service_role");
  const r = await c.query<{ spaces_available: number }>("select spaces_available from public.tee_time_invites where id = $1", [
    ids.teeTime.inviteId,
  ]);
  await c.query("set local role authenticated");
  return Number(r.rows[0].spaces_available);
}

describe("withdraw_tee_time_request (0167)", () => {
  it("takes back a waiting request: declined, and marked as the golfer's own doing", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const r = await withdraw(c, ids.teeTime.pendingModerator);
      expect(r.rows[0].interest_id).toBe(ids.teeTime.pendingModerator);
      const after = await row(c, ids.teeTime.pendingModerator);
      expect(after.status).toBe("declined");
      expect(after.withdrawn_at).not.toBeNull();
    });
  });

  it("moves no space — a waiting request never held one", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const before = await spaces(c);
      await withdraw(c, ids.teeTime.pendingModerator);
      expect(await spaces(c)).toBe(before);
    });
  });

  it("lets them ask again afterwards", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      await withdraw(c, ids.teeTime.pendingModerator);
      await c.query("select * from public.rejoin_tee_time($1)", [ids.teeTime.inviteId]);
      expect(await row(c, ids.teeTime.pendingModerator)).toEqual({ status: "pending", withdrawn_at: null });
    });
  });

  it("refuses someone else's request", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await expectRejected(withdraw(c, ids.teeTime.pendingModerator), /belongs to another member/);
    });
  });

  it("refuses once the host has answered — that's Can't make it, not Withdraw", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(withdraw(c, ids.teeTime.confirmedBuyer1), /already answered/);
    });
    await withRole("authenticated", USERS.admin, async (c) => {
      await expectRejected(withdraw(c, ids.teeTime.declinedAdmin), /already answered/);
    });
  });

  it("is not callable by anon", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(withdraw(c, ids.teeTime.pendingModerator), /permission denied/);
    });
  });
});
