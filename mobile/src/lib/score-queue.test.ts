import { describe, expect, it } from "vitest";

import { isNetworkError } from "./score-queue-rules";

describe("isNetworkError", () => {
  it("treats a refusal from the database as final", () => {
    expect(isNetworkError({ message: "This round has finished.", code: "P0001" })).toBe(false);
    expect(isNetworkError({ message: "permission denied", code: "42501" })).toBe(false);
  });
  it("treats a request that never arrived as a lost connection", () => {
    expect(isNetworkError({ message: "TypeError: Network request failed", code: "" })).toBe(true);
    expect(isNetworkError(new TypeError("Network request failed"))).toBe(true);
  });
  it("is false for nothing", () => {
    expect(isNetworkError(null)).toBe(false);
  });
});
