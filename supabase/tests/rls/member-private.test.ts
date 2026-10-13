// 0133_privacy_hardening.sql — handicap and Golf Ireland membership number
// are the member's own.
//
// What must hold:
//   - member_private is read and written by its owner only; anon gets nothing
//   - the shared copy on profiles shows the handicap only while the member
//     shows it, and never the membership number
//   - an older app writing the old columns on profiles still saves — the
//     values move into member_private
//   - showing or hiding the handicap updates the shared copy straight away
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const ME = USERS.buyer1;
const OTHER = USERS.buyer2;

async function as(c: PoolClient, userId: string): Promise<void> {
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
}

async function rejects(c: PoolClient, sql: string, params: unknown[]): Promise<void> {
  await c.query("savepoint attempt");
  let failed = false;
  try {
    await c.query(sql, params);
  } catch {
    failed = true;
  }
  await c.query("rollback to savepoint attempt");
  if (!failed) throw new Error(`Expected to be rejected: ${sql}`);
}

async function mine(c: PoolClient, visible: boolean, handicap: number | null, gui: string | null): Promise<void> {
  await as(c, ME);
  await c.query("update public.profiles set handicap_visible = $1 where id = $2", [visible, ME]);
  await c.query(
    `insert into public.member_private (member_id, handicap, gui_membership_number) values ($1, $2, $3)
     on conflict (member_id) do update set handicap = excluded.handicap, gui_membership_number = excluded.gui_membership_number`,
    [ME, handicap, gui],
  );
}

describe("member_private", () => {
  it("the owner reads and writes their own row", async () => {
    await withRole("authenticated", ME, async (c) => {
      await mine(c, false, 12.4, "GUI-123");
      const { rows } = await c.query("select handicap, gui_membership_number from public.member_private where member_id = $1", [ME]);
      expect(rows).toEqual([{ handicap: "12.4", gui_membership_number: "GUI-123" }]);
    });
  });

  it("another member can't read, add or change it", async () => {
    await withRole("authenticated", ME, async (c) => {
      await mine(c, false, 12.4, "GUI-123");
      await as(c, OTHER);
      const { rows } = await c.query("select * from public.member_private where member_id = $1", [ME]);
      expect(rows).toEqual([]);
      const upd = await c.query("update public.member_private set handicap = 1 where member_id = $1", [ME]);
      expect(upd.rowCount).toBe(0);
      await rejects(c, "insert into public.member_private (member_id, handicap) values ($1, 3)", [USERS.seller2]);
    });
  });

  it("anon can't read it", async () => {
    await withRole("anon", null, async (c) => {
      await rejects(c, "select * from public.member_private", []);
    });
  });
});

describe("the shared copy on profiles", () => {
  it("hides a hidden handicap and never shows the membership number", async () => {
    await withRole("authenticated", ME, async (c) => {
      await mine(c, false, 12.4, "GUI-123");
      await as(c, OTHER);
      const { rows } = await c.query("select handicap, gui_membership_number from public.profiles where id = $1", [ME]);
      expect(rows).toEqual([{ handicap: null, gui_membership_number: null }]);
    });
  });

  it("shows a shown handicap, and follows show/hide straight away", async () => {
    await withRole("authenticated", ME, async (c) => {
      await mine(c, true, 9.8, "GUI-123");
      await as(c, OTHER);
      let { rows } = await c.query("select handicap, gui_membership_number from public.profiles where id = $1", [ME]);
      expect(rows).toEqual([{ handicap: "9.8", gui_membership_number: null }]);

      await as(c, ME);
      await c.query("update public.profiles set handicap_visible = false where id = $1", [ME]);
      await as(c, OTHER);
      ({ rows } = await c.query("select handicap from public.profiles where id = $1", [ME]));
      expect(rows).toEqual([{ handicap: null }]);

      // And the truth survives the hiding.
      await as(c, ME);
      ({ rows } = await c.query("select handicap from public.member_private where member_id = $1", [ME]));
      expect(rows).toEqual([{ handicap: "9.8" }]);
    });
  });

  it("an older app writing the old columns still saves them, privately", async () => {
    await withRole("authenticated", ME, async (c) => {
      await mine(c, false, 20, null);
      await c.query("update public.profiles set handicap = 7.2, gui_membership_number = ' NEW-9 ' where id = $1", [ME]);
      const priv = await c.query("select handicap, gui_membership_number from public.member_private where member_id = $1", [ME]);
      expect(priv.rows).toEqual([{ handicap: "7.2", gui_membership_number: "NEW-9" }]);
      const pub = await c.query("select handicap, gui_membership_number from public.profiles where id = $1", [ME]);
      expect(pub.rows).toEqual([{ handicap: null, gui_membership_number: null }]);
    });
  });
});
