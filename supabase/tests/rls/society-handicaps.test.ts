// 0122_society_officers_and_handicaps.sql — captain and secretary, who brings
// people in, the handicap indicator, and the secretary's handicap list.
//
// Cast (no connections unless a test makes one):
//   seller1    starts the society (owner)
//   moderator  made captain
//   buyer1     made secretary; also plays the scorecards
//   buyer2     an ordinary society member
//   seller2    in nothing: a stranger
//
// What must hold:
//   - only the owner appoints; one captain and one secretary; a new one
//     stands the old one down; no plain admins in a society
//   - in a society only the owner and officers invite or share the link;
//     whoever runs a group can invite members they aren't connected with;
//     an ordinary crew member still invites connections only
//   - the indicator is WHS best-N-of-20, net double bogey per hole, 18-hole
//     cards with rating and slope and 14+ holes scored only
//   - society_handicaps / set_society_handicap: owner and officers only
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const OWNER = USERS.seller1;
const CAPTAIN = USERS.moderator;
const SECRETARY = USERS.buyer1;
const MEMBER = USERS.buyer2;
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
  if (pattern && !pattern.test(message)) throw new Error(`Rejected with "${message}", expected ${pattern}`);
}

/** A society owned by OWNER with CAPTAIN, SECRETARY and MEMBER in it. */
async function society(c: PoolClient): Promise<string> {
  await as(c, OWNER);
  const id = (await c.query<{ id: string }>("select public.create_group('society', 'Malahide Golf Society') as id")).rows[0].id;
  await asService(c, async () => {
    for (const m of [CAPTAIN, SECRETARY, MEMBER]) await c.query("select public.group_add_member($1, $2)", [id, m]);
  });
  return id;
}

const member = async (c: PoolClient, group: string, who: string) =>
  (await c.query<{ role: string; office: string | null }>("select role, office from public.group_members where group_id = $1 and member_id = $2", [group, who])).rows[0];

/** An 18-hole card, every hole par 4 with SI = hole number, rating 72.0,
 *  slope 113, played off 18.0 — so each hole's cap is 4 + 2 + 1 = 7 and a
 *  differential is simply adjusted gross − 72. */
async function card(c: PoolClient, strokes: (number | null)[], opts: { holes?: 9 | 18; slope?: number | null; daysAgo?: number } = {}): Promise<void> {
  const holes = opts.holes ?? 18;
  const played = new Date(Date.now() - (opts.daysAgo ?? 1) * 86_400_000).toISOString().slice(0, 10);
  const payload = {
    course_name: "Portmarnock Golf Club",
    holes,
    played_on: played,
    par_total: holes * 4,
    course_rating: holes === 18 ? 72.0 : 36.0,
    slope: opts.slope === undefined ? 113 : opts.slope,
    handicap_index: 18.0,
    visibility: "private",
  };
  const rows = Array.from({ length: holes }, (_, i) => ({ hole: i + 1, par: 4, stroke_index: i + 1, strokes: strokes[i] ?? null }));
  await c.query("select public.scorecard_save(null, $1::jsonb, $2::jsonb)", [JSON.stringify(payload), JSON.stringify(rows)]);
}

const fives = () => Array<number>(18).fill(5); // 90 → differential 18.0
const eightyTwo = () => [...Array<number>(10).fill(5), ...Array<number>(8).fill(4)]; // 82 → 10.0
const withTwelve = () => [12, ...Array<number>(17).fill(5)]; // 12 capped at 7: 92 → 20.0

describe("captain and secretary", () => {
  it("the owner appoints them; officers run the society; a new captain stands the old one down", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const id = await society(c);
      await as(c, OWNER);
      await c.query("select public.set_group_office($1, $2, 'captain')", [id, CAPTAIN]);
      await c.query("select public.set_group_office($1, $2, 'secretary')", [id, SECRETARY]);
      expect(await member(c, id, CAPTAIN)).toEqual({ role: "admin", office: "captain" });
      expect(await member(c, id, SECRETARY)).toEqual({ role: "admin", office: "secretary" });

      // A new captain: the old one goes back to being a member.
      await c.query("select public.set_group_office($1, $2, 'captain')", [id, MEMBER]);
      expect(await member(c, id, MEMBER)).toEqual({ role: "admin", office: "captain" });
      expect(await member(c, id, CAPTAIN)).toEqual({ role: "member", office: null });

      // Standing down, and the owner holding an office keeps ownership.
      await c.query("select public.set_group_office($1, $2, null)", [id, MEMBER]);
      expect(await member(c, id, MEMBER)).toEqual({ role: "member", office: null });
      await c.query("select public.set_group_office($1, $2, 'captain')", [id, OWNER]);
      expect(await member(c, id, OWNER)).toEqual({ role: "owner", office: "captain" });

      // Making an officer an ordinary member clears the office.
      await c.query("select public.set_group_role($1, $2, 'member')", [id, SECRETARY]);
      expect(await member(c, id, SECRETARY)).toEqual({ role: "member", office: null });
    });
  });

  it("only the owner appoints, only in a society, and there are no plain admins in a society", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const id = await society(c);
      await as(c, OWNER);
      await c.query("select public.set_group_office($1, $2, 'secretary')", [id, SECRETARY]);
      await rejects(c, "select public.set_group_role($1, $2, 'admin')", [id, MEMBER], /captain or secretary/);
      await rejects(c, "select public.set_group_office($1, $2, 'treasurer')", [id, MEMBER], /Unknown office/);
      await rejects(c, "select public.set_group_office($1, $2, 'captain')", [id, STRANGER], /not in this society/);

      await as(c, SECRETARY);
      await rejects(c, "select public.set_group_office($1, $2, 'captain')", [id, MEMBER], /owner/);

      await as(c, OWNER);
      const crew = (await c.query<{ id: string }>("select public.create_group('crew', 'Saturday Crew') as id")).rows[0].id;
      await asService(c, () => c.query("select public.group_add_member($1, $2)", [crew, MEMBER]));
      await rejects(c, "select public.set_group_office($1, $2, 'captain')", [crew, MEMBER], /Only a society/);
    });
  });
});

describe("who brings people in", () => {
  it("in a society, only the owner and officers invite, share the link or let people in", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const id = await society(c);
      await as(c, OWNER);
      await c.query("select public.set_group_office($1, $2, 'captain')", [id, CAPTAIN]);

      // Members can't, whatever the settings say.
      await c.query("select public.update_group($1, 'Malahide Golf Society', null, true)", [id]);
      expect((await c.query("select members_can_invite from public.groups where id = $1", [id])).rows[0].members_can_invite).toBe(false);
      await as(c, MEMBER);
      await rejects(c, "select public.invite_to_group($1, $2)", [id, [STRANGER]], /captain or secretary/);
      await rejects(c, "select public.group_invite_code($1)", [id]);

      // The captain can, including someone they aren't connected with.
      await as(c, CAPTAIN);
      expect((await c.query("select public.invite_to_group($1, $2) as n", [id, [STRANGER]])).rows[0].n).toBe(1);
      expect((await c.query("select public.group_invite_code($1) as code", [id])).rows[0].code).toMatch(/^[a-z0-9]{8}$/);
    });
  });

  it("a crew member still invites only their connections; the crew's owner can invite anyone", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      await as(c, OWNER);
      const crew = (await c.query<{ id: string }>("select public.create_group('crew', 'Saturday Crew') as id")).rows[0].id;
      await asService(c, () => c.query("select public.group_add_member($1, $2)", [crew, MEMBER]));

      await as(c, MEMBER);
      expect((await c.query("select public.invite_to_group($1, $2) as n", [crew, [STRANGER]])).rows[0].n).toBe(0);

      await as(c, OWNER);
      expect((await c.query("select public.invite_to_group($1, $2) as n", [crew, [STRANGER]])).rows[0].n).toBe(1);
    });
  });

  it("a block still keeps someone out, Find PinPals or not", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      await as(c, OWNER);
      const crew = (await c.query<{ id: string }>("select public.create_group('crew', 'Saturday Crew') as id")).rows[0].id;
      await asService(c, () => c.query("insert into public.blocked_users (blocker_id, blocked_id) values ($1, $2)", [STRANGER, OWNER]));
      expect((await c.query("select public.invite_to_group($1, $2) as n", [crew, [STRANGER]])).rows[0].n).toBe(0);
    });
  });
});

describe("the handicap indicator", () => {
  it("is best-N-of-20 with net double bogey, from eligible cards only", async () => {
    await withRole("authenticated", SECRETARY, async (c) => {
      await card(c, fives(), { daysAgo: 5 });
      await card(c, eightyTwo(), { daysAgo: 4 });
      await card(c, withTwelve(), { daysAgo: 3 });
      // None of these count: 9 holes, no slope, only 13 holes scored.
      await card(c, Array(9).fill(5), { holes: 9, daysAgo: 2 });
      await card(c, fives(), { slope: null, daysAgo: 2 });
      await card(c, Array(13).fill(5), { daysAgo: 1 });

      const diffs = (await c.query("select adjusted_gross, differential::float as d, counts from public.my_handicap_differentials() order by played_on")).rows;
      expect(diffs).toEqual([
        { adjusted_gross: 90, d: 18, counts: false },
        { adjusted_gross: 82, d: 10, counts: true },
        { adjusted_gross: 92, d: 20, counts: false },
      ]);
      // Three cards: the best one, less 2.0.
      expect((await c.query("select indicator::float as i, rounds, counting from public.my_handicap_indicator()")).rows[0]).toEqual({ i: 8, rounds: 3, counting: 1 });

      // Four: the best one, less 1.0.
      await card(c, eightyTwo(), { daysAgo: 1 });
      expect((await c.query("select indicator::float as i, rounds from public.my_handicap_indicator()")).rows[0]).toEqual({ i: 9, rounds: 4 });
    });
  });

  it("needs three cards, and only ever reads the caller's own", async () => {
    await withRole("authenticated", SECRETARY, async (c) => {
      await card(c, fives());
      await card(c, fives(), { daysAgo: 2 });
      expect((await c.query("select indicator from public.my_handicap_indicator()")).rows[0].indicator).toBeNull();
      await as(c, MEMBER);
      expect((await c.query("select rounds from public.my_handicap_indicator()")).rows[0].rounds).toBe(0);
      await rejects(c, "select * from public.handicap_indicator_of($1)", [SECRETARY], /permission denied/);
    });
  });
});

describe("society handicaps", () => {
  it("officers see every member's handicaps and set the society's; members can't", async () => {
    await withRole("authenticated", SECRETARY, async (c) => {
      for (let i = 1; i <= 3; i++) await card(c, eightyTwo(), { daysAgo: i });
      const id = await society(c);
      await as(c, OWNER);
      await c.query("select public.set_group_office($1, $2, 'secretary')", [id, SECRETARY]);

      await as(c, SECRETARY);
      const rows = (await c.query("select member_id, indicator::float as i, rounds from public.society_handicaps($1)", [id])).rows;
      expect(rows).toHaveLength(4);
      expect(rows.find((r) => r.member_id === SECRETARY)).toMatchObject({ i: 8, rounds: 3 });

      await c.query("select public.set_society_handicap($1, $2, 14.36)", [id, MEMBER]);
      expect((await c.query("select society_index::float as s from public.group_members where group_id = $1 and member_id = $2", [id, MEMBER])).rows[0].s).toBe(14.4);
      await rejects(c, "select public.set_society_handicap($1, $2, 60)", [id, MEMBER], /between/);
      await rejects(c, "select public.set_society_handicap($1, $2, 10)", [id, STRANGER], /not in this society/);

      await as(c, MEMBER);
      await rejects(c, "select * from public.society_handicaps($1)", [id], /captain and secretary/);
      await rejects(c, "select public.set_society_handicap($1, $2, 10)", [id, MEMBER], /captain and secretary/);

      await as(c, STRANGER);
      await rejects(c, "select * from public.society_handicaps($1)", [id], /captain and secretary/);
    });
  });
});
