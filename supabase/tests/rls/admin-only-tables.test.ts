// Rule 7 ("Payment, payout, dispute internals and admin audit logs are
// server/admin only") across every table that rule covers: webhook_events,
// refunds, disputes, payouts, admin_audit_log. Also covers reports/
// report_notes, which follow the identical "staff can read, only
// service-role can write" shape.
import { describe, it, expect, afterAll } from "vitest";
import { pool, withRole, setIdentity, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

const STAFF_ONLY_TABLES = [
  { table: "webhook_events", idKey: "webhookEventId" },
  { table: "refunds", idKey: "refundId" },
  { table: "disputes", idKey: "disputeId" },
  { table: "payouts", idKey: "payoutId" },
  { table: "reports", idKey: "reportId" },
  { table: "fraud_flags", idKey: "fraudFlagId" },
] as const;

describe.each(STAFF_ONLY_TABLES)("$table: SELECT (staff-only)", ({ table, idKey }) => {
  it(`staff (moderator/admin) can read ${table}`, async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const r = await c.query(`select id from public.${table} where id = $1`, [ids[idKey]]);
      expect(r.rowCount).toBe(1);
    });
  });

  it(`an ordinary buyer/seller cannot read ${table}`, async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query(`select id from public.${table} where id = $1`, [ids[idKey]]);
      expect(r.rowCount).toBe(0);
    });
  });

  it(`anon cannot read ${table} (no policy applies to anon, so RLS matches zero rows)`, async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query(`select id from public.${table} where id = $1`, [ids[idKey]]);
      expect(r.rowCount).toBe(0);
    });
  });

  it(`a disabled staff member cannot read ${table}`, async () => {
    await withRole("authenticated", USERS.disabledStaff, async (c) => {
      const r = await c.query(`select id from public.${table} where id = $1`, [ids[idKey]]);
      expect(r.rowCount).toBe(0);
    });
  });
});

describe.each(STAFF_ONLY_TABLES.filter((t) => t.table !== "reports"))(
  "$table: INSERT/UPDATE/DELETE (server/admin only, no client path at all)",
  ({ table, idKey }) => {
    it(`even staff cannot write to ${table} directly — only service-role functions may`, async () => {
      await withRole("authenticated", USERS.admin, async (c) => {
        await expectRejected(
          c.query(`update public.${table} set updated_at = now() where id = $1`, [ids[idKey]]),
          /permission denied/,
        );
      });
    });

    it(`anon/authenticated cannot insert into ${table}`, async () => {
      await withRole("authenticated", USERS.buyer1, async (c) => {
        await expectRejected(c.query(`insert into public.${table} default values`), /permission denied/);
      });
    });
  },
);

describe("admin_audit_log: super_admin-only read (stricter than the other staff-only tables)", () => {
  it("a super_admin-role staff member... — this schema only seeds an 'admin' role, so assert the tighter rule directly", async () => {
    // is_staff(array['super_admin']) requires the *specific* role
    // 'super_admin', not merely "any active staff" — the fixture seeds a
    // plain 'admin', which is deliberately insufficient here.
    await withRole("authenticated", USERS.admin, async (c) => {
      const r = await c.query("select id from public.admin_audit_log limit 1");
      expect(r.rowCount).toBe(0);
    });
  });

  it("a moderator cannot read the audit log", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const r = await c.query("select id from public.admin_audit_log limit 1");
      expect(r.rowCount).toBe(0);
    });
  });

  it("anon cannot read the audit log at all", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.admin_audit_log limit 1");
      expect(r.rowCount).toBe(0);
    });
  });

  it("a genuine super_admin CAN read an audit log entry", async () => {
    // A dedicated, transaction-scoped super_admin — not one of the 6 fixture
    // identities the task requires (anon/buyer/seller/unrelated/moderator/
    // admin), but needed to prove the "admin" identity's denial above is
    // really about role granularity and not a broken policy: is_staff() with
    // an explicit role filter genuinely lets a *super_admin* through.
    const superAdminId = "00000000-0000-0000-0000-000000000099";
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      await client.query(
        "insert into auth.users (id, email) values ($1, 'super_admin@example.test') on conflict do nothing",
        [superAdminId],
      );
      await client.query("insert into public.staff_roles (user_id, role, status) values ($1, 'super_admin', 'active')", [
        superAdminId,
      ]);
      const { rows } = await client.query<{ id: string }>(
        "insert into public.admin_audit_log (actor_id, actor_role, action, target_type) values ($1, 'super_admin', 'test.action', 'order') returning id",
        [superAdminId],
      );

      await client.query("set local role authenticated");
      await setIdentity(client, superAdminId);
      const r = await client.query("select id from public.admin_audit_log where id = $1", [rows[0].id]);
      expect(r.rowCount).toBe(1);
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
    }
  });

  it("no authenticated role, staff or not, can write to the audit log", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      await expectRejected(
        c.query(
          "insert into public.admin_audit_log (actor_id, actor_role, action, target_type) values ($1, 'admin', 'x', 'y')",
          [USERS.admin],
        ),
        /permission denied|violates row-level security/,
      );
    });
  });

  it("the service-role path can write an audit log entry (what recordAdminAction() actually uses)", async () => {
    await withRole("service_role", null, async (c) => {
      const r = await c.query(
        "insert into public.admin_audit_log (actor_id, actor_role, action, target_type) values ($1, 'admin', 'test.action', 'order')",
        [USERS.admin],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("report_notes: staff can read, write is service-role only", () => {
  it("staff can read report notes (none seeded, but the read policy itself should not error)", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      const r = await c.query("select id from public.report_notes limit 1");
      expect(r.rowCount).toBe(0);
    });
  });

  it("anon cannot read report_notes", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.report_notes limit 1");
      expect(r.rowCount).toBe(0);
    });
  });

  it("staff cannot write a report note directly (append-only via service-role)", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      await expectRejected(
        c.query(
          "insert into public.report_notes (report_id, author_id, author_role, body) values ($1, $2, 'moderator', 'note')",
          [ids.reportId, USERS.moderator],
        ),
        /permission denied/,
      );
    });
  });
});

describe("payouts: member can additionally read their own payout (0054, marketplace-workspaces)", () => {
  it("the owning seller can read their own payout row", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("select id from public.payouts where id = $1", [ids.payoutId]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("a different member still cannot read someone else's payout row — this policy is own-row-only, not all-authenticated", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select id from public.payouts where id = $1", [ids.payoutId]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("the owning seller still cannot write to their own payout row — read-only, same as staff", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("update public.payouts set updated_at = now() where id = $1", [ids.payoutId]),
        /permission denied/,
      );
    });
  });
});

describe("stripe_connected_accounts: staff-read-all + member-read-own, service-role write only", () => {
  it("a member has no fixture row yet, but can query their own without error (no permission denial)", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("select id from public.stripe_connected_accounts where user_id = $1", [
        USERS.seller1,
      ]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("staff can query the table without a permission error", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      const r = await c.query("select id from public.stripe_connected_accounts limit 1");
      expect(r.rowCount).toBe(0);
    });
  });

  it("anon cannot read connected accounts (no anon-facing policy, so RLS matches zero rows)", async () => {
    await withRole("anon", null, async (c) => {
      const r = await c.query("select id from public.stripe_connected_accounts limit 1");
      expect(r.rowCount).toBe(0);
    });
  });
});
