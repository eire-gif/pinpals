import { describe, it, expect } from "vitest";
import { discardableUser } from "./discard-new-account";

const now = Date.UTC(2026, 9, 28, 18, 0, 0);
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("which new accounts 'Use your existing account' may remove", () => {
  it("a day-old Apple or Google account", () => {
    expect(discardableUser({ app_metadata: { provider: "apple", providers: ["apple"] }, created_at: ago(3600_000) }, now)).toBe(true);
    expect(discardableUser({ app_metadata: { provider: "google", providers: ["google"] }, created_at: ago(86400_000) }, now)).toBe(true);
  });

  it("never an account with a password, or an old one", () => {
    expect(discardableUser({ app_metadata: { provider: "email", providers: ["email", "google"] }, created_at: ago(3600_000) }, now)).toBe(false);
    expect(discardableUser({ app_metadata: { provider: "apple", providers: ["apple"] }, created_at: ago(8 * 86400_000) }, now)).toBe(false);
    expect(discardableUser({ app_metadata: {}, created_at: ago(1000) }, now)).toBe(false);
  });
});
