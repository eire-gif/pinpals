// 0124_group_cover_and_logo.sql — a group's cover photo and logo.
//
// What must hold:
//   - in a society: the owner, captain or secretary set them; members can't
//   - in a crew: owner or admin; members can't
//   - the URL must be in the caller's own member-avatars folder, group- name
//   - every member (and a society's searchers) can read them
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const OWNER = USERS.seller1;
const CAPTAIN = USERS.moderator;
const MEMBER = USERS.buyer1;
const STRANGER = USERS.seller2;

const url = (who: string, name = "group-1-cover-1.jpg") =>
  `https://example.supabase.co/storage/v1/object/public/member-avatars/${who}/${name}`;

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

async function group(c: PoolClient, kind: "society" | "crew"): Promise<string> {
  await as(c, OWNER);
  const id = (await c.query<{ id: string }>("select public.create_group($1, 'Malahide Golf Society') as id", [kind])).rows[0].id;
  await c.query("set local role service_role");
  for (const m of [CAPTAIN, MEMBER]) await c.query("select public.group_add_member($1, $2)", [id, m]);
  await c.query("set local role authenticated");
  return id;
}

describe("a group's cover and logo", () => {
  it("in a society, the owner and officers set them; members can't", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const id = await group(c, "society");
      await as(c, OWNER);
      await c.query("select public.set_group_image($1, 'cover', $2)", [id, url(OWNER)]);
      await c.query("select public.set_group_office($1, $2, 'captain')", [id, CAPTAIN]);

      await as(c, CAPTAIN);
      await c.query("select public.set_group_image($1, 'logo', $2)", [id, url(CAPTAIN, "group-1-logo-2.png")]);
      const row = (await c.query("select cover_url, logo_url from public.groups where id = $1", [id])).rows[0];
      expect(row).toEqual({ cover_url: url(OWNER), logo_url: url(CAPTAIN, "group-1-logo-2.png") });

      await as(c, MEMBER);
      await rejects(c, "select public.set_group_image($1, 'cover', $2)", [id, url(MEMBER)], /captain or secretary/);
      // Everyone in it reads them; so does a stranger searching societies.
      expect((await c.query("select logo_url from public.groups where id = $1", [id])).rows[0].logo_url).toContain(CAPTAIN);
      await as(c, STRANGER);
      expect((await c.query("select cover_url from public.groups where id = $1", [id])).rows[0].cover_url).toContain(OWNER);
      await rejects(c, "select public.set_group_image($1, 'cover', $2)", [id, url(STRANGER)], /captain or secretary/);

      // A stood-down captain loses it.
      await as(c, OWNER);
      await c.query("select public.set_group_office($1, $2, null)", [id, CAPTAIN]);
      await as(c, CAPTAIN);
      await rejects(c, "select public.set_group_image($1, 'cover', null)", [id], /captain or secretary/);

      // Null puts the default back.
      await as(c, OWNER);
      await c.query("select public.set_group_image($1, 'cover', null)", [id]);
      expect((await c.query("select cover_url from public.groups where id = $1", [id])).rows[0].cover_url).toBeNull();
    });
  });

  it("in a crew, the owner sets them; members can't", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const id = await group(c, "crew");
      await as(c, OWNER);
      await c.query("select public.set_group_image($1, 'logo', $2)", [id, url(OWNER)]);
      await as(c, MEMBER);
      await rejects(c, "select public.set_group_image($1, 'logo', $2)", [id, url(MEMBER)], /whoever runs/);
    });
  });

  it("only takes a file from the caller's own folder", async () => {
    await withRole("authenticated", OWNER, async (c) => {
      const id = await group(c, "society");
      await as(c, OWNER);
      await rejects(c, "select public.set_group_image($1, 'cover', $2)", [id, url(MEMBER)], /can't be used/);
      await rejects(c, "select public.set_group_image($1, 'cover', $2)", [id, url(OWNER, "avatar-1.jpg")], /can't be used/);
      await rejects(c, "select public.set_group_image($1, 'cover', $2)", [id, "https://evil.example/x.jpg"], /can't be used/);
      await rejects(c, "select public.set_group_image($1, 'banner', null)", [id], /Unknown image/);
    });
  });
});
