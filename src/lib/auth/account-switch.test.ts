import { describe, it, expect } from "vitest";
import { postedParams, sameOrigin, switchPageUrl, switchRoute } from "./account-switch";

describe("switchPageUrl", () => {
  it("carries the route and only the sign-in parameters", () => {
    const u = switchPageUrl(
      new URL("https://www.pinpals.ie/auth/confirm?token_hash=abc&type=email&next=/x&evil=1"),
    );
    expect(u.pathname).toBe("/auth/switch");
    expect(u.searchParams.get("route")).toBe("/auth/confirm");
    expect(u.searchParams.get("token_hash")).toBe("abc");
    expect(u.searchParams.get("type")).toBe("email");
    expect(u.searchParams.get("next")).toBe("/x");
    expect(u.searchParams.has("evil")).toBe(false);
  });
});

describe("switchRoute", () => {
  it("allows only our two sign-in routes", () => {
    expect(switchRoute("/auth/confirm")).toBe("/auth/confirm");
    expect(switchRoute("/auth/app-session")).toBe("/auth/app-session");
    expect(switchRoute("https://evil.example/auth/confirm")).toBeNull();
    expect(switchRoute("/admin")).toBeNull();
    expect(switchRoute(undefined)).toBeNull();
  });
});

describe("sameOrigin", () => {
  const post = (origin?: string) =>
    new Request("https://www.pinpals.ie/auth/confirm", {
      method: "POST",
      headers: origin ? { origin } : {},
    });

  it("accepts a post from our own page", () => {
    expect(sameOrigin(post("https://www.pinpals.ie"))).toBe(true);
  });

  it("refuses another site, a lookalike, or no Origin at all", () => {
    expect(sameOrigin(post("https://evil.example"))).toBe(false);
    expect(sameOrigin(post("https://www.pinpals.ie.evil.example"))).toBe(false);
    expect(sameOrigin(post("null"))).toBe(false);
    expect(sameOrigin(post())).toBe(false);
  });
});

describe("postedParams", () => {
  it("keeps the sign-in fields and drops anything else", async () => {
    const body = new URLSearchParams({ token_hash: "abc", type: "email", sneaky: "1" });
    const req = new Request("https://www.pinpals.ie/auth/confirm", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const p = await postedParams(req);
    expect(p.get("token_hash")).toBe("abc");
    expect(p.get("type")).toBe("email");
    expect(p.has("sneaky")).toBe(false);
  });
});
