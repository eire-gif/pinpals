import { describe, expect, it } from "vitest";
import { postIdFromShareToken, postIdsInText, postWebUrl, routeForLink } from "./share-links";

// A token as the website makes it: base64url({"p":42,"s":"…","v":1}).<sig>
const token = `${Buffer.from(JSON.stringify({ p: 42, s: "00000000-0000-0000-0000-000000000001", v: 1 })).toString("base64url")}.c2lnbmF0dXJl`;

describe("share links", () => {
  it("builds a post's web address", () => {
    expect(postWebUrl("https://www.pinpals.ie/", 7)).toBe("https://www.pinpals.ie/feed/7");
  });

  it("reads the post id from a share token", () => {
    expect(postIdFromShareToken(token)).toBe(42);
    expect(postIdFromShareToken("not-a-token")).toBeNull();
    expect(postIdFromShareToken(`${Buffer.from('{"p":"42","v":1}').toString("base64url")}.x`)).toBeNull();
  });

  it("routes post and share links to the post screen, and leaves others alone", () => {
    expect(routeForLink("/feed/123")).toBe("/post/123");
    expect(routeForLink("https://www.pinpals.ie/feed/123?utm=x")).toBe("/post/123");
    expect(routeForLink(`/s/${token}`)).toBe("/post/42");
    expect(routeForLink("/s/garbage.token")).toBe("/feed");
    expect(routeForLink("/feed")).toBeNull();
    expect(routeForLink("/invite/9")).toBeNull();
  });

  it("finds linked posts in a message, once each", () => {
    expect(
      postIdsInText(`Look at this https://www.pinpals.ie/feed/12 and https://pinpals.ie/s/${token} and again https://pinpals.ie/feed/12`)
    ).toEqual([12, 42]);
    expect(postIdsInText("https://example.com/feed/12")).toEqual([]);
  });
});
