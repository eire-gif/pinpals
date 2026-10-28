import { describe, it, expect } from "vitest";
import { hasPassword, isSocialProvider, signedInRecently } from "./social-providers";

describe("social sign-in helpers", () => {
  it("only an email identity means a password", () => {
    expect(hasPassword({ identities: [{ provider: "email" }] })).toBe(true);
    expect(hasPassword({ identities: [{ provider: "google" }, { provider: "email" }] })).toBe(true);
    expect(hasPassword({ identities: [{ provider: "apple" }] })).toBe(false);
    expect(hasPassword({ identities: null })).toBe(false);
  });

  it("a recent sign-in is within 15 minutes", () => {
    const now = Date.UTC(2026, 9, 28, 9, 0, 0);
    expect(signedInRecently({ last_sign_in_at: new Date(now - 5 * 60_000).toISOString() }, now)).toBe(true);
    expect(signedInRecently({ last_sign_in_at: new Date(now - 20 * 60_000).toISOString() }, now)).toBe(false);
    expect(signedInRecently({ last_sign_in_at: null }, now)).toBe(false);
  });

  it("takes only the two providers", () => {
    expect(isSocialProvider("google")).toBe(true);
    expect(isSocialProvider("apple")).toBe(true);
    expect(isSocialProvider("github")).toBe(false);
  });
});
