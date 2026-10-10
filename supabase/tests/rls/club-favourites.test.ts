// 0112_club_favourites_profile_cover.sql — favourite clubs are private.
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

async function refused(c: PoolClient, sql: string, params: unknown[], pattern: RegExp): Promise<void> {
  await c.query("savepoint refusal");
  await expectRejected(c.query(sql, params), pattern);
  await c.query("rollback to savepoint refusal");
}

async function anyClub(c: PoolClient): Promise<number> {
  const { rows } = await c.query<{ id: number }>("select id from public.clubs order by id limit 2");
  return Number(rows[0].id);
}

describe("club_favourites", () => {
  it("a member stars a club, reads it back, and takes it off", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const club = await anyClub(c);
      await c.query("insert into public.club_favourites (club_id) values ($1)", [club]);
      let { rows } = await c.query("select club_id from public.club_favourites");
      expect(rows.map((r) => Number(r.club_id))).toEqual([club]);
      await refused(c, "insert into public.club_favourites (club_id) values ($1)", [club], /duplicate key/);
      await c.query("delete from public.club_favourites where club_id = $1", [club]);
      ({ rows } = await c.query("select 1 from public.club_favourites"));
      expect(rows).toHaveLength(0);
    });
  });

  it("nobody sees, adds or removes another member's", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const club = await anyClub(c);
      await c.query("insert into public.club_favourites (club_id) values ($1)", [club]);
      await as(c, USERS.buyer2);
      const { rowCount } = await c.query("select 1 from public.club_favourites");
      expect(rowCount).toBe(0);
      await refused(c, "insert into public.club_favourites (member_id, club_id) values ($1, $2)", [USERS.buyer1, club], /row-level security/);
      const del = await c.query("delete from public.club_favourites where member_id = $1", [USERS.buyer1]);
      expect(del.rowCount).toBe(0);
    });
  });

  it("anon has no access", async () => {
    await withRole("anon", null, async (c) => {
      await refused(c, "select 1 from public.club_favourites", [], /permission denied/);
    });
  });
});
