// 0118_find_pinpals.sql — invite codes, suggestions, affinity, played-with,
// guest scorecards.
//
// What must hold:
//   - a member's invite code is theirs alone to read; the preview shows a
//     first name and club to anyone; connecting by code makes an accepted
//     connection, never across a block
//   - suggestions count mutual PinPals and rounds played together, skip
//     existing connections and anyone dismissed
//   - affinity tells you mutual PinPals without exposing the other side's list
//   - only someone in a round can invite its guest; the guest's link puts the
//     round on their profile and connects them with the sender, once
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, setIdentity, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const PAL = USERS.buyer1;
const FRIEND_OF_PAL = USERS.seller2;
const STRANGER = USERS.buyer2;

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

async function connect(c: PoolClient, a: string, b: string): Promise<void> {
  await asService(c, () =>
    c.query(
      `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
       on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
      [a, b],
    ),
  );
}

async function status(c: PoolClient, a: string, b: string): Promise<string | null> {
  const { rows } = await asService(c, () =>
    c.query<{ status: string }>(
      `select status from public.connections
        where least(requester_id, recipient_id) = least($1::uuid, $2::uuid)
          and greatest(requester_id, recipient_id) = greatest($1::uuid, $2::uuid)`,
      [a, b],
    ),
  );
  return rows[0]?.status ?? null;
}

const player = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 14.2,
  course_handicap: 19,
  playing_handicap: 18,
  handicap_estimated: false,
});

/** ME + PAL + a guest. */
async function roundWithGuest(c: PoolClient): Promise<{ roundId: string; guestId: string }> {
  await connect(c, ME, PAL);
  await setIdentity(c, ME);
  const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    JSON.stringify({ course_name: "Portmarnock Golf Club", format: "stableford", holes: 18, allowance: 0.95, course_rating: 78, slope: 143, par_total: 72 }),
    JSON.stringify([player(ME, "Eire"), player(PAL, "Ciarán"), player(null, "Mark (guest)")]),
    JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: null }))),
  ]);
  const guest = await asService(c, () =>
    c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 and member_id is null", [rows[0].id]),
  );
  return { roundId: rows[0].id, guestId: guest.rows[0].id };
}

describe("invite codes", () => {
  it("are private to their owner; preview shows a first name; connecting by code accepts the connection", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setIdentity(c, ME);
      const code = (await c.query<{ code: string }>("select public.my_invite_code() as code")).rows[0].code;
      expect(code).toMatch(/^[a-z0-9]{8}$/);
      expect((await c.query<{ code: string }>("select public.my_invite_code() as code")).rows[0].code).toBe(code);

      await setIdentity(c, STRANGER);
      expect((await c.query("select 1 from public.member_invite_codes")).rowCount).toBe(0);
      const preview = await c.query("select * from public.invite_preview($1)", [code]);
      expect(preview.rowCount).toBe(1);
      expect(Object.keys(preview.rows[0]).sort()).toEqual(["avatar_color", "avatar_url", "first_name", "home_club", "last_initial"]);

      await c.query("select public.connect_by_invite($1)", [code.toUpperCase()]);
      expect(await status(c, ME, STRANGER)).toBe("accepted");
      await rejects(c, "select public.connect_by_invite('zzzzzzzz')", [], /isn't valid/);
      await rejects(c, "insert into public.member_invite_codes (member_id, code) values ($1, 'abcdefgh')", [STRANGER], /permission denied/);
    });
  });

  it("never connects across a block", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setIdentity(c, ME);
      const code = (await c.query<{ code: string }>("select public.my_invite_code() as code")).rows[0].code;
      await asService(c, () => c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [ME, STRANGER]));
      await setIdentity(c, STRANGER);
      await rejects(c, "select public.connect_by_invite($1)", [code], /can't connect/);
    });
  });

  it("anon can preview but not connect", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setIdentity(c, ME);
      const code = (await c.query<{ code: string }>("select public.my_invite_code() as code")).rows[0].code;
      await c.query("set local role anon");
      await c.query("select set_config('request.jwt.claim.sub', '', true)");
      expect((await c.query("select * from public.invite_preview($1)", [code])).rowCount).toBe(1);
      await rejects(c, "select public.connect_by_invite($1)", [code], /permission denied/);
    });
  });
});

describe("suggestions and affinity", () => {
  it("rank mutual PinPals, skip connections and dismissals; affinity counts mutuals", async () => {
    await withRole("authenticated", ME, async (c) => {
      await connect(c, ME, PAL);
      await connect(c, PAL, FRIEND_OF_PAL);
      await setIdentity(c, ME);

      const rows = (await c.query<{ id: string; mutual_count: number; reason: string }>("select id, mutual_count, reason from public.member_suggestions(50)")).rows;
      const fop = rows.find((r) => r.id === FRIEND_OF_PAL);
      expect(fop?.mutual_count).toBe(1);
      expect(fop?.reason).toMatch(/mutual/);
      expect(rows.some((r) => r.id === PAL)).toBe(false);

      const affinity = (await c.query<{ a: { mutual_count: number; mutual: { first_name: string }[] } }>("select public.member_affinity($1) as a", [FRIEND_OF_PAL])).rows[0].a;
      expect(affinity.mutual_count).toBe(1);
      expect(affinity.mutual).toHaveLength(1);

      await c.query("select public.dismiss_member_suggestion($1)", [FRIEND_OF_PAL]);
      const after = (await c.query<{ id: string }>("select id from public.member_suggestions(50)")).rows;
      expect(after.some((r) => r.id === FRIEND_OF_PAL)).toBe(false);
      await rejects(c, "insert into public.member_suggestion_dismissals (member_id, dismissed_id) values ($1, $2)", [ME, STRANGER], /permission denied/);
    });
  });
});

describe("played with and guest scorecards", () => {
  it("lists round-mates; only a player invites the guest; the guest claims once and is connected", async () => {
    await withRole("authenticated", ME, async (c) => {
      const { roundId, guestId } = await roundWithGuest(c);

      await setIdentity(c, ME);
      const played = (await c.query<{ member_id: string | null; display_name: string; connection_status: string | null }>("select member_id, display_name, connection_status from public.played_with_me(120)")).rows;
      expect(played.find((p) => p.member_id === PAL)?.connection_status).toBe("accepted");
      expect(played.some((p) => p.member_id === null && p.display_name === "Mark (guest)")).toBe(true);

      await setIdentity(c, STRANGER);
      await rejects(c, "select public.round_guest_invite($1)", [guestId], /Only someone in that round/);

      await setIdentity(c, ME);
      const token = (await c.query<{ t: string }>("select public.round_guest_invite($1) as t", [guestId])).rows[0].t;
      expect(token).toMatch(/^[a-z0-9]{24}$/);
      expect((await c.query<{ t: string }>("select public.round_guest_invite($1) as t", [guestId])).rows[0].t).toBe(token);
      expect((await c.query<{ invited: boolean }>("select invited from public.played_with_me(120) where member_id is null")).rows[0].invited).toBe(true);

      await setIdentity(c, STRANGER);
      expect((await c.query<{ r: string }>("select public.claim_round_guest($1) as r", [token])).rows[0].r).toBe(roundId);
      const claimed = await asService(c, () => c.query<{ member_id: string }>("select member_id from public.live_round_players where id = $1", [guestId]));
      expect(claimed.rows[0].member_id).toBe(STRANGER);
      expect(await status(c, ME, STRANGER)).toBe("accepted");
      // Idempotent for the claimer, closed to everyone else.
      expect((await c.query<{ r: string }>("select public.claim_round_guest($1) as r", [token])).rows[0].r).toBe(roundId);
      await setIdentity(c, FRIEND_OF_PAL);
      await rejects(c, "select public.claim_round_guest($1)", [token], /already been claimed/);
      await rejects(c, "select * from public.round_guest_invites", [], /permission denied/);
    });
  });
});
