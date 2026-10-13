// 0132_tee_time_invitations.sql — filling an open place.
//
// Cast (a fresh round in each test, connections only):
//   seller1    hosts it
//   buyer1     has a confirmed place
//   buyer2     asked, still pending
//   seller2    not connected to the host — can't see the round until invited
//   moderator  another outsider, invited by link
//
// What must hold:
//   - the host or someone confirmed can invite; a pending or outside member can't
//   - an invited member can see a connections-only round and ask for the place
//   - nobody already in it, already asking, blocked, or the host is invited;
//     the function returns only who was newly invited
//   - a full or played round takes no invitations
//   - a link claim is the service role's only, and checks the sharer
//   - invitations are seen by the invited, the inviter and the host; no direct writes
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const HOST = USERS.seller1;
const PLAYING = USERS.buyer1;
const ASKING = USERS.buyer2;
const OUTSIDER = USERS.seller2;
const OTHER = USERS.moderator;

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

async function rejects(c: PoolClient, sql: string, params: unknown[], pattern?: RegExp): Promise<void> {
  await c.query("savepoint attempt");
  let message: string | null = null;
  try {
    await c.query(sql, params);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  await c.query("rollback to savepoint attempt");
  if (message == null) throw new Error(`Expected to be rejected: ${sql}`);
  if (pattern && !pattern.test(message)) throw new Error(`Rejected with "${message}", expected ${pattern}`);
}

/** A connections-only round: host, one confirmed, one pending; nobody else connected. */
async function round(c: PoolClient, daysAhead = 10): Promise<string> {
  return asService(c, async () => {
    for (const other of [OUTSIDER, OTHER]) {
      await c.query("delete from public.connections where (requester_id = $1 and recipient_id = $2) or (requester_id = $2 and recipient_id = $1)", [HOST, other]);
    }
    const id = (
      await c.query<{ id: string }>(
        `insert into public.tee_time_invites (member_id, club_name, county, play_date, spaces_available, status, visibility, expires_at)
         values ($1, 'The Island Golf Club', 'Dublin', current_date + $2::int, 2, 'open', 'connections', now() + interval '30 days') returning id`,
        [HOST, daysAhead]
      )
    ).rows[0].id;
    await c.query("insert into public.tee_time_interests (invite_id, member_id, status) values ($1, $2, 'confirmed'), ($1, $3, 'pending')", [id, PLAYING, ASKING]);
    return id;
  });
}

const sees = async (c: PoolClient, id: string) => (await c.query("select id from public.tee_time_invites where id = $1", [id])).rows.length === 1;
const invite = async (c: PoolClient, id: string, members: string[]) =>
  (await c.query<{ invite_to_tee_time: string }>("select * from public.invite_to_tee_time($1, $2::uuid[])", [id, members])).rows.map((r) => r.invite_to_tee_time);

describe("inviting to an open place", () => {
  it("a confirmed player invites an outsider, who can then see the round and ask", async () => {
    await withRole("authenticated", PLAYING, async (c) => {
      const id = await round(c);
      await as(c, OUTSIDER);
      expect(await sees(c, id)).toBe(false);
      await rejects(c, "insert into public.tee_time_interests (invite_id, member_id) values ($1, $2)", [id, OUTSIDER]);

      await as(c, PLAYING);
      expect(await invite(c, id, [OUTSIDER])).toEqual([OUTSIDER]);
      expect(await invite(c, id, [OUTSIDER])).toEqual([]); // once only

      await as(c, OUTSIDER);
      expect(await sees(c, id)).toBe(true);
      await c.query("insert into public.tee_time_interests (invite_id, member_id) values ($1, $2)", [id, OUTSIDER]);
    });
  });

  it("the host can too; someone pending, or outside, can't", async () => {
    await withRole("authenticated", HOST, async (c) => {
      const id = await round(c);
      expect(await invite(c, id, [OTHER])).toEqual([OTHER]);
      await as(c, ASKING);
      await rejects(c, "select * from public.invite_to_tee_time($1, $2::uuid[])", [id, [OUTSIDER]], /host or someone playing/);
      await as(c, OUTSIDER);
      await rejects(c, "select * from public.invite_to_tee_time($1, $2::uuid[])", [id, [OUTSIDER]], /host or someone playing/);
    });
  });

  it("skips the host, anyone already in or asking, yourself, and anyone blocked", async () => {
    await withRole("authenticated", PLAYING, async (c) => {
      const id = await round(c);
      await asService(c, () => c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [HOST, OTHER]));
      expect(await invite(c, id, [HOST, PLAYING, ASKING, OTHER, OUTSIDER])).toEqual([OUTSIDER]);
    });
  });

  it("a full or played round takes no invitations", async () => {
    await withRole("authenticated", HOST, async (c) => {
      const full = await round(c);
      await asService(c, () => c.query("update public.tee_time_invites set spaces_available = 0, status = 'full' where id = $1", [full]));
      await rejects(c, "select * from public.invite_to_tee_time($1, $2::uuid[])", [full, [OUTSIDER]], /full/);
      const played = await round(c, -1);
      await rejects(c, "select * from public.invite_to_tee_time($1, $2::uuid[])", [played, [OUTSIDER]], /played/);
    });
  });
});

describe("opening a shared link", () => {
  it("adds the member when the sharer can fill the round; the service role only", async () => {
    await withRole("authenticated", HOST, async (c) => {
      const id = await round(c);
      await as(c, OTHER);
      await rejects(c, "select public.tee_time_link_claim($1, $2, $3)", [id, PLAYING, OTHER], /permission denied/);

      const claim = (sharer: string, member: string) =>
        asService(c, async () => (await c.query<{ ok: boolean }>("select public.tee_time_link_claim($1, $2, $3) as ok", [id, sharer, member])).rows[0].ok);
      expect(await claim(ASKING, OTHER)).toBe(false); // a pending golfer's link isn't good
      expect(await claim(PLAYING, OTHER)).toBe(true);
      await as(c, OTHER);
      expect(await sees(c, id)).toBe(true);
      expect((await c.query("select via, invited_by from public.tee_time_invitations where invite_id = $1 and member_id = $2", [id, OTHER])).rows[0]).toEqual({ via: "link", invited_by: PLAYING });
    });
  });
});

describe("who sees invitations", () => {
  it("the invited, the inviter and the host — nobody else; no direct writes", async () => {
    await withRole("authenticated", PLAYING, async (c) => {
      const id = await round(c);
      await invite(c, id, [OUTSIDER]);
      const rows = async () => (await c.query("select member_id from public.tee_time_invitations where invite_id = $1", [id])).rows.length;
      for (const who of [PLAYING, OUTSIDER, HOST]) {
        await as(c, who);
        expect(await rows()).toBe(1);
      }
      await as(c, ASKING);
      expect(await rows()).toBe(0);
      await rejects(c, "insert into public.tee_time_invitations (invite_id, member_id, invited_by) values ($1, $2, $2)", [id, ASKING], /permission denied/);
    });
  });
});
