// 0156_memberships.sql — membership settings, the feature catalogue and
// member entitlements.
//
// What must hold:
//   - members can't write any membership table, can't read the settings or
//     catalogue directly, and read only their own entitlement; staff read all
//   - my_feature_access(): while paid plans are OFF every feature that isn't
//     'off' is allowed — for everybody, Basic included
//   - with paid plans ON: premium needs Premium or Pro, pro needs Pro, free is
//     free, off is nobody; a lapsed entitlement is Basic
//   - the "free until" launch date keeps everything free while it lasts
//   - keep_for_existing lets members who joined before the feature went paid
//     keep it, and nobody who joins after
//   - my_membership() reports my level and the switch; anon can't call either
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, setIdentity, closePool, expectRejected } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const MEMBER = USERS.buyer1;
const OTHER = USERS.buyer2;

async function asService<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("set local role authenticated");
  }
}

/** The suite's setup truncates every table (settings row and catalogue too), so each test builds its own. */
async function setUp(c: PoolClient, opts: { enabled: boolean; freeUntil?: string | null }) {
  await asService(c, async () => {
    await c.query(
      `insert into public.membership_settings (id, paid_plans_enabled, free_until) values (true, $1, $2)
       on conflict (id) do update set paid_plans_enabled = excluded.paid_plans_enabled, free_until = excluded.free_until`,
      [opts.enabled, opts.freeUntil ?? null],
    );
    await c.query(
      `insert into public.membership_features (key, group_key, name, access) values
         ('t_free', 'scoring', 'Free thing', 'free'),
         ('t_off', 'scoring', 'Off thing', 'off'),
         ('t_premium', 'scoring', 'Premium thing', 'premium'),
         ('t_pro', 'societies', 'Pro thing', 'pro')
       on conflict (key) do update set access = excluded.access, keep_for_existing = false`,
    );
  });
}

async function grant(c: PoolClient, member: string, tier: "premium" | "pro", expiresInHours: number | null = null) {
  await asService(c, () =>
    c.query(
      `insert into public.member_entitlements (member_id, tier, source, expires_at)
       values ($1, $2, 'staff_grant', case when $3::int is null then null else now() + make_interval(hours => $3::int) end)
       on conflict (member_id) do update set tier = excluded.tier, expires_at = excluded.expires_at`,
      [member, tier, expiresInHours],
    ),
  );
}

async function access(c: PoolClient, member: string): Promise<Record<string, boolean>> {
  await setIdentity(c, member);
  const { rows } = await c.query<{ key: string; allowed: boolean }>("select key, allowed from public.my_feature_access()");
  return Object.fromEntries(rows.filter((r) => r.key.startsWith("t_")).map((r) => [r.key, r.allowed]));
}

describe("membership tables", () => {
  it("members can't write settings, features or entitlements", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await setUp(c, { enabled: false });
      for (const sql of [
        "update public.membership_settings set paid_plans_enabled = true",
        "update public.membership_features set access = 'free'",
        `insert into public.member_entitlements (member_id, tier, source) values ('${MEMBER}', 'pro', 'staff_grant')`,
      ]) {
        await c.query("savepoint s");
        await expectRejected(c.query(sql), /permission denied/);
        await c.query("rollback to savepoint s");
      }
    });
  });

  it("members read only their own entitlement, and not the settings or catalogue directly", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await setUp(c, { enabled: true });
      await grant(c, MEMBER, "premium");
      await grant(c, OTHER, "pro");
      const mine = await c.query("select member_id from public.member_entitlements");
      expect(mine.rows.map((r) => r.member_id)).toEqual([MEMBER]);
      expect((await c.query("select * from public.membership_features")).rowCount).toBe(0);
      expect((await c.query("select * from public.membership_settings")).rowCount).toBe(0);
    });
  });

  it("staff read everything", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      await setUp(c, { enabled: false });
      await grant(c, MEMBER, "premium");
      expect((await c.query("select * from public.membership_features where key like 't_%'")).rowCount).toBe(4);
      expect((await c.query("select * from public.member_entitlements")).rowCount).toBe(1);
    });
  });

  it("anon can't call the membership functions", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(c.query("select * from public.my_feature_access()"), /permission denied/);
    });
  });
});

describe("my_feature_access()", () => {
  it("with paid plans OFF, everything that isn't off is free for everyone", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await setUp(c, { enabled: false });
      expect(await access(c, MEMBER)).toEqual({ t_free: true, t_off: false, t_premium: true, t_pro: true });
    });
  });

  it("with paid plans ON, levels apply", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await setUp(c, { enabled: true });
      expect(await access(c, MEMBER)).toEqual({ t_free: true, t_off: false, t_premium: false, t_pro: false });
      await grant(c, MEMBER, "premium");
      expect(await access(c, MEMBER)).toEqual({ t_free: true, t_off: false, t_premium: true, t_pro: false });
      await grant(c, MEMBER, "pro");
      expect(await access(c, MEMBER)).toEqual({ t_free: true, t_off: false, t_premium: true, t_pro: true });
    });
  });

  it("a lapsed subscription is Basic", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await setUp(c, { enabled: true });
      await grant(c, MEMBER, "pro", -1);
      expect(await access(c, MEMBER)).toMatchObject({ t_premium: false, t_pro: false });
      await setIdentity(c, MEMBER);
      const { rows } = await c.query("select tier from public.my_membership()");
      expect(rows[0].tier).toBe("basic");
    });
  });

  it("the launch offer keeps everything free until its date", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await setUp(c, { enabled: true, freeUntil: "2999-01-01" });
      expect(await access(c, MEMBER)).toMatchObject({ t_premium: true, t_pro: true, t_off: false });
      await setUp(c, { enabled: true, freeUntil: "2000-01-01" });
      expect(await access(c, MEMBER)).toMatchObject({ t_premium: false, t_pro: false });
    });
  });

  it("keep for existing members: joined before it went paid keeps it, joined after doesn't", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await setUp(c, { enabled: true });
      await asService(c, async () => {
        await c.query("update public.profiles set created_at = now() - interval '30 days' where id = $1", [MEMBER]);
        await c.query("update public.profiles set created_at = now() + interval '1 day' where id = $1", [OTHER]);
        await c.query("update public.membership_features set keep_for_existing = true where key = 't_premium'");
      });
      expect((await access(c, MEMBER)).t_premium).toBe(true);
      expect((await access(c, OTHER)).t_premium).toBe(false);
    });
  });

  it("stamps when paid plans went live and when a feature went paid", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await setUp(c, { enabled: false });
      const row = await asService(c, async () => {
        await c.query("update public.membership_features set access = 'free' where key = 't_premium'");
        await c.query("update public.membership_features set access = 'premium' where key = 't_premium'");
        await c.query("update public.membership_settings set paid_plans_enabled = true");
        const f = await c.query("select paywalled_at from public.membership_features where key = 't_premium'");
        const s = await c.query("select paid_plans_since from public.membership_settings");
        await c.query("update public.membership_settings set paid_plans_enabled = false");
        const off = await c.query("select paid_plans_since from public.membership_settings");
        return { f: f.rows[0].paywalled_at, s: s.rows[0].paid_plans_since, off: off.rows[0].paid_plans_since };
      });
      expect(row.f).not.toBeNull();
      expect(row.s).not.toBeNull();
      expect(row.off).toBeNull();
    });
  });

  it("my_membership() reports my level and the switch", async () => {
    await withRole("authenticated", MEMBER, async (c) => {
      await setUp(c, { enabled: false });
      await grant(c, MEMBER, "premium");
      await setIdentity(c, MEMBER);
      const { rows } = await c.query("select tier, paid_plans_enabled, premium_annual_price from public.my_membership()");
      expect(rows).toEqual([{ tier: "premium", paid_plans_enabled: false, premium_annual_price: "€34.99" }]);
    });
  });
});
