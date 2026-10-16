import { describe, expect, it } from "vitest";

import { focusedInvite } from "./tee-time-focus";

describe("focusedInvite", () => {
  it("reads a tee time id", () => {
    expect(focusedInvite("12")).toBe(12);
    expect(focusedInvite(["7", "8"])).toBe(7);
  });
  it("ignores anything that isn't one", () => {
    expect(focusedInvite(undefined)).toBeNull();
    expect(focusedInvite("")).toBeNull();
    expect(focusedInvite("0")).toBeNull();
    expect(focusedInvite("12abc")).toBeNull();
    expect(focusedInvite("-3")).toBeNull();
  });
});
