import { describe, expect, it } from "vitest";

import { buildOutingP, closeDaysFor, feeText, parseMeals, type EventFields } from "./events-form";

const base: EventFields = {
  kind: "day",
  title: "Captain's Day",
  clubId: 12,
  clubName: "Portmarnock Golf Club",
  course: null,
  playsOn: "2026-11-20",
  endsOn: null,
  location: null,
  firstTee: "9:00",
  fee: "60",
  max: "40",
  details: "",
  entryMode: "join",
  waitingList: true,
  autoOffer: true,
  guestsAllowed: true,
  guestFee: "",
  closeDays: "0",
  arriveBy: "08:30",
  formatLabel: "Stableford",
  dressCode: "",
  meals: "Beef, Salmon, Beef, ",
  revtag: "@Geoff.Walsh",
  iban: "",
  accountName: "",
  payCash: true,
  payNote: "",
};
const today = "2026-10-15";

describe("buildOutingP", () => {
  it("builds the app's payload for a day out", () => {
    const r = buildOutingP(base, { money: true, today });
    if ("error" in r) throw new Error(r.error);
    expect(r.p).toMatchObject({
      kind: "day",
      club_id: 12,
      course_name: "Portmarnock Golf Club",
      ends_on: null,
      location: null,
      first_tee: "09:00",
      entry_fee_cents: 6000,
      max_entries: 40,
      pay_revtag: "geoff.walsh",
      pay_iban: null,
      entries_close_at: null,
      guest_fee_cents: null,
      meal_options: ["Beef", "Salmon"],
    });
  });

  it("asks for the course on a day out, and a valid last day on a trip", () => {
    expect(buildOutingP({ ...base, clubId: null, clubName: null, course: "" }, { money: true, today })).toEqual({ error: "Choose the course" });
    expect(buildOutingP({ ...base, kind: "abroad", endsOn: "2026-11-19" }, { money: true, today })).toEqual({ error: "The last day is after the first" });
    expect(buildOutingP({ ...base, kind: "abroad", endsOn: "2026-12-30" }, { money: true, today })).toEqual({ error: "A trip is three weeks at most" });
  });

  it("drops what a trip doesn't have", () => {
    const r = buildOutingP({ ...base, kind: "overnight", endsOn: "2026-11-22", location: " Ballybunion " }, { money: true, today });
    if ("error" in r) throw new Error(r.error);
    expect(r.p).toMatchObject({ club_id: null, course_name: null, first_tee: null, arrive_by: null, meal_options: [], location: "Ballybunion", ends_on: "2026-11-22" });
  });

  it("checks payment details only for the money area", () => {
    expect(buildOutingP({ ...base, iban: "IE29 AIBK 9311 5212 3456 79" }, { money: true, today })).toEqual({ error: "That IBAN doesn't look right — check the numbers" });
    expect(buildOutingP({ ...base, iban: "IE29 AIBK 9311 5212 3456 78" }, { money: true, today })).toEqual({ error: "Add the name on the bank account" });
    const r = buildOutingP({ ...base, revtag: "not valid!!" }, { money: false, today });
    if ("error" in r) throw new Error(r.error);
    expect(r.p.pay_revtag).toBeNull();
  });

  it("closes entries N days before", () => {
    const r = buildOutingP({ ...base, closeDays: "3" }, { money: true, today });
    if ("error" in r) throw new Error(r.error);
    // Midnight at the start of 18 Nov, Irish time (GMT in November).
    expect(r.p.entries_close_at).toBe("2026-11-18T00:00:00.000Z");
    expect(closeDaysFor("2026-11-20", r.p.entries_close_at)).toBe(3);
    expect(closeDaysFor("2026-11-20", null)).toBe(0);
  });

  it("refuses a past date and a bad fee", () => {
    expect(buildOutingP({ ...base, playsOn: "2026-10-14" }, { money: true, today })).toEqual({ error: "Choose a date from today on" });
    expect(buildOutingP({ ...base, fee: "sixty" }, { money: true, today })).toEqual({ error: "The cost should be an amount, like 60" });
  });
});

describe("helpers", () => {
  it("formats and parses", () => {
    expect(feeText(6050)).toBe("60.50");
    expect(feeText(6000)).toBe("60");
    expect(parseMeals(" a, b ,, a")).toEqual(["a", "b"]);
  });
});
