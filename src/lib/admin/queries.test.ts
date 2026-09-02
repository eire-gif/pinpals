import { describe, expect, it } from "vitest";
import { isUserSuspended } from "./queries";

describe("isUserSuspended", () => {
  it("is false when there's no ban on record", () => {
    expect(isUserSuspended({ banned_until: null })).toBe(false);
  });

  it("is true when banned_until is in the future", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isUserSuspended({ banned_until: future })).toBe(true);
  });

  it("is false when banned_until has already passed", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isUserSuspended({ banned_until: past })).toBe(false);
  });
});
