// 0190_security_fixes.sql — each test is an attack from the 25 Oct 2026
// security review, run as an ordinary signed-in member, and must now fail;
// plus the normal action next to it, which must still work.
import type { PoolClient } from "pg";
import { describe, it, expect, afterAll } from "vitest";
import { withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

async function asServer<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

describe("profiles: no self-delete (delete + re-create wiped date of birth, parent link and no-show history)", () => {
  it("a member can't delete their own profile row", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(c.query("delete from public.profiles where id = $1", [USERS.buyer1]), /permission denied/);
    });
  });
});

describe("connections: the people in a request can't be swapped", () => {
  async function pendingRequest(c: PoolClient): Promise<string> {
    return asServer(c, async () => {
      await c.query(
        "delete from public.connections where (requester_id = $1 and recipient_id = $2) or (requester_id = $2 and recipient_id = $1)",
        [USERS.buyer2, USERS.seller2],
      );
      const r = await c.query<{ id: string }>(
        "insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'pending') returning id",
        [USERS.buyer2, USERS.seller2],
      );
      return r.rows[0].id;
    });
  }

  it("the recipient can't rewrite the requester to someone else and accept", async () => {
    await withRole("authenticated", USERS.seller2, async (c) => {
      const id = await pendingRequest(c);
      await expectRejected(
        c.query("update public.connections set requester_id = $1, status = 'accepted' where id = $2", [USERS.buyer1, id]),
        /can't change requester_id/,
      );
    });
  });

  it("the recipient can still accept a real request", async () => {
    await withRole("authenticated", USERS.seller2, async (c) => {
      const id = await pendingRequest(c);
      const r = await c.query("update public.connections set status = 'accepted' where id = $1 returning status", [id]);
      expect(r.rows[0].status).toBe("accepted");
    });
  });
});

describe("tee-time requests: who and which round can't be rewritten", () => {
  it("the host can't put a different member into a request", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("update public.tee_time_interests set member_id = $1 where id = $2", [USERS.seller2, ids.teeTime.pendingModerator]),
        /can't change member_id/,
      );
    });
  });

  it("a confirmed player can't move their place to another round", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const other = await asServer(c, async () => {
        const r = await c.query<{ id: string }>("select id from public.tee_time_invites where id <> $1 limit 1", [ids.teeTime.inviteId]);
        return r.rows[0]?.id ?? "0";
      });
      // Either the row isn't theirs to edit (0 rows) or the trigger refuses — never moved.
      await c.query("savepoint s");
      try {
        await c.query("update public.tee_time_interests set invite_id = $1 where id = $2", [other, ids.teeTime.confirmedBuyer1]);
      } catch (e) {
        expect(String(e)).toMatch(/can't change invite_id|permission denied|row-level security/);
        await c.query("rollback to savepoint s");
      }
      const r = await asServer(c, () =>
        c.query<{ invite_id: string }>("select invite_id from public.tee_time_interests where id = $1", [ids.teeTime.confirmedBuyer1]),
      );
      expect(r.rows[0].invite_id).toBe(ids.teeTime.inviteId);
    });
  });

  it("the server can still change anything", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query("update public.tee_time_interests set updated_at = now() where id = $1", [ids.teeTime.pendingModerator]);
    });
  });
});

describe("guardian links: a junior can't read the parent's approval code", () => {
  it("token_hash is unreadable to members; the rest of the link still is", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await asServer(c, () =>
        c.query(
          "insert into public.guardian_links (junior_id, guardian_email, token_hash, status) values ($1, 'parent@example.com', repeat('a', 64), 'pending')",
          [USERS.buyer1],
        ),
      );
      const ok = await c.query("select status, guardian_email from public.guardian_links where junior_id = $1", [USERS.buyer1]);
      expect(ok.rows[0].guardian_email).toBe("parent@example.com");
      await expectRejected(c.query("select token_hash from public.guardian_links where junior_id = $1", [USERS.buyer1]), /permission denied/);
    });
  });
});

describe("competition_staff() needs the two-step code like every other staff power", () => {
  it("false for an admin on a password-only session, true after the second step", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      await c.query("select set_config('request.jwt.claim.aal', 'aal1', true)");
      expect((await c.query("select public.competition_staff() as yes")).rows[0].yes).toBe(false);
      await c.query("select set_config('request.jwt.claim.aal', 'aal2', true)");
      expect((await c.query("select public.competition_staff() as yes")).rows[0].yes).toBe(true);
    });
  });
});
