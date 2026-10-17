import { describe, expect, it } from "vitest";

import { engagementLine, reactionSummary, shareAddress } from "./reaction-summary";

describe("reactionSummary", () => {
  it("names one other member and counts the rest", () => {
    expect(reactionSummary(12, false, "Seán Byrne")).toBe("Seán Byrne and 11 others");
    expect(reactionSummary(2, false, "Seán Byrne")).toBe("Seán Byrne and 1 other");
    expect(reactionSummary(1, false, "Seán Byrne")).toBe("Seán Byrne");
  });

  it("puts the viewer first", () => {
    expect(reactionSummary(1, true, null)).toBe("You");
    expect(reactionSummary(2, true, "Aoife Kelly")).toBe("You and Aoife Kelly");
    expect(reactionSummary(5, true, "Aoife Kelly")).toBe("You, Aoife Kelly and 3 others");
    expect(reactionSummary(4, true, null)).toBe("You and 3 others");
  });

  it("falls back to the number when nobody can be named, and says nothing for none", () => {
    expect(reactionSummary(3, false, null)).toBe("3");
    expect(reactionSummary(0, false, null)).toBe("");
  });
});

describe("engagementLine", () => {
  it("leaves out zeros and uses singulars", () => {
    expect(engagementLine(4, 2)).toBe("4 comments · 2 shares");
    expect(engagementLine(1, 0)).toBe("1 comment");
    expect(engagementLine(0, 1)).toBe("1 share");
    expect(engagementLine(0, 0)).toBe("");
  });
});

describe("shareAddress", () => {
  const url = "https://pinpals.ie/s/abc";
  it("hands WhatsApp and Messages the words and the link together", () => {
    expect(shareAddress("whatsapp", "On PinPals", url, "ios")).toBe(
      `whatsapp://send?text=${encodeURIComponent(`On PinPals\n${url}`)}`
    );
    expect(shareAddress("messages", "On PinPals", url, "ios")?.startsWith("sms:&body=")).toBe(true);
    expect(shareAddress("messages", "On PinPals", url, "android")?.startsWith("sms:?body=")).toBe(true);
  });

  it("gives Facebook only the link, which it previews", () => {
    expect(shareAddress("facebook", "On PinPals", url, "ios")).toBe(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`
    );
  });

  it("leaves copy link and More to the app", () => {
    expect(shareAddress("copy_link", "x", url, "ios")).toBeNull();
    expect(shareAddress("other", "x", url, "ios")).toBeNull();
  });
});
