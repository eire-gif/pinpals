import { describe, expect, it } from "vitest";

import { dueSentence, feeInput, parseMembershipDraft, type MembershipDraft } from "./membership-form";

const base: MembershipDraft = { enabled: true, fee: "80", startMonth: "1", dueAfter: "30", policy: "allow", revtag: "", iban: "", accountName: "", cash: true, note: "" };

describe("parseMembershipDraft", () => {
  it("reads a plain draft", () => {
    expect(parseMembershipDraft(base)).toEqual({
      enabled: true,
      feeCents: 8000,
      seasonStartMonth: 1,
      dueAfterDays: 30,
      unpaidPolicy: "allow",
      payRevtag: null,
      payIban: null,
      payAccountName: null,
      payCash: true,
      payNote: null,
    });
  });
  it("needs a fee when membership is on", () => {
    expect(parseMembershipDraft({ ...base, fee: "" })).toHaveProperty("error");
    expect(parseMembershipDraft({ ...base, fee: "eighty" })).toHaveProperty("error");
  });
  it("lets the fee go when membership is off", () => {
    const r = parseMembershipDraft({ ...base, enabled: false, fee: "x" });
    expect(r).toMatchObject({ enabled: false, feeCents: null });
  });
  it("tidies the Revolut name and IBAN", () => {
    const r = parseMembershipDraft({ ...base, revtag: "@Geoff.Walsh", iban: "ie29 aibk 9311 5212 3456 78", accountName: " Geoff Walsh " });
    expect(r).toMatchObject({ payRevtag: "geoff.walsh", payIban: "IE29AIBK93115212345678", payAccountName: "Geoff Walsh" });
  });
  it("refuses a bad IBAN, or one with no account name", () => {
    expect(parseMembershipDraft({ ...base, iban: "IE29AIBK93115212345679", accountName: "X" })).toHaveProperty("error");
    expect(parseMembershipDraft({ ...base, iban: "IE29AIBK93115212345678" })).toHaveProperty("error");
  });
  it("refuses odd months, due days and policies", () => {
    expect(parseMembershipDraft({ ...base, startMonth: "13" })).toHaveProperty("error");
    expect(parseMembershipDraft({ ...base, dueAfter: "45" })).toHaveProperty("error");
    expect(parseMembershipDraft({ ...base, policy: "surcharge" })).toHaveProperty("error");
  });
});

describe("feeInput and dueSentence", () => {
  it("writes the fee back", () => {
    expect(feeInput(8000)).toBe("80");
    expect(feeInput(6550)).toBe("65.50");
    expect(feeInput(null)).toBe("");
  });
  it("says when it's due", () => {
    expect(dueSentence(0, "January")).toBe("Due on 1 January each season.");
    expect(dueSentence(30, "April")).toBe("Due 30 days after 1 April each season.");
  });
});
