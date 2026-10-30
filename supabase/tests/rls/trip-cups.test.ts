// 0200_trip_cups.sql — Ryder Cup mode for trips.
//
// Cast:
//   seller1    owns the society and runs the trip
//   buyer1     a member, captain of team 1
//   moderator  a member, captain of team 2
//   buyer2     a member
//   seller2    not in the society
//
// What must hold:
//   - only whoever runs an overnight/abroad trip sets up its Cup, teams and sessions
//   - members read the Cup, teams and sessions; strangers see nothing; no direct writes
//   - captains pick in turn, onto their own team, members of the trip only
//   - a session is a round on the trip's itinerary; started sessions are kept
//   - a lineup is the captain's own team, the right size, before the session starts
//   - secret pairings: each side sees only its own until both are in
//   - a session's day is linked by whoever runs the trip, and only their own day
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const OWNER = USERS.seller1;
const CAPT1 = USERS.buyer1;
const CAPT2 = USERS.moderator;
const MEMBER = USERS.buyer2;
const STRANGER = USERS.seller2;

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

const day = (daysAhead: number) => new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

type Trip = { group: string; trip: string; dayOut: string; r1: string; r2: string };

async function trip(c: PoolClient): Promise<Trip> {
  await as(c, OWNER);
  const group = (await c.query<{ id: string }>("select public.create_group('society', 'Howth Golf Society') as id")).rows[0].id;
  await c.query("set local role service_role");
  for (const m of [CAPT1, CAPT2, MEMBER]) await c.query("select public.group_add_member($1, $2)", [group, m]);
  await c.query("set local role authenticated");
  const t = JSON.stringify({ kind: "abroad", title: "Algarve 2027", plays_on: day(10), ends_on: day(12), location: "Algarve" });
  const tripId = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [group, t])).rows[0].id;
  const dayOut = (await c.query<{ id: string }>("select public.save_outing($1, null, $2::jsonb) as id", [group, JSON.stringify({ title: "Day", course_name: "A", plays_on: day(3) })])).rows[0].id;
  const item = (d: number, title: string) =>
    c.query<{ id: string }>("select public.save_outing_item($1, null, $2::jsonb) as id", [tripId, JSON.stringify({ kind: "round", on_date: day(d), starts_at: "09:00", title, play_format: "stableford" })]);
  const r1 = (await item(10, "Quinta do Lago")).rows[0].id;
  const r2 = (await item(11, "Vale do Lobo")).rows[0].id;
  return { group, trip: tripId, dayOut, r1, r2 };
}

const SAVE = "select public.trip_cup_save($1, $2::jsonb) as id";
const cupJson = (extra: Record<string, unknown> = {}) => JSON.stringify({ team_names: ["Navy", "Gold"], holders: 2, pick_mode: "captains", secret_pairings: true, ...extra });
const TEAMS = "select public.trip_cup_set_teams($1, $2::jsonb)";
const PICK = "select public.trip_cup_pick($1, $2)";
const SESSIONS = "select public.trip_cup_save_sessions($1, $2::jsonb)";
const LINEUP = "select public.trip_cup_submit_lineup($1, $2, $3::jsonb)";

async function cupWithCaptains(c: PoolClient, t: Trip): Promise<string> {
  await as(c, OWNER);
  const id = (await c.query<{ id: string }>(SAVE, [t.trip, cupJson()])).rows[0].id;
  await c.query(TEAMS, [id, JSON.stringify([{ member_id: CAPT1, team: 1, captain: true }, { member_id: CAPT2, team: 2, captain: true }])]);
  return id;
}

describe("the Cup", () => {
  it("is set up by whoever runs an overnight or abroad trip; members read it, strangers don't", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const t = await trip(c);
      await rejects(c, SAVE, [t.dayOut, cupJson()], /overnight and abroad/);
      await rejects(c, SAVE, [t.trip, cupJson({ team_names: ["Navy", "navy"] })], /different names/);
      await rejects(c, SAVE, [t.trip, cupJson({ team_names: ["Navy"] })], /Name both teams/);
      await as(c, MEMBER);
      await rejects(c, SAVE, [t.trip, cupJson()], /Only whoever runs the trip/);
      await as(c, OWNER);
      const id = (await c.query<{ id: string }>(SAVE, [t.trip, cupJson()])).rows[0].id;
      // Saving again changes the same Cup.
      const again = (await c.query<{ id: string }>(SAVE, [t.trip, cupJson({ team_names: ["Europe", "USA"], holders: null })])).rows[0].id;
      expect(again).toBe(id);
      await as(c, MEMBER);
      expect((await c.query("select team_names, holders, status from public.trip_cups where id = $1", [id])).rows[0]).toEqual({ team_names: ["Europe", "USA"], holders: null, status: "open" });
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.trip_cups where id = $1", [id])).rowCount).toBe(0);
      await as(c, MEMBER);
      await rejects(c, "select public.trip_cup_cancel($1)", [id], /Only whoever runs the trip/);
      await as(c, OWNER);
      await c.query("select public.trip_cup_cancel($1)", [id]);
      expect((await c.query("select status from public.trip_cups where id = $1", [id])).rows[0].status).toBe("cancelled");
    });
  });

  it("can't be written directly", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const t = await trip(c);
      const id = await cupWithCaptains(c, t);
      await rejects(c, "update public.trip_cups set holders = 1 where id = $1", [id]);
      await rejects(c, "insert into public.trip_cup_players (cup_id, member_id, team) values ($1, $2, 1)", [id, MEMBER]);
      await rejects(c, "select * from public.trip_cup_lineups", []);
    });
  });
});

describe("the teams", () => {
  it("whoever runs the trip sets them, members of the trip only, one captain a team", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const t = await trip(c);
      const id = (await c.query<{ id: string }>(SAVE, [t.trip, cupJson()])).rows[0].id;
      await rejects(c, TEAMS, [id, JSON.stringify([{ member_id: STRANGER, team: 1 }])], /Only members of the trip/);
      await rejects(c, TEAMS, [id, JSON.stringify([{ member_id: CAPT1, team: 1, captain: true }, { member_id: MEMBER, team: 1, captain: true }])], /One captain a team/);
      await rejects(c, TEAMS, [id, JSON.stringify([{ member_id: CAPT1, team: 1 }, { member_id: CAPT1, team: 2 }])], /both teams/);
      await c.query(TEAMS, [id, JSON.stringify([{ member_id: CAPT1, team: 1, captain: true }, { member_id: MEMBER, team: 2, captain: true }])]);
      // The captain of team 2 changes and moves; the old captain is taken off.
      await c.query(TEAMS, [id, JSON.stringify([{ member_id: CAPT1, team: 2, captain: true }, { member_id: CAPT2, team: 1, captain: true }])]);
      const rows = (await c.query("select member_id, team, captain from public.trip_cup_players where cup_id = $1 order by team", [id])).rows;
      expect(rows).toEqual([
        { member_id: CAPT2, team: 1, captain: true },
        { member_id: CAPT1, team: 2, captain: true },
      ]);
      await as(c, MEMBER);
      await rejects(c, TEAMS, [id, "[]"], /Only whoever runs the trip/);
      expect((await c.query("select 1 from public.trip_cup_players where cup_id = $1", [id])).rowCount).toBe(2);
      await as(c, STRANGER);
      expect((await c.query("select 1 from public.trip_cup_players where cup_id = $1", [id])).rowCount).toBe(0);
    });
  });

  it("captains pick in turn, onto their own team", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const t = await trip(c);
      const id = await cupWithCaptains(c, t);
      await as(c, MEMBER);
      await rejects(c, PICK, [id, OWNER], /Only the captains pick/);
      // Level: team 1 picks first.
      await as(c, CAPT2);
      await rejects(c, PICK, [id, MEMBER], /other captain's pick/);
      await as(c, CAPT1);
      await rejects(c, PICK, [id, STRANGER], /Only members of the trip/);
      await rejects(c, PICK, [id, CAPT2], /already on a team/);
      await c.query(PICK, [id, MEMBER]);
      await rejects(c, PICK, [id, OWNER], /other captain's pick/);
      await as(c, CAPT2);
      await c.query(PICK, [id, OWNER]);
      expect((await c.query("select member_id, team from public.trip_cup_players where cup_id = $1 and not captain order by team", [id])).rows).toEqual([
        { member_id: MEMBER, team: 1 },
        { member_id: OWNER, team: 2 },
      ]);
      // Not a captains' pick: no picking.
      await as(c, OWNER);
      await c.query(SAVE, [t.trip, cupJson({ pick_mode: "balanced" })]);
      await c.query(TEAMS, [id, JSON.stringify([{ member_id: CAPT1, team: 1, captain: true }, { member_id: CAPT2, team: 2, captain: true }])]);
      await as(c, CAPT1);
      await rejects(c, PICK, [id, MEMBER], /captains' pick/);
    });
  });
});

describe("the sessions", () => {
  it("are rounds on the trip; whoever runs it plans them; started ones are kept", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const t = await trip(c);
      const id = await cupWithCaptains(c, t);
      await rejects(c, SESSIONS, [id, JSON.stringify([{ item_id: t.r1, format: "scramble" }])], /needs a format/);
      await rejects(c, SESSIONS, [id, JSON.stringify([{ item_id: t.r1, slot: 3, format: "singles" }])], /morning and an afternoon/);
      const other = await trip(c);
      await rejects(c, SESSIONS, [id, JSON.stringify([{ item_id: other.r1, format: "singles" }])], /round on this trip/);
      await c.query(SESSIONS, [id, JSON.stringify([{ item_id: t.r1, format: "fourball" }, { item_id: t.r1, slot: 2, format: "foursomes" }, { item_id: t.r2, format: "singles" }])]);
      const sessions = (await c.query<{ id: string; item_id: string; slot: number; format: string }>("select id, item_id, slot, format from public.trip_cup_sessions where cup_id = $1 order by item_id, slot", [id])).rows;
      expect(sessions.map((s) => [s.slot, s.format])).toEqual([[1, "fourball"], [2, "foursomes"], [1, "singles"]]);

      // Start the morning session: its day is linked, and the round's too.
      await c.query("set local role service_role");
      const mine = (await c.query<{ id: string }>("insert into public.live_match_days (title, course_name, created_by) values ('Day 1', 'Quinta', $1) returning id", [OWNER])).rows[0].id;
      const theirs = (await c.query<{ id: string }>("insert into public.live_match_days (title, course_name, created_by) values ('Other', 'X', $1) returning id", [CAPT1])).rows[0].id;
      await c.query("set local role authenticated");
      await rejects(c, "select public.trip_cup_link_session($1, $2)", [sessions[0].id, theirs], /isn't your match day/);
      await as(c, CAPT1);
      await rejects(c, "select public.trip_cup_link_session($1, $2)", [sessions[0].id, theirs], /Only whoever runs the trip/);
      await as(c, OWNER);
      await c.query("select public.trip_cup_link_session($1, $2)", [sessions[0].id, mine]);
      expect((await c.query("select match_day_id from public.society_outing_items where id = $1", [t.r1])).rows[0].match_day_id).toBe(mine);

      // Planned again without the started one, and the afternoon now greensomes:
      // the started session stays as it was; the singles one goes.
      await c.query(SESSIONS, [id, JSON.stringify([{ item_id: t.r1, format: "singles" }, { item_id: t.r1, slot: 2, format: "greensomes" }])]);
      const after = (await c.query("select slot, format, match_day_id from public.trip_cup_sessions where cup_id = $1 order by item_id, slot", [id])).rows;
      expect(after).toEqual([
        { slot: 1, format: "fourball", match_day_id: mine },
        { slot: 2, format: "greensomes", match_day_id: null },
      ]);

      // Deleting the day puts the session back to not started.
      await c.query("set local role service_role");
      await c.query("delete from public.live_match_days where id = $1", [mine]);
      await c.query("set local role authenticated");
      expect((await c.query("select match_day_id from public.trip_cup_sessions where id = $1", [sessions[0].id])).rows[0].match_day_id).toBeNull();

      await as(c, MEMBER);
      await rejects(c, SESSIONS, [id, "[]"], /Only whoever runs the trip/);
      expect((await c.query("select 1 from public.trip_cup_sessions where cup_id = $1", [id])).rowCount).toBe(2);
    });
  });
});

describe("lineups", () => {
  it("are each captain's own team, kept secret until both are in", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const t = await trip(c);
      const id = await cupWithCaptains(c, t);
      await c.query(TEAMS, [
        id,
        JSON.stringify([
          { member_id: CAPT1, team: 1, captain: true },
          { member_id: MEMBER, team: 1 },
          { member_id: CAPT2, team: 2, captain: true },
          { member_id: OWNER, team: 2 },
        ]),
      ]);
      await c.query(SESSIONS, [id, JSON.stringify([{ item_id: t.r1, format: "fourball" }, { item_id: t.r2, format: "singles" }])]);
      const [fourball, singles] = (await c.query<{ id: string }>("select id from public.trip_cup_sessions where cup_id = $1 order by item_id", [id])).rows.map((r) => r.id);

      await as(c, MEMBER);
      await rejects(c, LINEUP, [singles, 1, JSON.stringify([[CAPT1], [MEMBER]])], /Only the team's captain/);
      await as(c, CAPT1);
      await rejects(c, LINEUP, [singles, 2, JSON.stringify([[CAPT2], [OWNER]])], /Only the team's captain/);
      await rejects(c, LINEUP, [singles, 1, JSON.stringify([[CAPT1], [CAPT2]])], /own team/);
      await rejects(c, LINEUP, [singles, 1, JSON.stringify([[CAPT1, MEMBER]])], /one player a match/);
      await rejects(c, LINEUP, [fourball, 1, JSON.stringify([[CAPT1]])], /two a side/);
      await rejects(c, LINEUP, [singles, 1, JSON.stringify([[CAPT1], [CAPT1]])], /two matches/);
      await c.query(LINEUP, [singles, 1, JSON.stringify([[MEMBER], [CAPT1]])]);

      const seen = async (who: string) => {
        await as(c, who);
        return (await c.query<{ team: number; pairs: string[][] | null }>("select team, pairs from public.trip_cup_lineups($1)", [singles])).rows;
      };
      // Captain 1 sees their own; captain 2, the organiser and a member see it's in, not what it is.
      expect(await seen(CAPT1)).toEqual([{ team: 1, pairs: [[MEMBER], [CAPT1]] }]);
      expect(await seen(CAPT2)).toEqual([{ team: 1, pairs: null }]);
      expect(await seen(OWNER)).toEqual([{ team: 1, pairs: null }]);
      expect(await seen(STRANGER)).toEqual([]);

      await as(c, CAPT2);
      await c.query(LINEUP, [singles, 2, JSON.stringify([[CAPT2], [OWNER]])]);
      // Both in: everyone sees both.
      expect(await seen(MEMBER)).toEqual([
        { team: 1, pairs: [[MEMBER], [CAPT1]] },
        { team: 2, pairs: [[CAPT2], [OWNER]] },
      ]);

      // Not secret: shown at once.
      await as(c, OWNER);
      await c.query(SAVE, [t.trip, cupJson({ secret_pairings: false })]);
      await c.query(LINEUP, [fourball, 1, JSON.stringify([[CAPT1, MEMBER]])]);
      expect(await seen(CAPT2).then(() => c.query("select team, pairs from public.trip_cup_lineups($1)", [fourball])).then((r) => r.rows)).toEqual([{ team: 1, pairs: [[CAPT1, MEMBER]] }]);

      // Started: no more changes.
      await c.query("set local role service_role");
      const md = (await c.query<{ id: string }>("insert into public.live_match_days (title, course_name, created_by) values ('Day 2', 'Vale', $1) returning id", [OWNER])).rows[0].id;
      await c.query("set local role authenticated");
      await as(c, OWNER);
      await c.query("select public.trip_cup_link_session($1, $2)", [singles, md]);
      await as(c, CAPT1);
      await rejects(c, LINEUP, [singles, 1, JSON.stringify([[CAPT1], [MEMBER]])], /has started/);
    });
  });
});
