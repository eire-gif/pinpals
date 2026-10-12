import { describe, expect, it } from "vitest";

import { compactIban, formatIban, ibanIsValid, normaliseRevtag, paymentReference, payWays, revolutUrl } from "./outing-payments";
import { outingShareText } from "./outing-share";

describe("Revolut", () => {
  it("tidies the username and builds the link", () => {
    expect(normaliseRevtag(" @Geoff.Walsh ")).toBe("geoff.walsh");
    expect(normaliseRevtag("")).toBeNull();
    expect(normaliseRevtag("geoff walsh")).toBeUndefined();
    expect(revolutUrl("geoff.walsh")).toBe("https://revolut.me/geoff.walsh");
  });
});

describe("IBAN", () => {
  it("checks the check digits and formats in fours", () => {
    expect(ibanIsValid("IE29 AIBK 9311 5212 3456 78")).toBe(true);
    expect(ibanIsValid("ie29aibk93115212345678")).toBe(true);
    expect(ibanIsValid("IE29 AIBK 9311 5212 3456 79")).toBe(false); // one digit wrong
    expect(ibanIsValid("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(ibanIsValid("12345")).toBe(false);
    expect(compactIban(" ie29 aibk ")).toBe("IE29AIBK");
    expect(formatIban("IE29AIBK93115212345678")).toBe("IE29 AIBK 9311 5212 3456 78");
  });
});

describe("paying", () => {
  it("makes a reference banks accept", () => {
    expect(paymentReference("Kerry November", "Geoff Walsh")).toBe("Kerry November – Geoff Walsh");
    expect(paymentReference("Portmarnock Thursday Society Algarve 2027", "Geoff Walsh").length).toBeLessThanOrEqual(35);
  });

  it("lists the ways to pay", () => {
    expect(payWays({ payRevtag: "g", payIban: "IE", payCash: true })).toEqual(["revolut", "transfer", "cash"]);
    expect(payWays({ payRevtag: null, payIban: null, payCash: false })).toEqual([]);
  });
});

describe("sharing", () => {
  it("a trip says where, when and which courses — never who or how much", () => {
    const text = outingShareText(
      {
        kind: "abroad",
        title: "Algarve 2027",
        playsOn: "2027-05-13",
        endsOn: "2027-05-16",
        location: "Vale do Lobo, Portugal",
        courseName: null,
        societyName: "Portmarnock Thursday Society",
        courses: ["Quinta do Lago South", "Vale do Lobo Royal", "Monte Rei", "Vale do Lobo Royal"],
      },
      "https://www.pinpals.ie/"
    );
    expect(text).toBe(
      [
        "✈️ Algarve 2027",
        "13–16 May 2027 · Vale do Lobo, Portugal",
        "Golf trip abroad with Portmarnock Thursday Society · 4 rounds.",
        "Playing Quinta do Lago South, Vale do Lobo Royal & Monte Rei.",
        "",
        "Organised on PinPals 👉 www.pinpals.ie",
      ].join("\n")
    );
  });

  it("a day out, and a trip across months", () => {
    const day = outingShareText({ kind: "day", title: "Captain's Day", playsOn: "2026-11-14", endsOn: null, location: null, courseName: "The Island", societyName: null, courses: [] }, "https://www.pinpals.ie");
    expect(day.split("\n").slice(0, 2)).toEqual(["⛳ Captain's Day", "Sat 14 Nov 2026 · The Island"]);
    const trip = outingShareText({ kind: "overnight", title: "Kerry", playsOn: "2027-04-30", endsOn: "2027-05-02", location: null, courseName: null, societyName: null, courses: [] }, "https://www.pinpals.ie");
    expect(trip.split("\n")[1]).toBe("30 Apr – 2 May 2027");
  });
});
