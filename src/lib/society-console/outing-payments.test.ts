import { describe, expect, it } from "vitest";

import { compactIban, formatIban, ibanIsValid, normaliseRevtag, paymentReference, payWays, revolutUrl } from "./outing-payments";

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
