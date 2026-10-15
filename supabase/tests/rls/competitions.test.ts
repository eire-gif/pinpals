// 0148_competitions.sql — matchplay leagues, ladders and opens.
//
// Cast:
//   admin      PinPals staff (admin): runs a league open to everyone
//   moderator  staff, but only a moderator: can't
//   seller1    owns a society; runs its league
//   buyer1, buyer2, seller2, disabledStaff   players
//
// What must hold:
//   - only staff admins start a PinPals-wide competition; only a group's
//     owner/admins start one for their group; nobody writes the tables directly
//   - a group's competition is invisible outside the group
//   - entries close at the draw; the handicap limit is enforced
//   - the draw puts everyone in one group and makes a full round robin
//   - only the two players report; margins must be real matchplay results;
//     the opponent confirms or disputes; the same result from both confirms,
//     different results go to the organiser; unchallenged results stand after
//     48 hours
//   - the knockout waits for every group match, byes go through, winners
//     move on, the final finishes the competition
//   - ladder challenges reach N places up; a challenger's win takes the place
//   - opens: shared by members, taken down by the sharer or staff, "posted by
//     the club" set by staff only
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const STAFF = USERS.admin;
const MOD = USERS.moderator;
const OWNER = USERS.seller1;
const P1 = USERS.buyer1;
const P2 = USERS.buyer2;
const P3 = USERS.seller2;
const P4 = USERS.disabledStaff;

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
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

async function asService<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const league = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "Leinster winter matchplay", entries_close_at: inDays(7), starts_on: inDays(8).slice(0, 10), ...extra });

async function newLeague(c: PoolClient, extra: Record<string, unknown> = {}): Promise<string> {
  await as(c, STAFF);
  return (await c.query<{ id: string }>("select public.competition_league_save(null, $1::jsonb) as id", [league(extra)])).rows[0].id;
}

async function enter(c: PoolClient, id: string, who: string[], hcp = 12.4): Promise<void> {
  for (const w of who) {
    await as(c, w);
    await c.query("select public.competition_enter($1, true, $2)", [id, hcp]);
  }
}

/** Alerts queued for a member (the outbox is the website's to read, never a member's). */
const alertCount = (c: PoolClient, who: string, titleLike = "%") =>
  asService(c, async () => (await c.query("select 1 from public.competition_alerts where member_id = $1 and title like $2", [who, titleLike])).rowCount);

type Match = { id: string; player_a: string; player_b: string; status: string; winner: string | null; stage: string; round_no: number };
const matches = async (c: PoolClient, id: string, stage?: string): Promise<Match[]> =>
  (await c.query<Match>(
    "select id, player_a, player_b, status, winner, stage, round_no from public.competition_matches where league_id = $1 and ($2::text is null or stage = $2) order by stage, round_no, slot",
    [id, stage ?? null],
  )).rows;

describe("starting a competition", () => {
  it("staff admins start a PinPals league; moderators and members can't", async () => {
    await withRole("authenticated", STAFF, async (c) => {
      await newLeague(c);
      await as(c, MOD);
      await rejects(c, "select public.competition_league_save(null, $1::jsonb)", [league()], /Only PinPals/);
      await as(c, P1);
      await rejects(c, "select public.competition_league_save(null, $1::jsonb)", [league()], /Only PinPals/);
      await as(c, STAFF);
      await rejects(c, "select public.competition_league_save(null, $1::jsonb)", [league({ entries_close_at: inDays(-1) })], /entries close/);
      await rejects(c, "select public.competition_league_save(null, $1::jsonb)", [league({ name: "x" })], /name/);
    });
  });

  it("a group's owner starts one for the group; members can't, and outsiders can't see it", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = (await c.query<{ id: string }>("select public.create_group('society', 'Malahide Golf Society') as id")).rows[0].id;
      await asService(c, () => c.query("select public.group_add_member($1, $2)", [g, P1]));
      await as(c, P1);
      await rejects(c, "select public.competition_league_save(null, $1::jsonb)", [league({ group_id: g })], /whoever runs the group/);
      await as(c, OWNER);
      const id = (await c.query<{ id: string }>("select public.competition_league_save(null, $1::jsonb) as id", [
        JSON.stringify({ kind: "ladder", name: "Society ladder", group_id: g }),
      ])).rows[0].id;
      await as(c, P1);
      expect((await c.query("select 1 from public.competition_leagues where id = $1", [id])).rowCount).toBe(1);
      await c.query("select public.competition_enter($1, true, 14)", [id]);
      await as(c, P2);
      expect((await c.query("select 1 from public.competition_leagues where id = $1", [id])).rowCount).toBe(0);
      await rejects(c, "select public.competition_enter($1, true, 14)", [id], /not open to you/);
    });
  });

  it("nobody writes the tables directly", async () => {
    await withRole("authenticated", STAFF, async (c) => {
      const id = await newLeague(c);
      await rejects(c, "update public.competition_leagues set name = 'Mine' where id = $1", [id], /permission denied/);
      await rejects(c, "insert into public.competition_entries (league_id, user_id, handicap_index) values ($1, $2, 1)", [id, STAFF], /permission denied/);
      await rejects(c, "delete from public.competition_matches", [], /permission denied/);
    });
  });
});

describe("entries and the draw", () => {
  it("handicap limit, withdrawals before the draw, and closing at the draw", async () => {
    await withRole("authenticated", STAFF, async (c) => {
      const id = await newLeague(c, { max_handicap: 18 });
      await as(c, P1);
      await rejects(c, "select public.competition_enter($1, true, 24)", [id], /handicaps up to 18/);
      await enter(c, id, [P1, P2, P3, P4]);
      await as(c, P4);
      await c.query("select public.competition_enter($1, false)", [id]);
      await as(c, STAFF);
      await c.query("select public.competition_draw($1, $2::jsonb)", [id, JSON.stringify([[P1, P2, P3]])]);
      await as(c, P4);
      await rejects(c, "select public.competition_enter($1, true, 10)", [id], /closed/);
      await as(c, P1);
      await rejects(c, "select public.competition_enter($1, false)", [id], /draw is made/);
    });
  });

  it("only the organiser draws; everyone exactly once; a full round robin", async () => {
    await withRole("authenticated", STAFF, async (c) => {
      const id = await newLeague(c);
      await enter(c, id, [P1, P2, P3, P4, OWNER]);
      await as(c, P1);
      await rejects(c, "select public.competition_draw($1, $2::jsonb)", [id, JSON.stringify([[P1, P2, P3, P4, OWNER]])], /organiser/);
      await as(c, STAFF);
      await rejects(c, "select public.competition_draw($1, $2::jsonb)", [id, JSON.stringify([[P1, P2, P3, P4]])], /Everyone who entered/);
      await rejects(c, "select public.competition_draw($1, $2::jsonb)", [id, JSON.stringify([[P1, P2, P3], [P3, P4, OWNER]])], /once/);
      await rejects(c, "select public.competition_draw($1, $2::jsonb)", [id, JSON.stringify([[P1, P2, P3, P4, STAFF]])], /entered/);
      await rejects(c, "select public.competition_draw($1, $2::jsonb)", [id, JSON.stringify([[P1, P2, P3, P4, null]])], /needs a player/);
      await c.query("select public.competition_draw($1, $2::jsonb)", [id, JSON.stringify([[P1, P2, P3, P4, OWNER]])]);
      const ms = await matches(c, id, "group");
      // 5 players: 10 matches over 5 rounds, each pair once, nobody twice in a round.
      expect(ms.length).toBe(10);
      const pairs = new Set(ms.map((m) => [m.player_a, m.player_b].sort().join()));
      expect(pairs.size).toBe(10);
      for (let r = 1; r <= 5; r++) {
        const inRound = ms.filter((m) => m.round_no === r).flatMap((m) => [m.player_a, m.player_b]);
        expect(new Set(inRound).size).toBe(inRound.length);
      }
      // Everyone hears about it.
      expect(await alertCount(c, P1, "The draw is out%")).toBe(1);
      // Members can't read or write the outbox.
      await as(c, P1);
      await rejects(c, "select 1 from public.competition_alerts", [], /permission denied/);
    });
  });
});

describe("reporting a result", () => {
  async function drawnThree(c: PoolClient): Promise<{ id: string; m: Match }> {
    const id = await newLeague(c);
    await enter(c, id, [P1, P2, P3]);
    await as(c, STAFF);
    await c.query("select public.competition_draw($1, $2::jsonb)", [id, JSON.stringify([[P1, P2, P3]])]);
    const m = (await matches(c, id, "group")).find((x) => [x.player_a, x.player_b].includes(P1))!;
    return { id, m };
  }

  it("only the players report, with a real margin; the opponent confirms", async () => {
    await withRole("authenticated", STAFF, async (c) => {
      const { m } = await drawnThree(c);
      const other = m.player_a === P1 ? m.player_b : m.player_a;
      const outsider = [P2, P3].find((x) => x !== other)!;
      await as(c, outsider);
      await rejects(c, "select public.competition_report($1, 'me', '3&2')", [m.id], /two players/);
      await as(c, P1);
      for (const bad of ["3&3", "5&2", "19th", "11&8", "03&02", "nonsense"]) {
        await rejects(c, "select public.competition_report($1, 'me', $2)", [m.id, bad], /matchplay result/);
      }
      expect((await c.query("select public.competition_report($1, 'me', '3&1') as s", [m.id])).rows[0].s).toBe("reported");
      const mySide = m.player_a === P1 ? "a" : "b";
      await rejects(c, "select public.competition_confirm($1, $2, '3&1')", [m.id, mySide], /opponent confirms/);
      await as(c, other);
      expect(await alertCount(c, other, "Confirm your result%")).toBe(1);
      // Confirming what they were shown: a stale result is refused.
      await rejects(c, "select public.competition_confirm($1, $2, '2&1')", [m.id, mySide], /just been changed/);
      await c.query("select public.competition_confirm($1, $2, '3&1')", [m.id, mySide]);
      const row = (await c.query("select status, winner, margin, holes_up from public.competition_matches where id = $1", [m.id])).rows[0];
      expect(row).toEqual({ status: "confirmed", winner: m.player_a === P1 ? "a" : "b", margin: "3&1", holes_up: 3 });
      await as(c, P1);
      await rejects(c, "select public.competition_report($1, 'them', '1 up')", [m.id], /settled/);
    });
  });

  it("the same result from both confirms; a different one goes to the organiser, who settles it", async () => {
    await withRole("authenticated", STAFF, async (c) => {
      const { id, m } = await drawnThree(c);
      const other = m.player_a === P1 ? m.player_b : m.player_a;
      await as(c, P1);
      await c.query("select public.competition_report($1, 'half', null)", [m.id]);
      await as(c, other);
      expect((await c.query("select public.competition_report($1, 'half', null) as s", [m.id])).rows[0].s).toBe("confirmed");

      const m2 = (await matches(c, id, "group")).find((x) => x.status === "open" && [x.player_a, x.player_b].includes(P1))!;
      const other2 = m2.player_a === P1 ? m2.player_b : m2.player_a;
      await as(c, P1);
      await c.query("select public.competition_report($1, 'me', '2&1')", [m2.id]);
      await as(c, other2);
      expect((await c.query("select public.competition_report($1, 'me', '1 up') as s", [m2.id])).rows[0].s).toBe("disputed");
      await as(c, STAFF);
      expect(await alertCount(c, STAFF, "A result needs you%")).toBe(1);
      await as(c, P1);
      await rejects(c, "select public.competition_resolve($1, 'a', '2&1')", [m2.id], /organiser/);
      await as(c, STAFF);
      await c.query("select public.competition_resolve($1, $2, '2&1')", [m2.id, m2.player_a === P1 ? "a" : "b"]);
      expect((await c.query("select status from public.competition_matches where id = $1", [m2.id])).rows[0].status).toBe("confirmed");
    });
  });

  it("a reported result stands after 48 hours if nobody disputes it", async () => {
    await withRole("authenticated", STAFF, async (c) => {
      const { m } = await drawnThree(c);
      await as(c, P1);
      await c.query("select public.competition_report($1, 'them', '1 up')", [m.id]);
      await asService(c, async () => {
        expect((await c.query("select public.competition_settle_due() as n")).rows[0].n).toBe(0);
        await c.query("update public.competition_matches set stands_at = now() - interval '1 minute' where id = $1", [m.id]);
        expect((await c.query("select public.competition_settle_due() as n")).rows[0].n).toBe(1);
      });
      expect((await c.query("select status from public.competition_matches where id = $1", [m.id])).rows[0].status).toBe("confirmed");
      // Members can't run the sweep.
      await as(c, P1);
      await rejects(c, "select public.competition_settle_due()", [], /permission denied/);
    });
  });

  it("a dispute is the opponent's; arranging is the players'", async () => {
    await withRole("authenticated", STAFF, async (c) => {
      const { m } = await drawnThree(c);
      const other = m.player_a === P1 ? m.player_b : m.player_a;
      const outsider = [P2, P3].find((x) => x !== other)!;
      await as(c, outsider);
      await rejects(c, "select public.competition_arrange($1, now() + interval '3 days', null)", [m.id], /two players/);
      await as(c, P1);
      await c.query("select public.competition_arrange($1, now() + interval '3 days', null)", [m.id]);
      await c.query("select public.competition_report($1, 'me', '4&3')", [m.id]);
      await rejects(c, "select public.competition_dispute($1, 'no')", [m.id], /right result/);
      await as(c, other);
      await c.query("select public.competition_dispute($1, 'It was 2&1')", [m.id]);
      expect((await c.query("select status, dispute_note from public.competition_matches where id = $1", [m.id])).rows[0]).toEqual({
        status: "disputed",
        dispute_note: "It was 2&1",
      });
    });
  });
});

describe("the knockout", () => {
  it("waits for the groups, puts byes through, moves winners on and finishes after the final", async () => {
    await withRole("authenticated", STAFF, async (c) => {
      const id = await newLeague(c);
      await enter(c, id, [P1, P2, P3]);
      await as(c, STAFF);
      await c.query("select public.competition_draw($1, $2::jsonb)", [id, JSON.stringify([[P1, P2, P3]])]);
      const bracket = JSON.stringify([P1, null, P2, P3]);
      await rejects(c, "select public.competition_start_knockout($1, $2::jsonb)", [id, bracket], /settled/);
      for (const m of await matches(c, id, "group")) await c.query("select public.competition_resolve($1, 'a', '2&1')", [m.id]);
      await rejects(c, "select public.competition_start_knockout($1, $2::jsonb)", [id, JSON.stringify([P1, P2, P3])], /2, 4, 8/);
      await rejects(c, "select public.competition_start_knockout($1, $2::jsonb)", [id, JSON.stringify([P1, P1, P2, P3])], /once/);
      await rejects(c, "select public.competition_start_knockout($1, $2::jsonb)", [id, JSON.stringify([null, null, P2, P3])], /bye/);
      await c.query("select public.competition_start_knockout($1, $2::jsonb)", [id, bracket]);

      const sf = await matches(c, id, "sf");
      const final = (await matches(c, id, "final"))[0];
      expect(sf.length).toBe(2);
      // P1's bye went straight through to the final.
      expect(sf[0].status).toBe("confirmed");
      expect(final.player_a).toBe(P1);
      expect(final.player_b).toBeNull();

      // No halves in a knockout; extra holes are fine.
      await as(c, P2);
      await rejects(c, "select public.competition_report($1, 'half', null)", [sf[1].id], /halved/);
      await c.query("select public.competition_report($1, 'me', '19th')", [sf[1].id]);
      await as(c, P3);
      await c.query("select public.competition_confirm($1, 'a', '19th')", [sf[1].id]);
      expect((await matches(c, id, "final"))[0].player_b).toBe(P2);

      await as(c, P1);
      await c.query("select public.competition_report($1, 'me', '1 up')", [final.id]);
      await as(c, P2);
      await c.query("select public.competition_confirm($1, 'a', '1 up')", [final.id]);
      expect((await c.query("select status from public.competition_leagues where id = $1", [id])).rows[0].status).toBe("finished");
    });
  });
});

describe("ladders", () => {
  it("challenge up to the reach; a challenger's win takes the place", async () => {
    await withRole("authenticated", STAFF, async (c) => {
      const id = (await c.query<{ id: string }>("select public.competition_league_save(null, $1::jsonb) as id", [
        JSON.stringify({ kind: "ladder", name: "Portmarnock ladder", challenge_reach: 2 }),
      ])).rows[0].id;
      await enter(c, id, [P1, P2, P3, P4]);
      const pos = async () =>
        (await c.query<{ user_id: string }>("select user_id from public.competition_entries where league_id = $1 and withdrawn_at is null order by ladder_position", [id])).rows.map((r) => r.user_id);
      expect(await pos()).toEqual([P1, P2, P3, P4]);

      await as(c, P4);
      await rejects(c, "select public.competition_challenge($1, $2)", [id, P1], /up to 2 places/);
      const ch = (await c.query<{ id: string }>("select public.competition_challenge($1, $2) as id", [id, P2])).rows[0].id;
      await as(c, P3);
      await rejects(c, "select public.competition_challenge($1, $2)", [id, P2], /already has a challenge/);
      await as(c, P2);
      expect(await alertCount(c, P2, "%challenged you")).toBe(1);
      await c.query("select public.competition_report($1, 'them', '5&4')", [ch]);
      await as(c, P4);
      await c.query("select public.competition_confirm($1, 'a', '5&4')", [ch]);
      expect(await pos()).toEqual([P1, P4, P2, P3]);

      // Leaving closes the gap.
      await as(c, P1);
      await c.query("select public.competition_enter($1, false)", [id]);
      expect(await pos()).toEqual([P4, P2, P3]);
    });
  });
});

describe("opens", () => {
  it("members share and flag for a partner; the sharer or staff take it down; staff mark it as the club's", async () => {
    await withRole("authenticated", P1, async (c) => {
      const club = (await c.query<{ id: string }>("select id from public.clubs where hidden_at is null order by id limit 1")).rows[0].id;
      const day = inDays(10).slice(0, 10);
      const open = (extra: Record<string, unknown> = {}) =>
        JSON.stringify({ club_id: club, plays_on: day, title: "Fourball open", entry_fee: "€60 per pair", booking_url: "https://example.ie/opens", province: "leinster", ...extra });
      await rejects(c, "select public.open_competition_share($1::jsonb)", [open({ booking_url: "http://example.ie" })], /https/);
      await rejects(c, "select public.open_competition_share($1::jsonb)", [open({ plays_on: inDays(-2).slice(0, 10) })], /date/);
      const id = (await c.query<{ id: string }>("select public.open_competition_share($1::jsonb) as id", [open()])).rows[0].id;
      await rejects(c, "select public.open_competition_share($1::jsonb)", [open()], /already listed/);

      await as(c, P2);
      await c.query("select public.open_partner_request_set($1, true, 'Off 14, need a partner')", [id]);
      expect((await c.query("select user_id from public.open_partner_requests where open_id = $1", [id])).rows).toEqual([{ user_id: P2 }]);
      await rejects(c, "select public.open_competition_set_source($1, 'club')", [id], /Only PinPals/);
      await rejects(c, "select public.open_competition_remove($1)", [id], /take it down/);
      await rejects(c, "insert into public.open_partner_requests (open_id, user_id) values ($1, $2)", [id, P3], /permission denied/);

      await as(c, STAFF);
      await c.query("select public.open_competition_set_source($1, 'club')", [id]);
      expect((await c.query("select source from public.open_competitions where id = $1", [id])).rows[0].source).toBe("club");
      await as(c, P1);
      await c.query("select public.open_competition_remove($1)", [id]);
      expect((await c.query("select 1 from public.open_competitions where id = $1", [id])).rowCount).toBe(0);
    });
  });

  it("anonymous visitors see nothing", async () => {
    await withRole("anon", null, async (c) => {
      await rejects(c, "select 1 from public.open_competitions", [], /permission denied/);
      await rejects(c, "select 1 from public.competition_leagues", [], /permission denied/);
    });
  });
});
