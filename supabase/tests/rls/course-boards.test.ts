// 0197_course_boards.sql — this week's course leaderboard, Course Legend
// and hole champions, built from members' scorecards.
//
// Cast (all scorecards at one club, this week):
//   seller1    viewer; a round of 36 pts
//   buyer1     40 pts — top of the board
//   moderator  38 pts but the card is "Only me" — not shown
//   seller2    41 pts but has switched course boards off — not shown
//   buyer2     42 pts but is under 18 — not shown
//
// What must hold:
//   - best round per member, ranked by points / net / gross
//   - private cards, opted-out members, minors and blocked members are left out
//   - handicap only when the member shows it
//   - a typed-in card needs every hole; a live card needs the round finished
//   - hole champions: best net per hole, ties to whoever did it first
//   - Course Legend: most days played here in 90 days
//   - the opt-out switch is the member's own
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.seller1;
const TOP = USERS.buyer1;
const PRIVATE = USERS.moderator;
const HIDDEN = USERS.seller2;
const KID = USERS.buyer2;

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

// Par 4s, SI = hole. Off playing handicap 0 a 4 is 2 points, so a card of
// all 4s is 36; a birdie on a hole adds one.
async function card(
  c: PoolClient,
  clubId: string,
  member: string,
  opts: { birdies?: number[]; visibility?: string; blank?: number; playedOn?: string; hcp?: number } = {},
): Promise<string> {
  return asService(c, async () => {
    const { rows } = await c.query<{ id: string }>(
      `insert into public.scorecards (member_id, club_id, course_name, holes, played_on, playing_handicap, source, visibility)
       values ($1, $2, 'Test Links', 18, coalesce($3::date, (now() at time zone 'Europe/Dublin')::date), $4, 'manual', $5) returning id`,
      [member, clubId, opts.playedOn ?? null, opts.hcp ?? 0, opts.visibility ?? "pinpals"],
    );
    const id = rows[0].id;
    for (let h = 1; h <= 18; h++) {
      const strokes = h === opts.blank ? null : opts.birdies?.includes(h) ? 3 : 4;
      await c.query("insert into public.scorecard_holes (scorecard_id, hole, par, stroke_index, strokes) values ($1, $2, 4, $2, $3)", [id, h, strokes]);
    }
    return id;
  });
}

async function setUp(c: PoolClient): Promise<string> {
  const club = await asService(c, async () => {
    const { rows } = await c.query<{ id: string }>("select id from public.clubs order by id limit 1");
    await c.query("delete from public.scorecards where club_id = $1", [rows[0].id]);
    return rows[0].id;
  });
  await card(c, club, ME);
  await card(c, club, TOP, { birdies: [1, 2, 3, 4] });
  await card(c, club, PRIVATE, { birdies: [1, 2], visibility: "private" });
  await card(c, club, HIDDEN, { birdies: [1, 2, 3, 4, 5] });
  await card(c, club, KID, { birdies: [1, 2, 3, 4, 5, 6] });
  await asService(c, async () => {
    await c.query("insert into public.course_board_optouts (member_id) values ($1) on conflict do nothing", [HIDDEN]);
    await c.query(
      `insert into public.member_birthdates (user_id, date_of_birth) values ($1, current_date - interval '15 years')
       on conflict (user_id) do update set date_of_birth = excluded.date_of_birth`,
      [KID],
    );
    await c.query("update public.profiles set handicap = 9.4, handicap_visible = true where id = $1", [TOP]);
    await c.query("update public.profiles set handicap = 18.2, handicap_visible = false where id = $1", [ME]);
  });
  return club;
}

const BOARD = "select * from public.course_week_board($1, $2)";

describe("this week's board", () => {
  it("best round each, by points; private, opted-out and under-18 cards left out", async () => {
    await withRole("authenticated", ME, async (c) => {
      const club = await setUp(c);
      await as(c, ME);
      const { rows } = await c.query(BOARD, [club, "stableford"]);
      expect(rows.map((r) => [r.member_id, r.points, r.place])).toEqual([
        [TOP, 40, 1],
        [ME, 36, 2],
      ]);
      expect(rows[0]).toMatchObject({ handicap: "9.4", is_me: false, players: 2 });
      // My own handicap isn't shown when I don't show it.
      expect(rows[1]).toMatchObject({ handicap: null, is_me: true });
    });
  });

  it("net and gross order the same rounds; a better second round replaces the first", async () => {
    await withRole("authenticated", ME, async (c) => {
      const club = await setUp(c);
      await card(c, club, ME, { birdies: [1, 2, 3, 4, 5, 6, 7] });
      await as(c, ME);
      const net = await c.query(BOARD, [club, "net"]);
      expect(net.rows.map((r) => [r.member_id, r.net_to_par])).toEqual([
        [ME, -7],
        [TOP, -4],
      ]);
      const gross = await c.query(BOARD, [club, "gross"]);
      expect(gross.rows.map((r) => r.gross)).toEqual([65, 68]);
      await rejects(c, BOARD, [club, "matchplay"], /Stableford, net or gross/);
    });
  });

  it("a typed-in card with a blank hole doesn't count; last week's rounds aren't this week's", async () => {
    await withRole("authenticated", ME, async (c) => {
      const club = await setUp(c);
      await card(c, club, PRIVATE, { birdies: [1, 2, 3, 4, 5, 6, 7, 8], blank: 18 });
      await card(c, club, PRIVATE, { birdies: [1, 2, 3, 4, 5, 6, 7, 8], playedOn: "2020-01-01" });
      await as(c, ME);
      const { rows } = await c.query(BOARD, [club, "stableford"]);
      expect(rows.map((r) => r.member_id)).toEqual([TOP, ME]);
    });
  });

  it("a blocked member isn't shown to the viewer", async () => {
    await withRole("authenticated", ME, async (c) => {
      const club = await setUp(c);
      await asService(c, () => c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2) on conflict do nothing", [ME, TOP]));
      await as(c, ME);
      const { rows } = await c.query(BOARD, [club, "stableford"]);
      expect(rows.map((r) => r.member_id)).toEqual([ME]);
    });
  });
});

describe("Course Legend and hole champions", () => {
  it("most days here in 90 days, with my own count", async () => {
    await withRole("authenticated", ME, async (c) => {
      const club = await setUp(c);
      const d = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
      await card(c, club, TOP, { playedOn: d(3) });
      await card(c, club, TOP, { playedOn: d(10) });
      await card(c, club, ME, { playedOn: d(5) });
      // Opted out: never the legend, however often.
      for (const n of [1, 2, 4, 6, 8]) await card(c, club, HIDDEN, { playedOn: d(n) });
      await as(c, ME);
      const { rows } = await c.query("select * from public.course_legend($1)", [club]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ member_id: TOP, rounds: 3, my_rounds: 2, is_me: false });
    });
  });

  it("the best net on each hole; ties go to whoever did it first", async () => {
    await withRole("authenticated", ME, async (c) => {
      const club = await setUp(c);
      await as(c, ME);
      const { rows } = await c.query("select * from public.course_hole_champions($1)", [club]);
      expect(rows).toHaveLength(18);
      const h1 = rows.find((r) => r.hole === 1);
      // Only TOP birdied the 1st among the cards shown.
      expect(h1).toMatchObject({ member_id: TOP, net_to_par: -1, tied: 1 });
      const h10 = rows.find((r) => r.hole === 10);
      // Pars by both shown members: whoever's card was in first (ME).
      expect(h10).toMatchObject({ member_id: ME, net_to_par: 0, tied: 2, is_me: true });
    });
  });
});

describe("switching it off", () => {
  it("is the member's own setting, readable only by them", async () => {
    await withRole("authenticated", ME, async (c) => {
      const club = await setUp(c);
      await as(c, ME);
      await c.query("select public.set_course_boards_hidden(true)");
      expect((await c.query("select member_id from public.course_board_optouts")).rows.map((r) => r.member_id)).toEqual([ME]);
      const { rows } = await c.query(BOARD, [club, "stableford"]);
      expect(rows.map((r) => r.member_id)).toEqual([TOP]);
      await c.query("select public.set_course_boards_hidden(false)");
      expect((await c.query("select 1 from public.course_board_optouts")).rows).toHaveLength(0);
      await rejects(c, "insert into public.course_board_optouts (member_id) values ($1)", [TOP], /permission denied/);
    });
  });
});
