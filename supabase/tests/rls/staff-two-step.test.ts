// 0135_staff_two_step.sql — staff powers need two-step sign-in.
//
// is_staff() is true only when the session passed the second step (aal2).
// The same staff member with a password-only session (aal1) is a member.
import { describe, it, expect, afterAll } from "vitest";
import { withRole, closePool } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

describe("is_staff() and two-step sign-in", () => {
  it("is true for active staff who passed the second step", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      await c.query("select set_config('request.jwt.claim.aal', 'aal2', true)");
      const { rows } = await c.query("select public.is_staff() as yes");
      expect(rows[0].yes).toBe(true);
    });
  });

  it("is false for the same staff member on a password-only session", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      await c.query("select set_config('request.jwt.claim.aal', 'aal1', true)");
      const { rows } = await c.query("select public.is_staff() as yes, public.is_staff(array['moderator']) as mod");
      expect(rows[0]).toEqual({ yes: false, mod: false });
    });
  });

  it("their own staff row is still readable, so the app can offer the Admin link", async () => {
    await withRole("authenticated", USERS.moderator, async (c) => {
      await c.query("select set_config('request.jwt.claim.aal', 'aal1', true)");
      const { rows } = await c.query("select role, status from public.staff_roles where user_id = $1", [USERS.moderator]);
      expect(rows).toEqual([{ role: "moderator", status: "active" }]);
    });
  });
});
