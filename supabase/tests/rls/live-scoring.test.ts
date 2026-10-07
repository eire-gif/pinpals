// 0103_live_scoring.sql — live rounds and saved course cards.
//
// Cast:
//   seller1  starts the rounds
//   buyer1   an accepted PinPal of seller1, added as a player
//   seller2  an accepted PinPal whom seller1 has blocked
//   buyer2   a stranger: no connection to anyone here
//
// What must hold:
//   - only the starter and member players can read a round, its card and scores
//   - nothing is written except through the live_round_* / course_card_save
//     functions, which check membership
//   - you can add yourself, accepted PinPals and guests, never a stranger or
//     anyone across a block
//   - finished rounds are frozen; a deleted member's name leaves old boards
//   - broadcasts on live-round-<id> reach only people in the round, and a
//     broadcast that fails (no realtime.send locally) never fails the write
//   - course cards: anyone signed in reads; a member can't overwrite someone
//     else's card or a verified one
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const PAL = USERS.buyer1;
const BLOCKED_PAL = USERS.seller2;
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

/** Expects a statement to fail, without aborting the surrounding transaction. */
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
    await c.query(
      `insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2) on conflict do nothing`,
      [ME, BLOCKED_PAL],
    );
  });
}

const card = (holes: number, withSI = false) =>
  JSON.stringify(Array.from({ length: holes }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: withSI ? i + 1 : null })));

const round = (format = "stableford", holes = 18) =>
  JSON.stringify({ course_name: "Portmarnock Golf Club", format, holes, allowance: format === "matchplay" ? 1 : 0.95, course_rating: 78, slope: 143, par_total: 72 });

const player = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 14.2,
  course_handicap: 19,
  playing_handicap: 18,
  handicap_estimated: false,
});

/** seller1 + buyer1 + a guest. Returns the round id and the three player ids. */
async function createRound(c: PoolClient): Promise<{ roundId: string; players: string[] }> {
  await as(c, ME);
  const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    round(),
    JSON.stringify([player(ME, "Eire"), player(PAL, "Ciarán"), player(null, "Seán (guest)")]),
    card(18),
  ]);
  const roundId = rows[0].id;
  const players = await asService(c, () =>
    c.query<{ id: string }>("select id from public.live_round_players where round_id = $1 order by position", [roundId]),
  );
  return { roundId, players: players.rows.map((r) => r.id) };
}

describe("live rounds: who can see them", () => {
  it("the starter and member players read the round, players, card and scores; a stranger and anon see nothing", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { roundId, players } = await createRound(c);
      await c.query("select public.live_round_set_score($1, $2, 1::smallint, 5::smallint)", [roundId, players[0]]);

      for (const who of [ME, PAL]) {
        await as(c, who);
        expect((await c.query("select 1 from public.live_rounds where id = $1", [roundId])).rowCount).toBe(1);
        expect((await c.query("select 1 from public.live_round_players where round_id = $1", [roundId])).rowCount).toBe(3);
        expect((await c.query("select 1 from public.live_round_holes where round_id = $1", [roundId])).rowCount).toBe(18);
        expect((await c.query("select 1 from public.live_round_scores where round_id = $1", [roundId])).rowCount).toBe(1);
      }

      await as(c, STRANGER);
      expect((await c.query("select 1 from public.live_rounds where id = $1", [roundId])).rowCount).toBe(0);
      expect((await c.query("select 1 from public.live_round_players where round_id = $1", [roundId])).rowCount).toBe(0);
      expect((await c.query("select 1 from public.live_round_scores where round_id = $1", [roundId])).rowCount).toBe(0);

      await c.query("set local role anon");
      await rejects(c, "select 1 from public.live_rounds", []);
    });
  });
});

describe("live rounds: who can be added", () => {
  it("refuses a stranger and a blocked PinPal", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      for (const who of [STRANGER, BLOCKED_PAL]) {
        await rejects(
          c,
          "select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb)",
          [round(), JSON.stringify([player(ME, "Eire"), player(who, "Someone")]), card(18)],
          /yourself, your PinPals, or guests/,
        );
      }
    });
  });

  it("checks the shape: matchplay is two players, the card has every hole", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      await rejects(
        c,
        "select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb)",
        [round("matchplay"), JSON.stringify([player(ME, "Eire"), player(PAL, "Ciarán"), player(null, "Guest")]), card(18)],
        /two players/,
      );
      await rejects(
        c,
        "select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb)",
        [round(), JSON.stringify([player(ME, "Eire")]), card(9)],
        /one entry for each hole/,
      );
    });
  });

  it("stops at five rounds in play", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      await as(c, ME);
      for (let i = 0; i < 5; i++) {
        await c.query("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb)", [round(), JSON.stringify([player(ME, "Eire")]), card(18)]);
      }
      await rejects(
        c,
        "select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb)",
        [round(), JSON.stringify([player(ME, "Eire")]), card(18)],
        /5 rounds in play/,
      );
    });
  });
});

describe("live rounds: writing scores and the card", () => {
  it("a player marks for anyone in the group; picked up is null; clear removes", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { roundId, players } = await createRound(c);
      await as(c, PAL);
      await c.query("select public.live_round_set_score($1, $2, 3::smallint, 6::smallint)", [roundId, players[2]]);
      await c.query("select public.live_round_set_score($1, $2, 3::smallint, 5::smallint)", [roundId, players[2]]);
      await c.query("select public.live_round_set_score($1, $2, 4::smallint, null)", [roundId, players[2]]);
      const { rows } = await c.query<{ hole: number; strokes: number | null; entered_by: string }>(
        "select hole, strokes, entered_by from public.live_round_scores where player_id = $1 order by hole",
        [players[2]],
      );
      expect(rows).toEqual([
        { hole: 3, strokes: 5, entered_by: PAL },
        { hole: 4, strokes: null, entered_by: PAL },
      ]);
      await c.query("select public.live_round_set_score($1, $2, 4::smallint, null, true)", [roundId, players[2]]);
      expect((await c.query("select 1 from public.live_round_scores where player_id = $1", [players[2]])).rowCount).toBe(1);
    });
  });

  it("a stranger can't score or edit the card; a player can fix par and stroke index", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { roundId, players } = await createRound(c);
      await as(c, STRANGER);
      await rejects(c, "select public.live_round_set_score($1, $2, 1::smallint, 4::smallint)", [roundId, players[0]], /Not your round/);
      await rejects(c, "select public.live_round_set_hole($1, 1::smallint, 5::smallint, 1::smallint)", [roundId], /Not your round/);

      await as(c, PAL);
      await c.query("select public.live_round_set_hole($1, 1::smallint, 5::smallint, 7::smallint)", [roundId]);
      const { rows } = await c.query("select par, stroke_index from public.live_round_holes where round_id = $1 and hole = 1", [roundId]);
      expect(rows[0]).toEqual({ par: 5, stroke_index: 7 });
    });
  });

  it("refuses a player or hole from outside the round", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const a = await createRound(c);
      const b = await createRound(c);
      await as(c, ME);
      await rejects(c, "select public.live_round_set_score($1, $2, 1::smallint, 4::smallint)", [a.roundId, b.players[0]], /not in this round/);
      await rejects(c, "select public.live_round_set_score($1, $2, 19::smallint, 4::smallint)", [a.roundId, a.players[0]], /No such hole/);
    });
  });

  it("no direct writes to any of the tables", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { roundId, players } = await createRound(c);
      await as(c, ME);
      await rejects(c, "insert into public.live_round_scores (player_id, hole, round_id, strokes) values ($1, 2, $2, 3)", [players[0], roundId], /permission denied/);
      await rejects(c, "update public.live_rounds set status = 'finished' where id = $1", [roundId], /permission denied/);
      await rejects(c, "delete from public.live_round_players where round_id = $1", [roundId], /permission denied/);
      await rejects(c, "insert into public.live_rounds (course_name, format, allowance) values ('x', 'stroke', 1)", [], /permission denied/);
    });
  });

  it("a finished round is frozen", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { roundId, players } = await createRound(c);
      await as(c, PAL);
      await c.query("select public.live_round_finish($1)", [roundId]);
      expect((await c.query("select status from public.live_rounds where id = $1", [roundId])).rows[0].status).toBe("finished");
      await rejects(c, "select public.live_round_set_score($1, $2, 1::smallint, 4::smallint)", [roundId, players[0]], /finished/);
      await rejects(c, "select public.live_round_set_hole($1, 1::smallint, 4::smallint, 1::smallint)", [roundId], /finished/);
    });
  });

  it("a member who leaves PinPals becomes 'Former member' on old boards", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { players } = await createRound(c);
      // What `on delete set null` does when the profile goes.
      await asService(c, () => c.query("update public.live_round_players set member_id = null where id = $1", [players[1]]));
      const { rows } = await asService(c, () => c.query("select display_name from public.live_round_players where id = $1", [players[1]]));
      expect(rows[0].display_name).toBe("Former member");
    });
  });
});

describe("live rounds: broadcasts", () => {
  it("a live-round topic is readable only by people in the round", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { roundId } = await createRound(c);
      await asService(c, () =>
        c.query("insert into realtime.messages (topic, extension, event, private) values ($1, 'broadcast', 'changed', true)", [`live-round-${roundId}`]),
      );
      const read = () => c.query("select 1 from realtime.messages where topic = $1", [`live-round-${roundId}`]);
      await as(c, PAL);
      expect((await read()).rowCount).toBe(1);
      await as(c, STRANGER);
      expect((await read()).rowCount).toBe(0);
    });
  });
});

describe("course cards", () => {
  async function club(c: PoolClient): Promise<string> {
    const { rows } = await asService(c, () =>
      c.query<{ id: string }>("insert into public.clubs (name, slug, country) values ('Test Links', 'test-links-' || gen_random_uuid(), 'ireland') returning id"),
    );
    return rows[0].id;
  }
  const save = (c: PoolClient, clubId: string, cardJson: string, tee = "White") =>
    c.query("select public.course_card_save($1, $2, 18::smallint, 72::smallint, 74.6, 134::smallint, $3::jsonb) as id", [clubId, tee, cardJson]);

  it("saves a complete card that any member can read, and refuses a card with repeated stroke indexes", async () => {
    await withRole("authenticated", ME, async (c) => {
      const clubId = await club(c);
      await as(c, ME);
      const bad = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: 1 })));
      await rejects(c, "select public.course_card_save($1, 'White', 18::smallint, 72::smallint, null, null, $2::jsonb)", [clubId, bad], /own stroke index/);
      await save(c, clubId, card(18, true));

      await as(c, STRANGER);
      const { rows } = await c.query(
        "select cc.source, cc.submitted_by, count(h.*)::int as holes from public.course_cards cc join public.course_card_holes h on h.card_id = cc.id where cc.club_id = $1 group by cc.id",
        [clubId],
      );
      expect(rows).toEqual([{ source: "member", submitted_by: ME, holes: 18 }]);
    });
  });

  it("only the member who saved an unverified card can correct it; nobody overwrites a verified one", async () => {
    await withRole("authenticated", ME, async (c) => {
      const clubId = await club(c);
      await as(c, ME);
      const { rows } = await save(c, clubId, card(18, true));
      // Same tees, different case: still the same card.
      await save(c, clubId, card(18, true), "white");

      // Someone else's card for these tees, but a different one: refused.
      const different = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: 18 - i })));
      await as(c, STRANGER);
      await rejects(c, "select public.course_card_save($1, 'White', 18::smallint, 72::smallint, null, null, $2::jsonb)", [clubId, different], /different card .* already on file/);
      // The same card again from someone else (0106, Adare Manor): a quiet yes, nothing changes hands.
      const again = await c.query("select public.course_card_save($1, 'White', 18::smallint, 72::smallint, null, null, $2::jsonb) as id", [clubId, card(18, true)]);
      expect(again.rows[0].id).toBe(rows[0].id);
      const owner = await asService(c, () => c.query("select submitted_by, course_rating::text from public.course_cards where id = $1", [rows[0].id]));
      expect(owner.rows[0]).toEqual({ submitted_by: ME, course_rating: "74.6" });

      await asService(c, () => c.query("update public.course_cards set verified_at = now() where id = $1", [rows[0].id]));
      await as(c, ME);
      await rejects(c, "select public.course_card_save($1, 'White', 18::smallint, 72::smallint, null, null, $2::jsonb)", [clubId, different], /already on file/);
    });
  });

  it("no direct writes", async () => {
    await withRole("authenticated", ME, async (c) => {
      const clubId = await club(c);
      await as(c, ME);
      await rejects(c, "insert into public.course_cards (club_id, tee_name, holes) values ($1, 'Blue', 18)", [clubId], /permission denied/);
    });
  });
});

// 0105 — fixes from the first tester rounds.
describe("live rounds: one hole per stroke index, and deleting", () => {
  it("refuses a stroke index that's already on another hole; re-saving the same hole is fine", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { roundId } = await createRound(c);
      const setHole = "select public.live_round_set_hole($1, $2::smallint, 4::smallint, $3::smallint)";
      await c.query(setHole, [roundId, 1, 13]);
      await c.query(setHole, [roundId, 1, 13]); // same hole again
      await rejects(c, setHole, [roundId, 2, 13], /Stroke index 13 is already on hole 1/);
      await c.query(setHole, [roundId, 1, 7]); // move hole 1 off 13…
      await c.query(setHole, [roundId, 2, 13]); // …and 13 is free for hole 2
      await c.query("select public.live_round_set_hole($1, 3::smallint, 4::smallint, null)", [roundId]); // clearing is fine
    });
  });

  it("the starter deletes a round, live or finished, with its players, card and scores; nobody else can", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const live = await createRound(c);
      await c.query("select public.live_round_set_score($1, $2, 1::smallint, 5::smallint)", [live.roundId, live.players[0]]);
      const done = await createRound(c);
      await c.query("select public.live_round_finish($1)", [done.roundId]);

      for (const who of [PAL, STRANGER]) {
        await as(c, who);
        await rejects(c, "select public.live_round_delete($1)", [live.roundId], /Only the person who started/);
      }

      await as(c, ME);
      for (const id of [live.roundId, done.roundId]) {
        await c.query("select public.live_round_delete($1)", [id]);
        const left = await asService(c, () =>
          c.query(
            `select (select count(*) from public.live_rounds where id = $1)::int
                  + (select count(*) from public.live_round_players where round_id = $1)::int
                  + (select count(*) from public.live_round_holes where round_id = $1)::int
                  + (select count(*) from public.live_round_scores where round_id = $1)::int as n`,
            [id],
          ),
        );
        expect(left.rows[0].n).toBe(0);
      }
      // Deleting something already gone is a quiet no-op (a double tap).
      await c.query("select public.live_round_delete($1)", [live.roundId]);
    });
  });

  it("anon can't delete", async () => {
    await withRole("anon", null, async (c) => {
      await rejects(c, "select public.live_round_delete(1)", [], /permission denied/);
    });
  });
});

describe("live rounds: a card that already had a duplicate (before 0105)", () => {
  it("can still change that hole's par without re-picking its index", async () => {
    await withRole("authenticated", ME, async (c) => {
      await setUp(c);
      const { roundId } = await createRound(c);
      await asService(c, () => c.query("update public.live_round_holes set stroke_index = 4 where round_id = $1 and hole in (1, 3)", [roundId]));
      await as(c, ME);
      await c.query("select public.live_round_set_hole($1, 1::smallint, 5::smallint, 4::smallint)", [roundId]);
    });
  });
});
