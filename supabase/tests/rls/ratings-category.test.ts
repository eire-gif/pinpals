// 0177_ratings_category.sql — which course ratings a member plays off.
//
// What must hold:
//   - a member reads and writes only their own answer; nobody else can read
//     the table at all, and anon can't touch it
//   - the draw (group_ratings_categories) gives the men's/women's answers of
//     a group's members only to whoever can put the group on cards: anyone
//     in a crew; in a society, whoever runs its events — not an ordinary
//     member, not a stranger
//   - "Prefer not to say" is never handed out
//
// Cast:
//   seller1    runs the society (owner)
//   buyer1     a woman in it
//   buyer2     a man in it, an ordinary member
//   moderator  in it, prefers not to say
//   seller2    a stranger
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const OWNER = USERS.seller1;
const HER = USERS.buyer1;
const HIM = USERS.buyer2;
const QUIET = USERS.moderator;
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

const SAY = `insert into public.member_ratings_category (member_id, category) values ($1, $2)
             on conflict (member_id) do update set category = excluded.category, updated_at = now()`;

async function setUp(c: PoolClient, kind: "society" | "crew"): Promise<string> {
  await as(c, OWNER);
  const g = (await c.query<{ id: string }>("select public.create_group($1, 'Malahide Golf Society') as id", [kind])).rows[0].id;
  await asService(c, async () => {
    for (const m of [HER, HIM, QUIET]) await c.query("select public.group_add_member($1, $2)", [g, m]);
  });
  for (const [who, what] of [
    [HER, "women"],
    [HIM, "men"],
    [QUIET, "not_said"],
  ] as const) {
    await as(c, who);
    await c.query(SAY, [who, what]);
  }
  return g;
}

const READ = "select member_id, category from public.group_ratings_categories($1) order by category";

describe("ratings category: your own answer", () => {
  it("you read and change only your own; nobody reads anyone else's row", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      await setUp(c, "society");
      await as(c, HER);
      expect((await c.query("select member_id, category from public.member_ratings_category")).rows).toEqual([{ member_id: HER, category: "women" }]);
      await c.query(SAY, [HER, "not_said"]);
      expect((await c.query("select category from public.member_ratings_category")).rows).toEqual([{ category: "not_said" }]);
      // Not for someone else.
      await rejects(c, SAY, [HIM, "women"], /row-level security/);
      await c.query("update public.member_ratings_category set category = 'women' where member_id = $1", [HIM]);
      await as(c, STRANGER);
      expect((await c.query("select * from public.member_ratings_category")).rowCount).toBe(0);
      await as(c, HIM);
      expect((await c.query("select category from public.member_ratings_category")).rows).toEqual([{ category: "men" }]);
      // Nor anything else.
      await rejects(c, "insert into public.member_ratings_category (member_id, category) values ($1, 'other')", [STRANGER]);
      await c.query("set local role anon");
      await rejects(c, "select * from public.member_ratings_category", [], /permission denied/);
      await rejects(c, READ, [1], /permission denied/);
    });
  });
});

describe("ratings category: the draw", () => {
  it("a society: whoever runs it sees men's and women's — not prefer-not-to-say", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await setUp(c, "society");
      await as(c, OWNER);
      expect((await c.query(READ, [g])).rows).toEqual([
        { member_id: HIM, category: "men" },
        { member_id: HER, category: "women" },
      ]);
    });
  });

  it("a society: an ordinary member and a stranger see nothing", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await setUp(c, "society");
      await as(c, HIM);
      expect((await c.query(READ, [g])).rowCount).toBe(0);
      await as(c, STRANGER);
      expect((await c.query(READ, [g])).rowCount).toBe(0);
    });
  });

  it("a crew: anyone in it can make the draw, so anyone in it sees them", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const g = await setUp(c, "crew");
      await as(c, HIM);
      expect((await c.query(READ, [g])).rowCount).toBe(2);
      await as(c, STRANGER);
      expect((await c.query(READ, [g])).rowCount).toBe(0);
    });
  });
});
