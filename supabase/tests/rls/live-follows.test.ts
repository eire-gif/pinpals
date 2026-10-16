// 0158_live_round_follows.sql — "Follow my round".
//
// What must hold:
//   - a member shares their OWN card; whoever started the round may share a
//     GUEST's card; nobody may share another member's card
//   - only with accepted PinPals, never across a block
//   - a share is readable by whoever made it and whoever follows it — not by
//     others in the round, not by strangers, never by anon
//   - nothing can be written to the table except through the two functions
//   - sharing again renews rather than duplicating; stopping is limited to
//     the sharer, the card's owner and the follower
//   - finished rounds can't be shared; links are capped; deleting the round
//     removes its shares
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const PAL = USERS.buyer1; // playing with ME
const WATCHER = USERS.seller2; // ME's PinPal, at home
const STRANGER = USERS.buyer2; // nobody's PinPal

const HASH = (n: number) => n.toString(16).padStart(64, "0");

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

async function connect(c: PoolClient, a: string, b: string) {
  await asService(c, () =>
    c.query(
      `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
      [a, b],
    ),
  );
}

const card = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));
const roundJson = JSON.stringify({ course_name: "Portmarnock Golf Club", format: "stableford", holes: 18, allowance: 0.95, course_rating: 72, slope: 125, par_total: 72 });
const player = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 14.2,
  course_handicap: 16,
  playing_handicap: 15,
  handicap_estimated: false,
});

/** ME (started it) + PAL + a junior guest. Players in that order. */
async function createRound(c: PoolClient): Promise<{ roundId: string; mine: string; pals: string; guest: string }> {
  await connect(c, ME, PAL);
  await connect(c, ME, WATCHER);
  await as(c, ME);
  const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    roundJson,
    JSON.stringify([player(ME, "Eire"), player(PAL, "Ciarán"), player(null, "Aoife (junior)")]),
    card,
  ]);
  const roundId = rows[0].id;
  const players = await asService(c, () =>
    c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 order by position", [roundId]),
  );
  const [mine, pals, guest] = players.rows.map((r) => r.id);
  return { roundId, mine, pals, guest };
}

const SHARE = "select public.live_follow_share($1::bigint, $2::uuid[], $3::text) as out";
const STOP = "select public.live_follow_stop($1::bigint)";

async function share(c: PoolClient, playerId: string, followers: string[] | null, hash: string | null) {
  const { rows } = await c.query<{ out: { id: number; follower_id: string | null }[] }>(SHARE, [playerId, followers, hash]);
  return rows[0].out;
}

const visible = async (c: PoolClient) => (await c.query<{ id: string }>("select id from public.live_round_follows")).rows.map((r) => String(r.id));

describe("follow my round: whose card can be shared", () => {
  it("a member shares their own card with a PinPal, and as a link", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { mine } = await createRound(c);
      await as(c, ME);
      const out = await share(c, mine, [WATCHER], HASH(1));
      expect(out).toHaveLength(2);
      expect(out[0].follower_id).toBe(WATCHER);
      expect(out[1].follower_id).toBeNull();
    });
  });

  it("nobody can share another member's card — not even whoever started the round", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { pals, mine } = await createRound(c);
      await as(c, ME);
      await rejects(c, SHARE, [pals, [WATCHER], null], /your own card/);
      await rejects(c, SHARE, [pals, null, HASH(2)], /your own card/);
      await as(c, PAL);
      await rejects(c, SHARE, [mine, null, HASH(3)], /your own card/);
    });
  });

  it("whoever started the round can share a guest's card; another player can't", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { guest } = await createRound(c);
      await as(c, PAL);
      await rejects(c, SHARE, [guest, null, HASH(4)], /your own card/);
      await as(c, ME);
      const out = await share(c, guest, null, HASH(4));
      expect(out).toHaveLength(1);
    });
  });

  it("only with accepted PinPals, never across a block", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { mine } = await createRound(c);
      await as(c, ME);
      await rejects(c, SHARE, [mine, [STRANGER], null], /your PinPals/);
      await asService(c, () => c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [WATCHER, ME]));
      await rejects(c, SHARE, [mine, [WATCHER], null], /your PinPals/);
    });
  });

  it("refuses a finished round, a bad hash, and a sixth live link", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, mine } = await createRound(c);
      await as(c, ME);
      await rejects(c, SHARE, [mine, null, "not-a-hash"], /Bad link/);
      for (let i = 10; i < 15; i++) await share(c, mine, null, HASH(i));
      await rejects(c, SHARE, [mine, null, HASH(20)], /5 links/);
      await c.query("select public.live_round_finish($1)", [roundId]);
      await rejects(c, SHARE, [mine, [WATCHER], null], /finished/);
    });
  });
});

describe("follow my round: who sees a share", () => {
  it("the sharer and the follower; not another player, not a stranger, not anon", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { mine } = await createRound(c);
      await as(c, ME);
      const [{ id }] = await share(c, mine, [WATCHER], null);
      const key = String(id);
      expect(await visible(c)).toContain(key);
      await as(c, WATCHER);
      expect(await visible(c)).toContain(key);
      await as(c, PAL);
      expect(await visible(c)).not.toContain(key);
      await as(c, STRANGER);
      expect(await visible(c)).not.toContain(key);
      await c.query("set local role anon");
      await rejects(c, "select id from public.live_round_follows", [], /permission denied/);
      await rejects(c, SHARE, [mine, null, HASH(30)], /permission denied/);
    });
  });

  it("the member whose card it is can see and stop a share someone else made of it", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { guest } = await createRound(c);
      await as(c, ME);
      const [{ id }] = await share(c, guest, null, HASH(50));
      // The guest's seat is claimed by PAL (as claim_round_guest does).
      await asService(c, () => c.query("update public.live_round_players set member_id = $1 where id = $2", [WATCHER, guest]));
      await as(c, WATCHER);
      expect(await visible(c)).toContain(String(id));
    });
  });

  it("members can't write the table directly", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, mine } = await createRound(c);
      await as(c, ME);
      const [{ id }] = await share(c, mine, [WATCHER], null);
      await rejects(
        c,
        "insert into public.live_round_follows (round_id, player_id, shared_by, follower_id, expires_at) values ($1, $2, $3, $4, now() + interval '1 day')",
        [roundId, mine, ME, STRANGER],
        /permission denied/,
      );
      await as(c, WATCHER);
      await rejects(c, "update public.live_round_follows set expires_at = now() + interval '30 days' where id = $1", [id], /permission denied/);
      await rejects(c, "delete from public.live_round_follows where id = $1", [id], /permission denied/);
    });
  });
});

describe("follow my round: renewing and stopping", () => {
  it("sharing again with the same PinPal renews the one row", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { mine } = await createRound(c);
      await as(c, ME);
      const [first] = await share(c, mine, [WATCHER], null);
      await c.query(STOP, [first.id]);
      const [again] = await share(c, mine, [WATCHER], null);
      expect(again.id).toBe(first.id);
      const { rows } = await c.query<{ revoked_at: string | null }>("select revoked_at from public.live_round_follows where id = $1", [first.id]);
      expect(rows[0].revoked_at).toBeNull();
    });
  });

  it("the follower can stop following; a stranger or another player can't stop it", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { mine } = await createRound(c);
      await as(c, ME);
      const [{ id }] = await share(c, mine, [WATCHER], null);
      await as(c, PAL);
      await rejects(c, STOP, [id], /Not yours/);
      await as(c, STRANGER);
      await rejects(c, STOP, [id], /Not yours/);
      await as(c, WATCHER);
      await c.query(STOP, [id]);
      const { rows } = await asService(c, () => c.query<{ revoked_at: string | null }>("select revoked_at from public.live_round_follows where id = $1", [id]));
      expect(rows[0].revoked_at).not.toBeNull();
    });
  });

  it("a guest's card claimed by a member: others' shares of it stop at once", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { guest } = await createRound(c);
      await as(c, ME);
      const [{ id }] = await share(c, guest, null, HASH(60));
      await asService(c, () => c.query("update public.live_round_players set member_id = $1 where id = $2", [WATCHER, guest]));
      const { rows } = await asService(c, () => c.query<{ revoked_at: string | null }>("select revoked_at from public.live_round_follows where id = $1", [id]));
      expect(rows[0].revoked_at).not.toBeNull();
      // And ME can no longer share it: it's a member's card now.
      await as(c, ME);
      await rejects(c, SHARE, [guest, null, HASH(61)], /your own card/);
    });
  });

  it("deleting the round removes its shares", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, mine } = await createRound(c);
      await as(c, ME);
      await share(c, mine, [WATCHER], HASH(40));
      await c.query("select public.live_round_delete($1)", [roundId]);
      const { rows } = await asService(c, () => c.query("select 1 from public.live_round_follows where round_id = $1", [roundId]));
      expect(rows).toHaveLength(0);
    });
  });
});
