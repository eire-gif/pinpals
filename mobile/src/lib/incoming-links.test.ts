import { describe, expect, it } from "vitest";

import { routeForIncomingUrl } from "./incoming-links";

describe("routeForIncomingUrl", () => {
  it("leaves anything that isn't a pinpals.ie https link alone", () => {
    expect(routeForIncomingUrl("pinpals://invite/3")).toBeNull();
    expect(routeForIncomingUrl("exp://192.168.0.2:8081/--/post/1")).toBeNull();
    expect(routeForIncomingUrl("https://evil.example.com/conversations/1")).toBeNull();
    expect(routeForIncomingUrl("https://pinpals.ie.evil.com/inbox")).toBeNull();
    expect(routeForIncomingUrl("http://pinpals.ie/inbox")).toBeNull();
  });

  it("opens notification-email links on native screens", () => {
    expect(routeForIncomingUrl("https://www.pinpals.ie/conversations/55")).toBe("/conversation/55");
    expect(routeForIncomingUrl("https://pinpals.ie/tee-times/interested")).toBe("/tee-time-requests");
    expect(routeForIncomingUrl("https://www.pinpals.ie/tee-times/requests")).toBe("/my-requests");
    expect(routeForIncomingUrl("https://www.pinpals.ie/tee-times")).toBe("/tee-times");
    expect(routeForIncomingUrl("https://www.pinpals.ie/dashboard/orders/88")).toBe("/order/88");
    expect(routeForIncomingUrl("https://www.pinpals.ie/marketplace/412?ref=email")).toBe("/listing/412");
    expect(routeForIncomingUrl("https://www.pinpals.ie/marketplace/new")).toBe("/new-listing");
    expect(routeForIncomingUrl("https://www.pinpals.ie/dashboard/")).toBe("/");
  });

  it("keeps posts, share links and invites working as before", () => {
    expect(routeForIncomingUrl("https://www.pinpals.ie/feed/12")).toBe("/post/12");
    expect(routeForIncomingUrl("https://www.pinpals.ie/invite/9")).toBe("/invite/9");
  });

  it("opens invite-friends links and shared scorecards in the app", () => {
    expect(routeForIncomingUrl("https://www.pinpals.ie/signup")).toBe("/signup");
    expect(routeForIncomingUrl("https://pinpals.ie/signup/")).toBe("/signup");
    // {"c":42,"s":"abc","v":1} as base64url, then a signature.
    const token = `${btoa(JSON.stringify({ c: 42, s: "abc", v: 1 })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.c2ln`;
    expect(routeForIncomingUrl(`https://www.pinpals.ie/c/${token}`)).toBe(`/card-link?token=${token}`);
    expect(routeForIncomingUrl("https://www.pinpals.ie/c/not-a-token.x")).toBe("/web?path=%2Fc%2Fnot-a-token.x&title=PinPals");
  });

  it("turns a sign-up confirmation into the app's confirm screen", () => {
    expect(routeForIncomingUrl("https://www.pinpals.ie/auth/confirm?token_hash=abc123&type=email")).toBe(
      "/auth-confirm?token_hash=abc123&type=email"
    );
    expect(
      routeForIncomingUrl("https://www.pinpals.ie/auth/confirm?token_hash=abc&type=email&next=/dashboard")
    ).toBe("/auth-confirm?token_hash=abc&type=email");
  });

  it("sends anything without a native screen to the signed-in web view", () => {
    expect(routeForIncomingUrl("https://www.pinpals.ie/dashboard/legal")).toBe(
      "/web?path=%2Fdashboard%2Flegal&title=PinPals"
    );
    expect(routeForIncomingUrl("https://www.pinpals.ie/auth/confirm?type=recovery&token_hash=x")).toBe(
      "/web?path=%2Fauth%2Fconfirm%3Ftype%3Drecovery%26token_hash%3Dx&title=PinPals"
    );
  });
});
