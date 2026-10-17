// 0161 live activity: nobody but the service role (the website's server)
// may record a ping or read the live numbers. Not members, not staff in their
// own session, not anon — the admin panel reads through /admin/live-stats
// after requireStaff().
import { describe, it, expect, afterAll } from "vitest";
import { withRole, expectRejected, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const SESSION = "rls-test-session-0001";

describe("live activity (0161)", () => {
  it("anon cannot record a ping or read the tables", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(c.query(`select public.record_activity($1, null, 'web', 'home', true)`, [SESSION]));
      await expectRejected(c.query(`select * from public.activity_sessions`));
      await expectRejected(c.query(`select * from public.app_installs`));
    });
  });

  it("a member cannot mark anyone online or read who is online", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(c.query(`select public.record_activity($1, $2, 'web', 'home', true)`, [SESSION, USERS.buyer1]));
      await expectRejected(c.query(`select * from public.activity_sessions`));
      await expectRejected(c.query(`select * from public.activity_views`));
    });
  });

  it("staff in their own session cannot call the stats function directly", async () => {
    await withRole("authenticated", USERS.admin, async (c) => {
      await expectRejected(c.query(`select public.admin_live_stats()`));
    });
  });

  it("the service role records pings and reads the numbers", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query(`select public.record_activity($1, $2, 'ios', 'live', true, 'rls-test-install-0001', '1.0.0')`, [SESSION, USERS.buyer1]);
      await c.query(`select public.record_activity($1, null, 'ios', 'marketplace', false, 'rls-test-install-0001', '1.0.0')`, [SESSION]);
      const s = await c.query(`select member_id, section from public.activity_sessions where session_key = $1`, [SESSION]);
      expect(s.rows[0]).toEqual({ member_id: USERS.buyer1, section: "marketplace" });
      const stats = await c.query(`select public.admin_live_stats() as j`);
      const j = stats.rows[0].j;
      expect(j.now.online).toBeGreaterThanOrEqual(1);
      expect(j.now.by_section.marketplace).toBeGreaterThanOrEqual(1);
      expect(j.installs.ios).toBeGreaterThanOrEqual(1);
      expect(j.today.views).toBeGreaterThanOrEqual(1);
    });
  });

  it("a session can't switch platform once started", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query(`select public.record_activity('rls-test-session-0002', null, 'web', 'home', true)`);
      await c.query(`select public.record_activity('rls-test-session-0002', null, 'android', 'live', false)`);
      const s = await c.query(`select platform, section from public.activity_sessions where session_key = 'rls-test-session-0002'`);
      expect(s.rows[0]).toEqual({ platform: "web", section: "home" });
    });
  });
});
