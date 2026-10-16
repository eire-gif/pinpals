import { describe, expect, it } from "vitest";

import { savedToPhotos, scorecardPhotoUrl } from "./scorecard-photo-url";

describe("scorecard photo url", () => {
  it("is the card's share link with /photo on the end", () => {
    expect(scorecardPhotoUrl("https://www.pinpals.ie/c/abc.def")).toBe("https://www.pinpals.ie/c/abc.def/photo");
    expect(scorecardPhotoUrl("https://www.pinpals.ie/c/abc.def/")).toBe("https://www.pinpals.ie/c/abc.def/photo");
    expect(scorecardPhotoUrl("https://www.pinpals.ie/c/abc.def?utm=x#top")).toBe("https://www.pinpals.ie/c/abc.def/photo");
  });
});

describe("saved to photos", () => {
  it("knows the share sheet's Save Image", () => {
    expect(savedToPhotos("com.apple.UIKit.activity.SaveToCameraRoll")).toBe(true);
    expect(savedToPhotos("net.whatsapp.WhatsApp.ShareExtension")).toBe(false);
    expect(savedToPhotos(null)).toBe(false);
    expect(savedToPhotos(undefined)).toBe(false);
  });
});
