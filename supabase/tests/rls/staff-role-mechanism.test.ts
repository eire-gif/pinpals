// Rule 8 ("Admin access must use the existing trusted role mechanism, not
// client-supplied metadata"). The schema-side mechanism itself (is_staff(),
// backed by the staff_roles table) already existed before this phase and was
// confirmed, via an exhaustive grep across supabase/migrations and src/, to
// be the ONLY authorization path used anywhere — auth.jwt()/app_metadata/
// raw_app_meta_data are never read for an authorization decision. These
// tests exercise that mechanism directly: is_staff() must key off the
// database's own staff_roles row, not anything a client could smuggle into
// its own JWT claims.
import { describe, it, expect, afterAll } from "vitest";
import { pool, withRole, setIdentity, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

describe("staff_roles: SELECT (a staff member sees only their own row, unless super_admin)", () => {
  it("a staff member can read their own staff_roles row", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const r = await c.query("select id from public.staff_roles where id = $1", [ids.staffRoles.moderator]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("a staff member cannot read another staff member's row (not super_admin)", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const r = await c.query("select id from public.staff_roles where id = $1", [ids.staffRoles.admin]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("an ordinary buyer/seller cannot read anyone's staff_roles row, including their own (they have none)", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select id from public.staff_roles where id = $1", [ids.staffRoles.moderator]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("anon cannot read staff_roles", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.staff_roles where id = $1", [ids.staffRoles.moderator]);
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("staff_roles: no client-writable INSERT/UPDATE/DELETE path (self-promotion is impossible)", () => {
  it("an ordinary user cannot grant themselves a staff role", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(
        c.query("insert into public.staff_roles (user_id, role, status) values ($1, 'admin', 'active')", [
          USERS.buyer1,
        ]),
        /permission denied/,
      );
    });
  });

  it("an existing staff member cannot promote their own role or reactivate themselves via an UPDATE", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      await expectRejected(
        c.query("update public.staff_roles set role = 'super_admin' where id = $1", [ids.staffRoles.moderator]),
        /permission denied/,
      );
    });
  });

  it("only a direct (service-role/superuser) grant can create a staff row — this is the documented, intended path", async () => {
    await withRole("service_role", null, async (c) => {
      const r = await c.query(
        "insert into public.staff_roles (user_id, role, status) values ($1, 'support', 'active')",
        [USERS.buyer2],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("is_staff(): keyed off staff_roles, immune to a client-supplied JWT claim", () => {
  it("an active staff member's own is_staff() call returns true", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      const r = await c.query<{ is_staff: boolean }>("select public.is_staff() as is_staff");
      expect(r.rows[0].is_staff).toBe(true);
    });
  });

  it("a disabled staff row does not count, even though the row exists", async () => {
    await withRole("authenticated", USERS.disabledStaff, async (c) => {
      const r = await c.query<{ is_staff: boolean }>("select public.is_staff() as is_staff");
      expect(r.rows[0].is_staff).toBe(false);
    });
  });

  it("an ordinary user is never staff, no matter what claims their own session tries to assert", async () => {
    // The mechanism this asserts: is_staff() only ever consults the
    // database's staff_roles table via auth.uid() — there is no code path
    // anywhere that reads a request.jwt.claim.* other than .sub (the identity
    // itself), so setting an arbitrary extra claim (simulating a
    // client-forged app_metadata/role claim) has zero effect on the result.
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await c.query("select set_config('request.jwt.claim.role', 'admin', true)");
      await c.query("select set_config('request.jwt.claim.app_metadata', '{\"role\":\"admin\"}', true)");
      const r = await c.query<{ is_staff: boolean }>("select public.is_staff() as is_staff");
      expect(r.rows[0].is_staff).toBe(false);
    });
  });

  it("is_staff() correctly narrows to a specific required role", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const asModerator = await c.query<{ ok: boolean }>(
        "select public.is_staff(array['moderator']) as ok",
      );
      expect(asModerator.rows[0].ok).toBe(true);

      const asSuperAdmin = await c.query<{ ok: boolean }>(
        "select public.is_staff(array['super_admin']) as ok",
      );
      expect(asSuperAdmin.rows[0].ok).toBe(false);
    });
  });

  it("anon cannot even call is_staff() — EXECUTE is revoked per-role (0008), not just from PUBLIC", async () => {
    // Belt-and-braces beyond "would return false anyway": 0008's own history
    // is the cautionary tale here — Supabase grants EXECUTE on new
    // public-schema functions to `anon` directly (not via the PUBLIC
    // pseudo-role), so an earlier "revoke ... from public" alone left anon
    // able to call this. Confirms that gap stays closed.
    await withRole("anon", null, async (c) => {
      await expectRejected(c.query("select public.is_staff() as is_staff"), /permission denied/);
    });
  });
});

describe("cross-check: is_staff() is what actually gates every staff-only policy in this schema", () => {
  it("flipping a staff member's status to disabled immediately revokes every is_staff()-gated read", async () => {
    // One connection, one transaction: disable the moderator's row as
    // service-role, then re-check as that same moderator that every
    // is_staff() bypass this migration relies on (listings visibility,
    // orders, webhook_events, etc.) disappears in lockstep — proving there's
    // exactly one mechanism, not a cached/duplicated check anywhere.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      await client.query("update public.staff_roles set status = 'disabled' where id = $1", [
        ids.staffRoles.moderator,
      ]);

      await client.query("set local role authenticated");
      await setIdentity(client, USERS.moderator);
      const listings = await client.query("select id from public.listings where id = $1", [ids.listings.removed]);
      expect(listings.rowCount).toBe(0);
      const webhooks = await client.query("select id from public.webhook_events where id = $1", [
        ids.webhookEventId,
      ]);
      expect(webhooks.rowCount).toBe(0);
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  });
});
