import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT, passwordProblem } from "./passwords";

const repoRoot = path.join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), "utf-8");

describe("passwordProblem", () => {
  it("accepts anything at or above the minimum", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(passwordProblem("three random golf words")).toBeNull();
  });

  it("rejects anything below it, naming the actual number", () => {
    const problem = passwordProblem("a".repeat(MIN_PASSWORD_LENGTH - 1));
    expect(problem).not.toBeNull();
    expect(problem).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it("rejects an empty password", () => {
    expect(passwordProblem("")).not.toBeNull();
  });

  it("imposes no composition rules — a long passphrase of plain words passes", () => {
    expect(passwordProblem("bunker approach fairway")).toBeNull();
  });

  it("keeps the hint and the rule in step", () => {
    expect(PASSWORD_HINT).toContain(String(MIN_PASSWORD_LENGTH));
  });
});

/**
 * These are guard tests, not unit tests. They exist because the two
 * failures they describe are silent, are only visible in production, and
 * both happened once already:
 *
 *   - sign-up was raised to 10 while reset-password stayed at 6;
 *   - a length check on the login path would lock out every member whose
 *     password predates the current minimum.
 *
 * Reading the source is the only way to assert either from a unit test.
 */
describe("where the password minimum is allowed to apply", () => {
  it("the login path never imports the password rules", () => {
    // Supabase Auth applies strengthened requirements at sign-up and
    // password change, not at sign-in — an existing member with a shorter
    // password must keep working. If this fails, someone has added a
    // length check to login and is about to lock members out.
    const loginAction = read("src/app/login/actions.ts");
    expect(loginAction).not.toContain("@/lib/passwords");
    expect(loginAction).not.toMatch(/password\.length\s*[<>]/);
    expect(loginAction).not.toContain("MIN_PASSWORD_LENGTH");
  });

  it("the login path does not treat a weak-password warning as a failed sign-in", () => {
    // On a successful sign-in, supabase-js returns `weakPassword` inside
    // `data` with `error` null (GoTrueClient signInWithPassword) — the
    // session is already saved by then. Turning that into an error message
    // would refuse entry to a member the auth server just let in.
    const loginAction = read("src/app/login/actions.ts");
    expect(loginAction).not.toMatch(/if\s*\(\s*(data\.)?weakPassword\s*\)/);
  });

  it("sign-up and password reset use the same minimum", () => {
    const signupAction = read("src/app/signup/actions.ts");
    const resetAction = read("src/app/reset-password/actions.ts");
    const resetForm = read("src/app/reset-password/reset-password-form.tsx");
    const signupForm = read("src/app/signup/signup-form.tsx");

    for (const [name, source] of [
      ["signup action", signupAction],
      ["reset action", resetAction],
      ["reset form", resetForm],
      ["signup form", signupForm],
    ] as const) {
      expect(source, `${name} should import the shared rule`).toContain("@/lib/passwords");
      // No hand-written numeric minimum left behind to drift.
      expect(source, `${name} should not hard-code a length`).not.toMatch(/length\s*<\s*\d/);
      expect(source, `${name} should not hard-code minLength`).not.toMatch(/minLength=\{\d+\}/);
    }
  });
});
