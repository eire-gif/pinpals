// 0193_social_sign_in.sql — joining with Sign in with Apple / Google.
//
// What must hold:
//   - a Google sign-up's name lands on the profile; an Apple one (no name)
//     gets the "New Golfer" placeholder the app then replaces
//   - a new Apple/Google account is held as junior_pending — signed in,
//     nothing else, hidden like a minor — until it saves a date of birth
//   - saving the date releases the hold and the date decides the band; the
//     13 minimum still applies (the account then stays held)
//   - a sign-up from the form is never held
//   - the hold and Apple's tokens are unreachable from a browser
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRole, closePool } from "./harness";

afterAll(closePool);

const yearsAgo = (years: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

async function signUp(c: PoolClient, id: string, provider: string, meta: Record<string, unknown>): Promise<void> {
  await c.query(
    `insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
     values ($1, $2, $3::jsonb, $4::jsonb)`,
    [id, `${id.slice(-4)}@example.test`, JSON.stringify({ provider, providers: [provider] }), JSON.stringify(meta)],
  );
}

async function band(c: PoolClient, id: string): Promise<string> {
  const r = await c.query<{ b: string }>("select public.age_band_of($1) as b", [id]);
  return r.rows[0].b;
}

describe("joining with Apple or Google", () => {
  it("takes Google's name and holds the account until a date of birth is saved", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query("reset role");
      const id = "00000000-0000-0000-0000-0000000000b1";
      await signUp(c, id, "google", { full_name: "Seán Ó Briain", email: "x@example.test" });

      const profile = await c.query("select first_name, last_name from public.profiles where id = $1", [id]);
      expect(profile.rows[0]).toEqual({ first_name: "Seán", last_name: "Ó Briain" });
      expect(await band(c, id)).toBe("junior_pending");
      const minor = await c.query<{ m: boolean }>("select public.is_minor($1) as m", [id]);
      expect(minor.rows[0].m).toBe(true);

      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
      await c.query("set local role authenticated");
      await c.query("select public.set_my_date_of_birth($1::date)", [yearsAgo(40)]);
      await c.query("reset role");

      expect(await band(c, id)).toBe("adult");
      const held = await c.query("select 1 from public.member_dob_required where user_id = $1", [id]);
      expect(held.rowCount).toBe(0);
    });
  });

  it("an Apple sign-up with no name gets the placeholder; under 13 stays held", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query("reset role");
      const id = "00000000-0000-0000-0000-0000000000b2";
      await signUp(c, id, "apple", {});

      const profile = await c.query("select first_name, last_name from public.profiles where id = $1", [id]);
      expect(profile.rows[0]).toEqual({ first_name: "New", last_name: "Golfer" });

      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
      await c.query("set local role authenticated");
      await c.query("savepoint attempt");
      await expect(c.query("select public.set_my_date_of_birth($1::date)", [yearsAgo(11)])).rejects.toThrow(/13 or over/);
      await c.query("rollback to savepoint attempt");
      await c.query("reset role");

      expect(await band(c, id)).toBe("junior_pending");
    });
  });

  it("never holds a sign-up from the form", async () => {
    await withRole("service_role", null, async (c) => {
      await c.query("reset role");
      const id = "00000000-0000-0000-0000-0000000000b3";
      await signUp(c, id, "email", { first_name: "Mary", last_name: "Byrne", date_of_birth: yearsAgo(30) });
      expect(await band(c, id)).toBe("adult");
      const held = await c.query("select 1 from public.member_dob_required where user_id = $1", [id]);
      expect(held.rowCount).toBe(0);
    });
  });

  it("keeps the hold and Apple's tokens out of a browser's reach", async () => {
    await withRole("authenticated", "00000000-0000-0000-0000-0000000000b1", async (c) => {
      for (const table of ["member_dob_required", "apple_sign_in_tokens"]) {
        await c.query("savepoint attempt");
        await expect(c.query(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
        await c.query("rollback to savepoint attempt");
      }
    });
  });
});
