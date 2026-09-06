// Not one of the 8 explicit rules, but 0045's other hardening fix
// (prevent_notification_tampering — the "mark as read" UPDATE policy could
// otherwise rewrite title/body/type/data, not just read_at).
import { describe, it, expect, afterAll } from "vitest";
import { withRole, expectRejected, expectZeroRows, closePool } from "./harness";
import { USERS } from "./fixtures";
import { fixtureIds } from "./ids";

const ids = fixtureIds();

afterAll(closePool);

describe("notifications: SELECT (own notifications only)", () => {
  it("the owner can read their own notification", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("select id from public.notifications where id = $1", [ids.notificationId]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("nobody else can read it, including staff", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("select id from public.notifications where id = $1", [ids.notificationId]);
      expect(r.rowCount).toBe(0);
    });
    await withRole("authenticated", USERS.admin, async (c) => {
      const r = await c.query("select id from public.notifications where id = $1", [ids.notificationId]);
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("notifications: INSERT/DELETE (system-populated only)", () => {
  it("the owner cannot insert their own notification", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query(
          "insert into public.notifications (user_id, type, title) values ($1, 'fake', 'Fake notification')",
          [USERS.seller1],
        ),
        /permission denied/,
      );
    });
  });

  it("the owner cannot delete their own notification", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("delete from public.notifications where id = $1", [ids.notificationId]),
        /permission denied/,
      );
    });
  });
});

describe("notifications: UPDATE (owner may flip read_at only; nothing else)", () => {
  it("the owner can mark their own notification read", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      const r = await c.query("update public.notifications set read_at = now() where id = $1", [
        ids.notificationId,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("the owner cannot rewrite the notification's title/body/type/data via the same policy", async () => {
    await withRole("authenticated", USERS.seller1, async (c) => {
      await expectRejected(
        c.query("update public.notifications set title = 'Tampered' where id = $1", [ids.notificationId]),
        /may only have read_at updated/,
      );
    });
  });

  it("an unrelated user cannot mark someone else's notification read", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      const r = await c.query("update public.notifications set read_at = now() where id = $1", [
        ids.notificationId,
      ]);
      expectZeroRows(r);
    });
  });

  it("the service-role path (system population) is unrestricted by the tamper-prevention trigger", async () => {
    await withRole("service_role", null, async (c) => {
      const r = await c.query("update public.notifications set title = 'Updated by system' where id = $1", [
        ids.notificationId,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });
});
