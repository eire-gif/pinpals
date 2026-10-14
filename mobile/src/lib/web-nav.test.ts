import { describe, expect, it } from "vitest";
import { decideWebNav, isPinPalsUrl } from "./web-nav";

describe("decideWebNav", () => {
  it("keeps PinPals pages in the app, with or without www", () => {
    expect(decideWebNav("https://www.pinpals.ie/admin/advertising?pp_shell=1")).toBe("stay");
    expect(decideWebNav("https://pinpals.ie/two-step")).toBe("stay");
    expect(decideWebNav("https://www.pinpals.ie/auth/app-session?token_hash=x&next=%2Fadmin")).toBe("stay");
    expect(decideWebNav("about:blank")).toBe("stay");
  });

  it("isn't fooled by look-alike hosts", () => {
    expect(isPinPalsUrl("https://www.pinpals.ie.evil.com/login")).toBe(false);
    expect(isPinPalsUrl("https://evilpinpals.ie/")).toBe(false);
    expect(isPinPalsUrl("http://www.pinpals.ie/")).toBe(false);
    expect(decideWebNav("https://www.pinpals.ie.evil.com/login")).toBe("external");
  });

  it("sends other sites to the phone's browser", () => {
    expect(decideWebNav("https://checkout.stripe.com/c/pay/cs_test")).toBe("external");
    expect(decideWebNav("https://advertiser.example/offer")).toBe("external");
    expect(decideWebNav("mailto:hello@pinpals.ie")).toBe("external");
  });

  it("loads https iframes in place and blocks script URLs", () => {
    expect(decideWebNav("https://js.stripe.com/v3/elements", false)).toBe("stay");
    expect(decideWebNav("javascript:alert(1)")).toBe("block");
    expect(decideWebNav("not a url")).toBe("block");
  });

  it("allows the host the build points at (staging)", () => {
    expect(decideWebNav("https://staging.example.dev/admin", true, "staging.example.dev")).toBe("stay");
  });
});
