// 0194_social_live.sql — Social: a day's group can watch it; comments (with
// likes) and Great Shots on a live day.
//
// Cast:
//   seller1    runs the society and starts the day (the organiser)
//   buyer1     plays
//   moderator  a member of the society, not playing (watches from Social)
//   buyer2     a member of the society, not playing
//   seller2    a stranger
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ORGANISER = USERS.seller1;
const PLAYER = USERS.buyer1;
const WATCHER = USERS.moderator;
const WATCHER2 = USERS.buyer2;
const STRANGER = USERS.seller2;

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
  if (pattern) expect(message).toMatch(pattern);
}

const p = (memberId: string | null, name: string) => ({
  member_id: memberId,
  name,
  handicap_index: 12,
  course_handicap: 14,
  playing_handicap: 13,
  handicap_estimated: false,
});
const card = JSON.stringify(Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1 })));

async function society(c: PoolClient): Promise<string> {
  await as(c, ORGANISER);
  const g = (await c.query<{ id: string }>("select public.create_group('society', 'Portmarnock Golf Society') as id")).rows[0].id;
  await asService(c, async () => {
    for (const m of [PLAYER, WATCHER, WATCHER2]) await c.query("select public.group_add_member($1, $2)", [g, m]);
  });
  return g;
}

async function startDay(c: PoolClient): Promise<string> {
  await as(c, ORGANISER);
  const { rows } = await c.query<{ id: string }>("select public.live_fourball_day_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
    JSON.stringify({ title: "Captain's Day", course_name: "Ballybunion", holes: 18, format: "stableford", allowance: 0.95 }),
    JSON.stringify([{ tee_time: "09:00", players: [p(ORGANISER, "Eire"), p(PLAYER, "Paul")] }]),
    card,
  ]);
  return rows[0].id;
}

/** A society event, started as a live day and linked to it. */
async function societyDay(c: PoolClient): Promise<{ group: string; day: string }> {
  const group = await society(c);
  await as(c, ORGANISER);
  const outing = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [
    group,
    JSON.stringify({ title: "Captain's Day", course_name: "Ballybunion", plays_on: new Date().toISOString().slice(0, 10) }),
  ])).rows[0].id;
  const day = await startDay(c);
  await c.query("select public.link_outing_match_day($1, $2)", [outing, day]);
  return { group, day };
}

const sees = async (c: PoolClient, day: string) => ({
  day: (await c.query("select 1 from public.live_match_days where id = $1", [day])).rowCount,
  rounds: (await c.query("select 1 from public.live_rounds where match_day_id = $1", [day])).rowCount,
});

const comment = async (c: PoolClient, day: string, body: string) =>
  (await c.query<{ id: string }>("insert into public.live_day_comments (match_day_id, body) values ($1, $2) returning id", [day, body])).rows[0].id;

describe("watching a society day", () => {
  it("members of the society see the day and its cards without playing; a stranger doesn't", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day } = await societyDay(c);
      await as(c, WATCHER);
      expect(await sees(c, day)).toEqual({ day: 1, rounds: 1 });
      expect((await c.query("select 1 from public.live_round_players p join public.live_rounds r on r.id = p.round_id where r.match_day_id = $1", [day])).rowCount).toBe(2);
      await as(c, STRANGER);
      expect(await sees(c, day)).toEqual({ day: 0, rounds: 0 });
    });
  });

  it("a secret leaderboard stays secret from members who aren't playing", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day } = await societyDay(c);
      await c.query("select public.set_day_leaderboard_hidden($1, true)", [day]);
      await as(c, WATCHER);
      expect(await sees(c, day)).toEqual({ day: 0, rounds: 0 });
      await as(c, ORGANISER);
      await c.query("select public.set_day_leaderboard_hidden($1, false)", [day]);
      await as(c, WATCHER);
      expect(await sees(c, day)).toEqual({ day: 1, rounds: 1 });
    });
  });

  it("a day started straight from a group is linked by whoever started it, and only to their own group", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const group = await society(c);
      const day = await startDay(c);
      await as(c, WATCHER);
      expect(await sees(c, day)).toEqual({ day: 0, rounds: 0 });

      // Not the starter.
      await as(c, PLAYER);
      await rejects(c, "select public.set_match_day_group($1, $2)", [day, group], /Only whoever started/);
      // A group the starter isn't in.
      await as(c, STRANGER);
      const other = (await c.query<{ id: string }>("select public.create_group('crew', 'Other lads') as id")).rows[0].id;
      await as(c, ORGANISER);
      await rejects(c, "select public.set_match_day_group($1, $2)", [day, other], /not in that group/);

      await c.query("select public.set_match_day_group($1, $2)", [day, group]);
      await as(c, WATCHER);
      expect(await sees(c, day)).toEqual({ day: 1, rounds: 1 });
      // Nobody can write the column directly.
      await rejects(c, "update public.live_match_days set group_id = null where id = $1", [day]);
    });
  });
});

describe("comments on a live day", () => {
  it("anyone who can see the day comments and reads them; a stranger can do neither", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day } = await societyDay(c);
      await as(c, WATCHER);
      await comment(c, day, "Go on Paul!");
      await as(c, PLAYER);
      expect((await c.query("select body from public.live_day_comments where match_day_id = $1", [day])).rows).toEqual([{ body: "Go on Paul!" }]);
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.live_day_comments where match_day_id = $1", [day])).rowCount).toBe(0);
      await rejects(c, "insert into public.live_day_comments (match_day_id, body) values ($1, 'hi')", [day]);
      // Nobody writes as somebody else, or sets the counts.
      await as(c, WATCHER);
      await rejects(c, "insert into public.live_day_comments (match_day_id, body, author_id) values ($1, 'hi', $2)", [day, PLAYER]);
      await rejects(c, "insert into public.live_day_comments (match_day_id, body, like_count) values ($1, 'hi', 50)", [day]);
    });
  });

  it("likes: one each, counted, and taken back", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day } = await societyDay(c);
      await as(c, WATCHER);
      const id = await comment(c, day, "Birdie on 15!");
      await as(c, PLAYER);
      await c.query("insert into public.live_day_comment_likes (comment_id) values ($1)", [id]);
      await rejects(c, "insert into public.live_day_comment_likes (comment_id) values ($1)", [id]);
      await as(c, WATCHER2);
      await c.query("insert into public.live_day_comment_likes (comment_id) values ($1)", [id]);
      expect((await c.query<{ like_count: number }>("select like_count from public.live_day_comments where id = $1", [id])).rows[0].like_count).toBe(2);
      await c.query("delete from public.live_day_comment_likes where comment_id = $1", [id]);
      expect((await c.query<{ like_count: number }>("select like_count from public.live_day_comments where id = $1", [id])).rows[0].like_count).toBe(1);
      // Can't like as someone else, or a comment you can't see.
      await rejects(c, "insert into public.live_day_comment_likes (comment_id, member_id) values ($1, $2)", [id, PLAYER]);
      await as(c, STRANGER);
      await rejects(c, "insert into public.live_day_comment_likes (comment_id) values ($1)", [id]);
    });
  });

  it("you delete your own; the organiser deletes and pins any; nobody else", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day } = await societyDay(c);
      await as(c, WATCHER);
      const a = await comment(c, day, "One");
      const b = await comment(c, day, "Two");
      await as(c, WATCHER2);
      expect((await c.query("delete from public.live_day_comments where id = $1", [a])).rowCount).toBe(0);
      await rejects(c, "select public.live_day_comment_pin($1, true)", [a], /Only the organiser/);
      await as(c, WATCHER);
      expect((await c.query("delete from public.live_day_comments where id = $1", [a])).rowCount).toBe(1);
      await as(c, ORGANISER);
      const pinned = await comment(c, day, "Prizegiving at 6");
      await c.query("select public.live_day_comment_pin($1, true)", [b]);
      await c.query("select public.live_day_comment_pin($1, true)", [pinned]);
      const { rows } = await c.query<{ id: string }>("select id from public.live_day_comments where match_day_id = $1 and pinned_at is not null", [day]);
      expect(rows.map((r) => r.id)).toEqual([pinned]);
      expect((await c.query("delete from public.live_day_comments where id = $1", [b])).rowCount).toBe(1);
    });
  });

  it("a block hides comments either way", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day } = await societyDay(c);
      await as(c, WATCHER);
      await comment(c, day, "From the watcher");
      await asService(c, () =>
        c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2) on conflict do nothing", [PLAYER, WATCHER]),
      );
      await as(c, PLAYER);
      expect((await c.query("select 1 from public.live_day_comments where match_day_id = $1", [day])).rowCount).toBe(0);
      await as(c, WATCHER2);
      expect((await c.query("select 1 from public.live_day_comments where match_day_id = $1", [day])).rowCount).toBe(1);
    });
  });

  it("ten a minute at most", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day } = await societyDay(c);
      await as(c, WATCHER);
      for (let i = 0; i < 10; i++) await comment(c, day, `Comment ${i}`);
      await rejects(c, "insert into public.live_day_comments (match_day_id, body) values ($1, 'eleven')", [day], /very fast/);
    });
  });
});

describe("Great Shots on a day", () => {
  it("one each, by people who can see the day", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day } = await societyDay(c);
      await as(c, WATCHER);
      await c.query("insert into public.live_day_cheers (match_day_id) values ($1)", [day]);
      await rejects(c, "insert into public.live_day_cheers (match_day_id) values ($1)", [day]);
      await as(c, PLAYER);
      await c.query("insert into public.live_day_cheers (match_day_id) values ($1)", [day]);
      expect((await c.query("select 1 from public.live_day_cheers where match_day_id = $1", [day])).rowCount).toBe(2);
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.live_day_cheers where match_day_id = $1", [day])).rowCount).toBe(0);
      await rejects(c, "insert into public.live_day_cheers (match_day_id) values ($1)", [day]);
    });
  });
});

// 0195: share a live day or a round with everyone on PinPals Social.
describe("sharing on Social (0195)", () => {
  const ownRound = async (c: PoolClient) => {
    await as(c, PLAYER);
    const { rows } = await c.query<{ id: string }>("select public.live_round_create($1::jsonb, $2::jsonb, $3::jsonb) as id", [
      JSON.stringify({ course_name: "Portmarnock", format: "stableford", holes: 18, allowance: 0.95 }),
      JSON.stringify([p(PLAYER, "Paul")]),
      card,
    ]);
    return rows[0].id;
  };
  const yearsAgo = (n: number) => `${new Date().getFullYear() - n}-01-01`;

  it("the organiser shares a day; any adult member can then watch and comment", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day } = await societyDay(c);
      await as(c, STRANGER);
      expect(await sees(c, day)).toEqual({ day: 0, rounds: 0 });
      await as(c, PLAYER);
      await rejects(c, "select public.set_match_day_public($1, true)", [day], /Only the organiser/);
      await as(c, ORGANISER);
      await c.query("select public.set_match_day_public($1, true)", [day]);
      await as(c, STRANGER);
      expect(await sees(c, day)).toEqual({ day: 1, rounds: 1 });
      await comment(c, day, "Great to watch");
      await c.query("insert into public.live_day_cheers (match_day_id) values ($1)", [day]);
      // A direct write to the switch is refused.
      await rejects(c, "update public.live_match_days set public_on_social = false where id = $1", [day]);
      // Unshared: gone again.
      await as(c, ORGANISER);
      await c.query("select public.set_match_day_public($1, false)", [day]);
      await as(c, STRANGER);
      expect(await sees(c, day)).toEqual({ day: 0, rounds: 0 });
    });
  });

  it("never a secret leaderboard", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day } = await societyDay(c);
      await c.query("select public.set_match_day_public($1, true)", [day]);
      await c.query("select public.set_day_leaderboard_hidden($1, true)", [day]);
      await as(c, STRANGER);
      expect(await sees(c, day)).toEqual({ day: 0, rounds: 0 });
      await as(c, ORGANISER);
      await c.query("select public.set_match_day_public($1, false)", [day]);
      await rejects(c, "select public.set_match_day_public($1, true)", [day], /secret/);
    });
  });

  it("not to a viewer under 18, and not while a member under 18 is playing", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const setDob = (u: string, years: number) =>
        asService(c, () =>
          c.query("insert into public.member_birthdates (user_id, date_of_birth) values ($1, $2) on conflict (user_id) do update set date_of_birth = excluded.date_of_birth", [u, yearsAgo(years)]),
        );
      const { day } = await societyDay(c);
      await setDob(STRANGER, 15);
      await as(c, ORGANISER);
      await c.query("select public.set_match_day_public($1, true)", [day]);
      await as(c, STRANGER);
      expect(await sees(c, day)).toEqual({ day: 0, rounds: 0 });
      await as(c, ORGANISER);
      await c.query("select public.set_match_day_public($1, false)", [day]);
      await setDob(PLAYER, 15);
      await as(c, ORGANISER);
      await rejects(c, "select public.set_match_day_public($1, true)", [day], /under 18/);
    });
  });

  it("a player shares their own round, with its own comments and Great Shots; a round in a day can't be shared alone", async () => {
    await withRole("authenticated", PLAYER, async (c) => {
      const round = await ownRound(c);
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.live_rounds where id = $1", [round])).rowCount).toBe(0);
      await rejects(c, "select public.set_live_round_public($1, true)", [round], /Only someone playing/);
      await as(c, PLAYER);
      await c.query("select public.set_live_round_public($1, true)", [round]);
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.live_rounds where id = $1", [round])).rowCount).toBe(1);
      expect((await c.query("select 1 from public.live_round_players where round_id = $1", [round])).rowCount).toBe(1);
      const id = (await c.query<{ id: string }>("insert into public.live_day_comments (round_id, body) values ($1, 'Go on!') returning id", [round])).rows[0].id;
      await c.query("insert into public.live_day_cheers (round_id) values ($1)", [round]);
      await rejects(c, "insert into public.live_day_cheers (round_id) values ($1)", [round]);
      await as(c, PLAYER);
      await c.query("insert into public.live_day_comment_likes (comment_id) values ($1)", [id]);
      await c.query("select public.live_day_comment_pin($1, true)", [id]);
      // Neither key: refused.
      await rejects(c, "insert into public.live_day_comments (body) values ('nowhere')", []);
    });
  });

  it("a round inside a day is shared with the day, not on its own", async () => {
    await withRole("authenticated", ORGANISER, async (c) => {
      const { day } = await societyDay(c);
      const r = await asService(c, () => c.query<{ id: string }>("select id from public.live_rounds where match_day_id = $1", [day]));
      await as(c, PLAYER);
      await rejects(c, "select public.set_live_round_public($1, true)", [r.rows[0].id], /part of a day/);
    });
  });
});
