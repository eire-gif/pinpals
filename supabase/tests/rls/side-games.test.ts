// 0196_side_games.sql — side games alongside a live round, played for
// bragging rights, points or money. PinPals keeps the tally only.
//
// Cast:
//   seller1    starts the round
//   buyer1     a PinPal of seller1, playing
//   moderator  a PinPal of seller1, playing
//   buyer2     not in the round, not connected
//
// What must hold:
//   - only whoever started the round sets them up, and only while it's live,
//     on an 18-hole round of own balls with two or more players
//   - Sixes in pairs needs exactly four players; money needs an amount
//   - money is refused while a member under 18 is playing, and a minor can't
//     agree to it
//   - changing what's played for clears everyone's "I'm in"
//   - players in the round (not outsiders) say "I'm in"
//   - payments are ticked by either player or whoever started the round
//   - everything is readable by whoever can see the round, nobody else
//   - the tables can't be written directly
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const PAL = USERS.buyer1;
const PAL2 = USERS.moderator;
const STRANGER = USERS.buyer2;

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
    for (const other of [PAL, PAL2]) {
      await c.query(
        `insert into public.connections (requester_id, recipient_id, status) values ($1, $2, 'accepted')
         on conflict (least(requester_id, recipient_id), greatest(requester_id, recipient_id)) do update set status = 'accepted'`,
        [ME, other],
      );
    }
  });
}

const p = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 12.0,
  course_handicap: 14,
  playing_handicap: 13,
  handicap_estimated: false,
});
const card18 = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));
const card9 = JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i * 2 + 1 })));

async function createRound(c: PoolClient, players = [p(ME, "Eire"), p(PAL, "Ciarán"), p(PAL2, "Niamh"), p(null, "Darragh")], holes = 18): Promise<string> {
  await as(c, ME);
  const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    JSON.stringify({ course_name: "Portmarnock Golf Club", holes, allowance: 0.95, format: "stableford" }),
    JSON.stringify(players),
    holes === 18 ? card18 : card9,
  ]);
  return rows[0].id;
}

const SET = "select public.live_round_set_side_games($1, $2::jsonb)";
const AGREE = "select public.live_round_side_games_agree($1, $2)";
const PAID = "select public.live_round_side_game_paid($1, $2, $3, $4, $5)";

const money = (extra: object = {}) =>
  JSON.stringify({ best_front: true, best_back: true, sixes: "pairs", mode: "money", stake_front: 500, stake_back: 500, stake_sixes: 500, ...extra });

const agreements = (c: PoolClient, round: string) =>
  asService(c, () =>
    c.query<{ member_id: string }>("select member_id from public.live_round_side_game_agreements where round_id = $1 order by member_id", [round]),
  ).then((r) => r.rows.map((x) => x.member_id));

const playerIds = (c: PoolClient, round: string) =>
  asService(c, () => c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 order by position", [round])).then((r) =>
    r.rows.map((x) => x.id),
  );

describe("setting up side games", () => {
  it("whoever started the round sets them up; the amounts are kept per game", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const round = await createRound(c);
      await c.query(SET, [round, money({ best_overall: true, stake_overall: 1000 })]);
      const { rows } = await c.query("select best_front, best_back, best_overall, sixes, mode, stake_front, stake_overall, stake_sixes, set_by from public.live_round_side_games where round_id = $1", [round]);
      expect(rows[0]).toMatchObject({ best_front: true, best_back: true, best_overall: true, sixes: "pairs", mode: "money", stake_front: 500, stake_overall: 1000, stake_sixes: 500, set_by: ME });
      // Setting it up counts as agreeing.
      expect(await agreements(c, round)).toEqual([ME]);
    });
  });

  it("no stakes are kept outside money mode", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const round = await createRound(c);
      await c.query(SET, [round, JSON.stringify({ best_front: true, mode: "points", stake_front: 500 })]);
      const { rows } = await c.query("select stake_front from public.live_round_side_games where round_id = $1", [round]);
      expect(rows[0].stake_front).toBe(0);
    });
  });

  it("not a player, not a stranger", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const round = await createRound(c);
      await as(c, PAL);
      await rejects(c, SET, [round, money()], /started the round/);
      await as(c, STRANGER);
      await rejects(c, SET, [round, money()], /started the round/);
    });
  });

  it("18 holes, own balls, still live; pairs needs four; money needs an amount; at least one game", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const nine = await createRound(c, [p(ME, "Eire"), p(PAL, "Ciarán")], 9);
      await rejects(c, SET, [nine, money()], /18-hole/);
      await c.query("select public.live_round_finish($1)", [nine]);

      const three = await createRound(c, [p(ME, "Eire"), p(PAL, "Ciarán"), p(PAL2, "Niamh")]);
      await rejects(c, SET, [three, money()], /exactly four/);
      await c.query(SET, [three, money({ sixes: "individual" })]);
      await c.query("select public.live_round_finish($1)", [three]);

      const round = await createRound(c);
      await rejects(c, SET, [round, money({ stake_front: 0, stake_back: 0, stake_sixes: 0 })], /amount/);
      await rejects(c, SET, [round, money({ stake_front: 60000 })], /€500/);
      await rejects(c, SET, [round, JSON.stringify({ mode: "pride" })], /at least one/);

      await c.query("select public.live_round_finish($1)", [round]);
      await rejects(c, SET, [round, money()], /finished/);
    });
  });

  it("no money while a member under 18 is playing", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const round = await createRound(c);
      await asService(c, () =>
        c.query(
          `insert into public.member_birthdates (user_id, date_of_birth) values ($1, current_date - interval '15 years')
           on conflict (user_id) do update set date_of_birth = excluded.date_of_birth`,
          [PAL2],
        ),
      );
      await as(c, ME);
      await rejects(c, SET, [round, money()], /under 18/);
      // Bragging rights are fine.
      await c.query(SET, [round, JSON.stringify({ best_front: true, mode: "pride" })]);
    });
  });

  it("turning them off removes them and the agreements", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const round = await createRound(c);
      await c.query(SET, [round, money()]);
      await c.query(SET, [round, null]);
      const { rows } = await asService(c, () => c.query("select 1 from public.live_round_side_games where round_id = $1", [round]));
      expect(rows).toHaveLength(0);
      expect(await agreements(c, round)).toEqual([]);
    });
  });
});

describe("saying you're in", () => {
  it("players agree; a change to the stakes clears everyone", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const round = await createRound(c);
      await c.query(SET, [round, money()]);
      await as(c, PAL);
      await c.query(AGREE, [round, true]);
      await as(c, PAL2);
      await c.query(AGREE, [round, true]);
      expect((await agreements(c, round)).sort()).toEqual([ME, PAL, PAL2].sort());

      // Same games again: nothing changes.
      await as(c, ME);
      await c.query(SET, [round, money()]);
      expect(await agreements(c, round)).toHaveLength(3);

      // A new amount: everyone has to say again (the setter is in by setting it).
      await c.query(SET, [round, money({ stake_front: 1000 })]);
      expect(await agreements(c, round)).toEqual([ME]);

      // And out again.
      await as(c, PAL);
      await c.query(AGREE, [round, true]);
      await c.query(AGREE, [round, false]);
      expect(await agreements(c, round)).toEqual([ME]);
    });
  });

  it("not someone who isn't playing; not when there's no money", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const round = await createRound(c);
      await c.query(SET, [round, JSON.stringify({ best_front: true, mode: "pride" })]);
      await as(c, PAL);
      await rejects(c, AGREE, [round, true], /nothing to agree/);
      await as(c, ME);
      await c.query(SET, [round, money()]);
      await as(c, STRANGER);
      await rejects(c, AGREE, [round, true], /Only players/);
    });
  });
});

describe("settling up", () => {
  it("either player or the starter ticks a payment; nobody else", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const round = await createRound(c);
      await c.query(SET, [round, money()]);
      const [eire, ciaran, niamh, darragh] = await playerIds(c, round);

      // Ciarán pays Niamh: Niamh ticks it.
      await as(c, PAL2);
      await c.query(PAID, [round, ciaran, niamh, 1000, true]);
      // A guest's payment: whoever started the round.
      await as(c, ME);
      await c.query(PAID, [round, darragh, eire, 2000, true]);
      // Niamh can't tick a payment she isn't part of.
      await as(c, PAL2);
      await rejects(c, PAID, [round, darragh, eire, 2000, false], /two players/);
      await as(c, STRANGER);
      await rejects(c, PAID, [round, ciaran, niamh, 1000, false], /two players/);

      const { rows } = await asService(c, () =>
        c.query("select from_player_id, to_player_id, amount_cents from public.live_round_side_game_payments where round_id = $1 order by amount_cents", [round]),
      );
      expect(rows).toEqual([
        { from_player_id: ciaran, to_player_id: niamh, amount_cents: 1000 },
        { from_player_id: darragh, to_player_id: eire, amount_cents: 2000 },
      ]);

      // Undo.
      await as(c, PAL);
      await c.query(PAID, [round, ciaran, niamh, 1000, false]);
      const after = await asService(c, () => c.query("select 1 from public.live_round_side_game_payments where round_id = $1", [round]));
      expect(after.rows).toHaveLength(1);

      // A player from another round is refused (and ticks still work once it's finished).
      await as(c, ME);
      await c.query("select public.live_round_finish($1)", [round]);
      const other = await createRound(c, [p(ME, "Eire"), p(PAL, "Ciarán")]);
      const [x] = await playerIds(c, other);
      await as(c, ME);
      await rejects(c, PAID, [round, x, eire, 500, true], /isn't in this round/);
    });
  });
});

describe("who can read them", () => {
  it("players in the round; not a stranger", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const round = await createRound(c);
      await c.query(SET, [round, money()]);
      await as(c, PAL);
      expect((await c.query("select 1 from public.live_round_side_games where round_id = $1", [round])).rows).toHaveLength(1);
      expect((await c.query("select 1 from public.live_round_side_game_agreements where round_id = $1", [round])).rows).toHaveLength(1);
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.live_round_side_games where round_id = $1", [round])).rows).toHaveLength(0);
      expect((await c.query("select 1 from public.live_round_side_game_agreements where round_id = $1", [round])).rows).toHaveLength(0);
    });
  });

  it("no direct writes", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const round = await createRound(c);
      await rejects(c, "insert into public.live_round_side_games (round_id, best_front) values ($1, true)", [round], /permission denied/);
      await rejects(c, "insert into public.live_round_side_game_agreements (round_id, member_id) values ($1, $2)", [round, ME], /permission denied/);
      await c.query(SET, [round, money()]);
      await rejects(c, "update public.live_round_side_games set stake_front = 1 where round_id = $1", [round], /permission denied/);
    });
  });
});
