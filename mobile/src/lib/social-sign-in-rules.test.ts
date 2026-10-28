import { describe, it, expect } from "vitest";

import { isPlaceholderName, joinedWithProvider, readRedirectParams } from "./social-sign-in-rules";

describe("Sign in with Apple / Google rules", () => {
  it("spots the New Golfer stand-in and nothing else", () => {
    expect(isPlaceholderName("New", "Golfer")).toBe(true);
    expect(isPlaceholderName(" New ", "Golfer ")).toBe(true);
    expect(isPlaceholderName("New", "Byrne")).toBe(false);
    expect(isPlaceholderName(null, undefined)).toBe(false);
  });

  it("knows who joined with Apple or Google", () => {
    expect(joinedWithProvider({ app_metadata: { provider: "apple" } })).toBe(true);
    expect(joinedWithProvider({ app_metadata: { provider: "google" } })).toBe(true);
    expect(joinedWithProvider({ app_metadata: { provider: "email" } })).toBe(false);
    expect(joinedWithProvider(null)).toBe(false);
  });

  it("reads a code from the query and an error from the fragment", () => {
    expect(readRedirectParams("pinpals://auth-callback?code=abc").get("code")).toBe("abc");
    const p = readRedirectParams("pinpals://auth-callback#error=access_denied&error_description=x");
    expect(p.get("error")).toBe("access_denied");
    expect(readRedirectParams("pinpals://auth-callback").get("code")).toBeNull();
  });
});
