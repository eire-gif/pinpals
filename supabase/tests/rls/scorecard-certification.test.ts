// 0128_scorecard_certification.sql — a playing partner certifies a card.
//
// Cast:
//   seller1  owns the card
//   buyer1   played the live round with them (and is an accepted PinPal)
//   buyer2   a stranger: signed in, didn't play, not connected
//   seller2  an accepted PinPal whom seller1 has blocked
//
// What must hold:
//   - only someone who played the round (live card) or an accepted PinPal
//     (typed-in card) can be asked; never a stranger, never across a block
//   - a live round must be finished first
//   - only the certifier can answer; certifying needs a valid HMAC from the
//     certifier's own key over the request's challenge and card hash
//   - changing the card voids the certificate; changing who can see it doesn't
//   - card viewers see only a CERTIFIED row; never the challenge or hash;
//     nobody reads the keys; nothing is written directly
import { createHmac } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const PAL = USERS.buyer1;
const STRANGER = USERS.buyer2;
const BLOCKED_PAL = USERS.seller2;

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

async function setUp(c: PoolClient): Promise<void> {
  await asService(c, async () => {
    for (const [a, b] of [
      [ME, PAL],
      [ME, BLOCKED_PAL],
    ]) {
      await c.query(
        `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
         on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
        [a, b],
      );
    }
    await c.query(`insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2) on conflict do nothing`, [ME, BLOCKED_PAL]);
  });
}

const today = () => new Date().toISOString().slice(0, 10);
const card = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ course_name: "Portmarnock Golf Club", tee_name: "Blue", holes: 9, played_on: today(), par_total: 36, visibility: "members", ...over });
const holes = (strokes: number | null = 5) =>
  JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1, yards: 400, strokes })));
const SAVE = "select public.scorecard_save($1, $2::jsonb, $3::jsonb) as id";

/** A card typed in by hand, owned by ME. */
async function manualCard(c: PoolClient, over: Record<string, unknown> = {}): Promise<string> {
  await as(c, ME);
  return (await c.query<{ id: string }>(SAVE, [null, card(over), holes()])).rows[0].id;
}

/** A finished (or not) 9-hole live round ME and PAL played; ME's card from it. */
async function liveCard(c: PoolClient, finish = true): Promise<{ cardId: string; roundId: string }> {
  // 0157: one open game per player — earlier ones in the test are aged out.
  await asService(c, () => c.query("update public.live_rounds set created_at = now() - interval '9 hours' where status = 'live'"));
  await as(c, ME);
  const player = (memberId: string | null, name: string) => ({
    member_id: memberId, name, handicap_index: 12.4, course_handicap: 15, playing_handicap: 14, handicap_estimated: false,
  });
  const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    JSON.stringify({ course_name: "Portmarnock Golf Club", tee_name: "Blue", format: "stableford", holes: 9, allowance: 0.95 }),
    JSON.stringify([player(ME, "Eire"), player(PAL, "Ciarán")]),
    JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 }))),
  ]);
  const roundId = rows[0].id;
  const players = await asService(c, () =>
    c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 order by position", [roundId]),
  );
  for (let h = 1; h <= 9; h++) {
    await c.query("select public.live_round_set_score($1, $2, $3::smallint, 5::smallint)", [roundId, players.rows[0].id, h]);
  }
  if (finish) await c.query("select public.live_round_finish($1)", [roundId]);
  const cardId = (await c.query<{ id: string }>("select public.scorecard_from_live_round($1) as id", [roundId])).rows[0].id;
  return { cardId, roundId };
}

async function ask(c: PoolClient, cardId: string, who: string): Promise<string> {
  await as(c, ME);
  return (await c.query<{ id: string }>("select public.scorecard_certify_request($1, $2) as id", [cardId, who])).rows[0].id;
}

type Opened = { status: string; role: string; challenge: string | null; card_hash: string | null; hole_list: unknown[] };
async function open(c: PoolClient, who: string, reqId: string): Promise<Opened> {
  await as(c, who);
  return (await c.query<{ o: Opened }>("select public.scorecard_certification_open($1) as o", [reqId])).rows[0].o;
}

/** Set up a phone: register, then confirm (as the app does once the secret is stored). */
async function registerKey(c: PoolClient, who: string, confirm = true): Promise<{ key_id: string; secret: string }> {
  await as(c, who);
  const k = (await c.query<{ k: { key_id: string; secret: string } }>("select public.scorecard_certify_key_register('ios') as k")).rows[0].k;
  if (confirm) await c.query("select public.scorecard_certify_key_confirm($1)", [k.key_id]);
  return k;
}

const sign = (secret: string, reqId: string, challenge: string, hash: string) =>
  createHmac("sha256", Buffer.from(secret, "hex")).update(`pinpals-certify:v1:${reqId}:${challenge}:${hash}`).digest("hex");

const CERTIFY = "select public.scorecard_certify($1, $2, $3, $4)";

/** PAL certifies the request properly. */
async function certify(c: PoolClient, reqId: string): Promise<void> {
  const key = await registerKey(c, PAL);
  const o = await open(c, PAL, reqId);
  await c.query(CERTIFY, [reqId, key.key_id, sign(key.secret, reqId, o.challenge!, o.card_hash!), "face_id"]);
}

const statusOf = async (c: PoolClient, reqId: string) =>
  (await asService(c, () => c.query<{ status: string }>("select status from public.scorecard_certifications where id = $1", [reqId]))).rows[0]
    .status;

describe("scorecard certification: who can be asked", () => {
  it("live card: only someone who played the round, and only once it's finished", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const live = await liveCard(c, false);
      await as(c, ME);
      await rejects(c, "select public.scorecard_certify_request($1, $2)", [live.cardId, PAL], /Finish the round first/);

      const done = await liveCard(c, true);
      await as(c, ME);
      const cands = await c.query<{ member_id: string; played_in_round: boolean }>(
        "select member_id, played_in_round from public.scorecard_certify_candidates($1)",
        [done.cardId],
      );
      expect(cands.rows).toEqual([{ member_id: PAL, played_in_round: true }]);
      // A PinPal who didn't play, a stranger, yourself: no.
      await rejects(c, "select public.scorecard_certify_request($1, $2)", [done.cardId, STRANGER], /played the round with you/);
      await rejects(c, "select public.scorecard_certify_request($1, $2)", [done.cardId, ME], /played the round with you/);
      expect(await ask(c, done.cardId, PAL)).toBeTruthy();

      // Someone else can't ask about my card, or list candidates for it.
      await as(c, PAL);
      await rejects(c, "select public.scorecard_certify_request($1, $2)", [done.cardId, ME], /isn't yours/);
      expect((await c.query("select * from public.scorecard_certify_candidates($1)", [done.cardId])).rowCount).toBe(0);
    });
  });

  it("typed-in card: an accepted PinPal, never a stranger or a blocked PinPal; not an old round", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await manualCard(c);
      await as(c, ME);
      const cands = await c.query<{ member_id: string }>("select member_id from public.scorecard_certify_candidates($1)", [id]);
      expect(cands.rows.map((r) => r.member_id)).toEqual([PAL]);
      await rejects(c, "select public.scorecard_certify_request($1, $2)", [id, STRANGER], /played the round with you/);
      await rejects(c, "select public.scorecard_certify_request($1, $2)", [id, BLOCKED_PAL], /played the round with you/);
      expect(await ask(c, id, PAL)).toBeTruthy();

      const old = await manualCard(c, { played_on: "2026-01-04" });
      await rejects(c, "select public.scorecard_certify_request($1, $2)", [old, PAL], /14 days/);
      const blank = (await c.query<{ id: string }>(SAVE, [null, card(), holes(null)])).rows[0].id;
      await rejects(c, "select public.scorecard_certify_request($1, $2)", [blank, PAL], /Put your scores in/);
    });
  });
});

describe("scorecard certification: answering", () => {
  it("certifies with a valid signature from the certifier's own key, and only that", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { cardId } = await liveCard(c);
      const req = await ask(c, cardId, PAL);

      // The owner sees the request but never the challenge; strangers can't open it.
      const mine = await open(c, ME, req);
      expect(mine).toMatchObject({ status: "pending", role: "owner", challenge: null, card_hash: null });
      expect(mine.hole_list).toHaveLength(9);
      await as(c, STRANGER);
      await rejects(c, "select public.scorecard_certification_open($1)", [req], /isn't available/);

      const palKey = await registerKey(c, PAL);
      const strangerKey = await registerKey(c, STRANGER);
      const o = await open(c, PAL, req);
      expect(o.role).toBe("certifier");
      expect(o.challenge).toMatch(/^[0-9a-f]{32}$/);
      const good = sign(palKey.secret, req, o.challenge!, o.card_hash!);

      await as(c, PAL);
      await rejects(c, CERTIFY, [req, palKey.key_id, "00".repeat(32), "face_id"], /didn't verify/);
      await rejects(c, CERTIFY, [req, palKey.key_id, sign(strangerKey.secret, req, o.challenge!, o.card_hash!), "face_id"], /didn't verify/);
      // An unconfirmed key can't sign.
      const unconfirmed = await registerKey(c, PAL, false);
      await rejects(c, CERTIFY, [req, unconfirmed.key_id, sign(unconfirmed.secret, req, o.challenge!, o.card_hash!), "face_id"], /setting up again/);
      // Someone else's key, even with its correct signature.
      await rejects(c, CERTIFY, [req, strangerKey.key_id, sign(strangerKey.secret, req, o.challenge!, o.card_hash!), "face_id"], /setting up again/);
      await rejects(c, CERTIFY, [req, palKey.key_id, good, "retina"], /Unknown way/);
      // The owner can't certify their own card, signature or not.
      await as(c, ME);
      await rejects(c, CERTIFY, [req, palKey.key_id, good, "face_id"], /isn't for you/);

      await as(c, PAL);
      await c.query(CERTIFY, [req, palKey.key_id, good, "face_id"]);
      expect(await statusOf(c, req)).toBe("certified");
      // Once only.
      await rejects(c, CERTIFY, [req, palKey.key_id, good, "face_id"], /already been answered/);

      const row = await asService(c, () =>
        c.query<{ method: string; certifier_name: string }>("select method, certifier_name from public.scorecard_certifications where id = $1", [req]),
      );
      expect(row.rows[0].method).toBe("face_id");
    });
  });

  it("'in app' needs no key and records that; a revoked key no longer works", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await manualCard(c);
      const req = await ask(c, id, PAL);
      await as(c, PAL);
      await rejects(c, CERTIFY, [req, null, "ab", "in_app"], /Unknown way/);
      await c.query(CERTIFY, [req, null, null, "in_app"]);
      expect(await statusOf(c, req)).toBe("certified");

      // Set-ups cancelled half way (never confirmed) retire nothing…
      const first = await registerKey(c, PAL);
      for (let i = 0; i < 6; i++) await registerKey(c, PAL, false);
      const revoked = async (id: string) =>
        (await asService(c, () => c.query<{ r: boolean }>("select revoked_at is not null as r from public.scorecard_certify_keys where id = $1", [id]))).rows[0].r;
      expect(await revoked(first.key_id)).toBe(false);
      // …a sixth confirmed phone retires the oldest.
      for (let i = 0; i < 5; i++) await registerKey(c, PAL);
      expect(await revoked(first.key_id)).toBe(true);
      // Someone else can't confirm your key.
      const mine = await registerKey(c, PAL, false);
      await as(c, STRANGER);
      await rejects(c, "select public.scorecard_certify_key_confirm($1)", [mine.key_id], /setting up again/);
    });
  });

  it("a query goes back to the owner with the hole and note; a decline closes it", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await manualCard(c);
      const req = await ask(c, id, PAL);
      await as(c, PAL);
      await rejects(c, "select public.scorecard_certification_query($1, 12::smallint, 'x')", [req], /Pick the hole/);
      await c.query("select public.scorecard_certification_query($1, 7::smallint, '  I had you as a 6  ')", [req]);
      await as(c, ME);
      const q = await c.query<{ status: string; query_hole: number; query_note: string }>(
        "select status, query_hole, query_note from public.scorecard_certifications where id = $1",
        [req],
      );
      expect(q.rows[0]).toEqual({ status: "queried", query_hole: 7, query_note: "I had you as a 6" });
      // Someone who can see the card (it's "All members") doesn't see the query.
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.scorecard_certifications where id = $1", [req])).rowCount).toBe(0);

      // Fix it and ask again: the query is closed, a new request opens.
      const again = await ask(c, id, PAL);
      expect(await statusOf(c, req)).toBe("cancelled");
      await as(c, PAL);
      await c.query("select public.scorecard_certification_decline($1)", [again]);
      expect(await statusOf(c, again)).toBe("declined");
      await rejects(c, "select public.scorecard_certification_decline($1)", [again], /already been answered/);
      // Having been asked isn't a lasting window onto the card: once it's
      // answered (not certified), the certifier no longer gets the card.
      const closed = (await open(c, PAL, again)) as Opened & { card: unknown };
      expect(closed.status).toBe("declined");
      expect(closed.card).toBeNull();
      expect(closed.hole_list).toBeNull();
    });
  });

  it("an expired request can't be certified", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await manualCard(c);
      const req = await ask(c, id, PAL);
      const key = await registerKey(c, PAL);
      const o = await open(c, PAL, req);
      await asService(c, () => c.query("update public.scorecard_certifications set expires_at = now() - interval '1 minute' where id = $1", [req]));
      expect((await open(c, PAL, req)).status).toBe("expired");
      await as(c, PAL);
      await rejects(c, CERTIFY, [req, key.key_id, sign(key.secret, req, o.challenge!, o.card_hash!), "face_id"], /expired/);
    });
  });
});

describe("scorecard certification: blocks and limits", () => {
  it("a block after asking shuts the certifier out", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await manualCard(c);
      const req = await ask(c, id, PAL);
      await asService(c, () => c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [ME, PAL]));
      await as(c, PAL);
      await rejects(c, "select public.scorecard_certification_open($1)", [req], /isn't available/);
      await rejects(c, "select public.scorecard_certification_query($1, 1::smallint, 'x')", [req], /isn't available/);
      expect((await c.query("select * from public.my_certification_requests()")).rowCount).toBe(0);
    });
  });

  it("re-asking the same card is capped at five a day", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await manualCard(c);
      for (let i = 0; i < 5; i++) await ask(c, id, PAL);
      await rejects(c, "select public.scorecard_certify_request($1, $2)", [id, PAL], /a lot of requests/);
    });
  });
});

describe("scorecard certification: the card can't change under it", () => {
  it("an edit to the scores voids it; changing who can see the card doesn't", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await manualCard(c);
      const req = await ask(c, id, PAL);
      await certify(c, req);

      await as(c, ME);
      await c.query(SAVE, [id, card({ visibility: "private" }), holes()]);
      expect(await statusOf(c, req)).toBe("certified");
      await rejects(c, "select public.scorecard_certify_request($1, $2)", [id, PAL], /already certified/);

      await c.query(SAVE, [id, card(), holes(4)]);
      expect(await statusOf(c, req)).toBe("void");
      // …and it can be asked again.
      const again = await ask(c, id, PAL);
      await certify(c, again);
      // The slope counts too: it changes the handicap differential.
      await as(c, ME);
      await c.query(SAVE, [id, card({ slope: 140 }), holes(4)]);
      expect(await statusOf(c, again)).toBe("void");
    });
  });

  it("a pending request voids too, and then can't be certified", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await manualCard(c);
      const req = await ask(c, id, PAL);
      const key = await registerKey(c, PAL);
      const o = await open(c, PAL, req);
      await as(c, ME);
      await c.query(SAVE, [id, card(), holes(3)]);
      expect(await statusOf(c, req)).toBe("void");
      await as(c, PAL);
      await rejects(c, CERTIFY, [req, key.key_id, sign(key.secret, req, o.challenge!, o.card_hash!), "face_id"], /changed after they asked/);
    });
  });
});

describe("scorecard certification: reading and writing", () => {
  it("card viewers see the certificate but never the challenge or hash; nobody reads keys; no direct writes", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await manualCard(c); // "All members"
      const req = await ask(c, id, PAL);
      await as(c, STRANGER);
      // Pending: not the stranger's business.
      expect((await c.query("select 1 from public.scorecard_certifications where id = $1", [req])).rowCount).toBe(0);
      await certify(c, req);
      await as(c, STRANGER);
      const seen = await c.query<{ certifier_name: string; method: string }>(
        "select certifier_name, method from public.scorecard_certifications where id = $1",
        [req],
      );
      expect(seen.rows[0].method).toBe("face_id");
      await rejects(c, "select challenge from public.scorecard_certifications where id = $1", [req], /permission denied/);
      await rejects(c, "select card_hash from public.scorecard_certifications where id = $1", [req], /permission denied/);
      // A blocked member doesn't see the card, so doesn't see the badge.
      await as(c, BLOCKED_PAL);
      expect((await c.query("select 1 from public.scorecard_certifications where id = $1", [req])).rowCount).toBe(0);

      await as(c, PAL);
      await rejects(c, "select * from public.scorecard_certify_keys", [], /permission denied/);
      await as(c, ME);
      await rejects(c, "update public.scorecard_certifications set status = 'certified' where id = $1", [req], /permission denied/);
      await rejects(
        c,
        "insert into public.scorecard_certifications (scorecard_id, owner_id, certifier_name, card_hash, challenge) values ($1, $2, 'x', repeat('a', 64), repeat('b', 32))",
        [id, ME],
        /permission denied/,
      );
      await rejects(c, "select public.scorecard_card_hash($1)", [id], /permission denied/);

      await c.query("set local role anon");
      await rejects(c, "select 1 from public.scorecard_certifications", [], /permission denied/);
    });
  });

  it("lists requests waiting for me; a deleted certifier becomes 'Former member'", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const id = await manualCard(c);
      const req = await ask(c, id, PAL);
      await as(c, PAL);
      const waiting = await c.query<{ id: string; course_name: string }>("select id, course_name from public.my_certification_requests()");
      expect(waiting.rows).toEqual([{ id: req, course_name: "Portmarnock Golf Club" }]);
      await as(c, STRANGER);
      expect((await c.query("select * from public.my_certification_requests()")).rowCount).toBe(0);

      await certify(c, req);
      // The FK's ON DELETE SET NULL is an UPDATE of the row: same trigger path.
      await asService(c, () => c.query("update public.scorecard_certifications set certifier_id = null where id = $1", [req]));
      const after = await asService(c, () =>
        c.query<{ certifier_name: string }>("select certifier_name from public.scorecard_certifications where id = $1", [req]),
      );
      expect(after.rows[0].certifier_name).toBe("Former member");
    });
  });
});
