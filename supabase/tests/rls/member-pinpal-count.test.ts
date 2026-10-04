// 0101_member_pinpal_count.sql — the PinPals number on a member's profile.
//
// A count of accepted connections, never who. Pending and declined requests
// don't count. Nobody blocked either way gets an answer, and anon gets none.
//
// Cast:
//   seller1  the member whose profile is being read
//   buyer1, seller2  their connections in these tests
//   buyer2   a reader with no relationship to seller1
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

async function asService<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

/** Starts seller1 from no connections at all, whatever the fixtures hold. */
async function fresh(c: PoolClient): Promise<void> {
  await asService(c, () =>
    c.query("delete from public.connections where requester_id = $1 or recipient_id = $1", [USERS.seller1]),
  );
}

async function link(c: PoolClient, a: string, b: string, status: "pending" | "accepted" | "declined"): Promise<void> {
  await asService(c, () =>
    c.query(
      `insert into public.connections (requester_id, recipient_id, status)
       values ($1, $2, $3)
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id))
       do update set status = excluded.status`,
      [a, b, status],
    ),
  );
}

async function count(c: PoolClient, member: string): Promise<number | null> {
  const { rows } = await c.query<{ n: number | null }>("select public.member_pinpal_count($1) as n", [member]);
  return rows[0].n;
}

describe("member_pinpal_count", () => {
  it("counts accepted connections in either direction, and nothing else", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await fresh(c);
      expect(await count(c, USERS.seller1)).toBe(0);

      await link(c, USERS.seller1, USERS.buyer1, "accepted");
      await link(c, USERS.seller2, USERS.seller1, "accepted");
      await link(c, USERS.moderator, USERS.seller1, "pending");
      await link(c, USERS.seller1, USERS.admin, "declined");

      await as(c, USERS.buyer2);
      expect(await count(c, USERS.seller1)).toBe(2);
      // The member sees the same number on their own page.
      await as(c, USERS.seller1);
      expect(await count(c, USERS.seller1)).toBe(2);
    });
  });

  it("a stranger still can't read who the connections are", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await fresh(c);
      await link(c, USERS.seller1, USERS.buyer1, "accepted");
      await as(c, USERS.buyer2);
      const { rowCount } = await c.query(
        "select 1 from public.connections where requester_id = $1 or recipient_id = $1",
        [USERS.seller1],
      );
      expect(rowCount).toBe(0);
      expect(await count(c, USERS.seller1)).toBe(1);
    });
  });

  it("answers nothing across a block, in either direction", async () => {
    await withRole("authenticated", USERS.buyer2, async (c) => {
      await fresh(c);
      await link(c, USERS.seller1, USERS.buyer1, "accepted");
      await asService(c, () =>
        c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2) on conflict do nothing", [
          USERS.seller1,
          USERS.buyer2,
        ]),
      );
      await as(c, USERS.buyer2);
      expect(await count(c, USERS.seller1)).toBeNull();
      await as(c, USERS.seller1);
      expect(await count(c, USERS.buyer2)).toBeNull();
      // Everyone else is unaffected.
      await as(c, USERS.seller2);
      expect(await count(c, USERS.seller1)).toBe(1);
    });
  });

  it("anon can't call it", async () => {
    await withRole("anon", null, async (c) => {
      await c.query("savepoint s");
      await expect(c.query("select public.member_pinpal_count($1)", [USERS.seller1])).rejects.toThrow(/permission denied/);
      await c.query("rollback to savepoint s");
    });
  });
});
