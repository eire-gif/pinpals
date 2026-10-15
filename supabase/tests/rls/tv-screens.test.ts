// 0147 tv_screens: clubhouse TV pairing codes are server only. No member,
// signed in or not, can list codes, read a TV's secret hash, or pair a code
// by writing the row directly — only the website's service-role routes can.
import { afterAll, describe, expect, it } from "vitest";
import { closePool, expectRejected, pool, withRole } from "./harness";
import { USERS } from "./fixtures";

afterAll(closePool);

const row = `('K7Q4MP', repeat('a', 64), now() + interval '10 minutes')`;

describe("tv_screens: no client access", () => {
  it("a signed-in member can't read codes", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(c.query("select code from public.tv_screens"));
    });
  });

  it("anon can't read codes", async () => {
    await withRole("anon", null, async (c) => {
      await expectRejected(c.query("select code from public.tv_screens"));
    });
  });

  it("nobody can make or pair a code directly", async () => {
    await withRole("authenticated", USERS.buyer1, async (c) => {
      await expectRejected(c.query(`insert into public.tv_screens (code, secret_hash, expires_at) values ${row}`));
      await expectRejected(c.query("update public.tv_screens set linked_at = now()"));
    });
    await withRole("anon", null, async (c) => {
      await expectRejected(c.query(`insert into public.tv_screens (code, secret_hash, expires_at) values ${row}`));
    });
  });

  it("RLS is on, as a second guard behind the revoked grants", async () => {
    const r = await pool.query("select relrowsecurity from pg_class where oid = 'public.tv_screens'::regclass");
    expect(r.rows[0].relrowsecurity).toBe(true);
  });
});
