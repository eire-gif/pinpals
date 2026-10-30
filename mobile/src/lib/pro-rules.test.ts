import { describe, expect, it } from "vitest";

import { cancelOutcome, clock, dublinParts, euroCents, groupSlots, hoursLine, lessonPhase, lessonWhen, policyLine, proTake, untilText } from "./pro-rules";

const booked = (x: object = {}) => ({
  status: "booked" as const,
  payment_status: "paid" as const,
  starts_at: "2026-11-10T11:30:00Z",
  ends_at: "2026-11-10T12:30:00Z",
  price_cents: 8000,
  free_cancel_until: "2026-11-08T11:30:00Z",
  ...x,
});

describe("book a pro rules", () => {
  it("money: 10% to PinPals, euros without stray cents", () => {
    expect(proTake(8000)).toBe(7200);
    expect(proTake(4500)).toBe(4050);
    expect(euroCents(8000)).toBe("€80");
    expect(euroCents(4050)).toBe("€40.50");
  });

  it("reads the clock in Ireland, summer and winter", () => {
    expect(dublinParts("2026-11-03T11:30:00Z")).toMatchObject({ dayKey: "2026-11-03", dow: "Tue", day: 3, month: "Nov", time: "11:30" });
    expect(dublinParts("2026-07-03T08:00:00Z").time).toBe("9:00");
    expect(lessonWhen("2026-11-03T11:30:00Z")).toBe("Tue 3 Nov, 11:30");
    // 23:30 UTC on a summer night is already tomorrow in Ireland.
    expect(dublinParts("2026-07-03T23:30:00Z").dayKey).toBe("2026-07-04");
  });

  it("groups free times by Irish day, in order", () => {
    const days = groupSlots(["2026-11-04T10:00:00Z", "2026-11-03T09:00:00Z", "2026-11-03T09:30:00Z"]);
    expect(days.map((d) => d.dayKey)).toEqual(["2026-11-03", "2026-11-04"]);
    expect(days[0].times.map((t) => t.time)).toEqual(["9:00", "9:30"]);
  });

  it("counts days until by the calendar", () => {
    const now = new Date("2026-11-03T22:00:00Z");
    expect(untilText("2026-11-03T23:00:00Z", now)).toBe("Today");
    expect(untilText("2026-11-04T08:00:00Z", now)).toBe("Tomorrow");
    expect(untilText("2026-11-07T08:00:00Z", now)).toBe("In 4 days");
  });

  it("cancelling: the golfer in time gets it all; late gets nothing; the pro always refunds", () => {
    expect(cancelOutcome(booked(), false, new Date("2026-11-07T10:00:00Z")).refundCents).toBe(8000);
    expect(cancelOutcome(booked(), false, new Date("2026-11-09T10:00:00Z")).refundCents).toBe(0);
    expect(cancelOutcome(booked({ free_cancel_until: null }), false, new Date("2026-11-01T10:00:00Z")).refundCents).toBe(0);
    expect(cancelOutcome(booked(), true, new Date("2026-11-10T10:00:00Z"))).toMatchObject({ allowed: true, refundCents: 8000 });
    expect(cancelOutcome(booked(), true, new Date("2026-11-10T12:00:00Z")).allowed).toBe(false);
    expect(cancelOutcome(booked({ status: "cancelled" }), false).allowed).toBe(false);
  });

  it("phases", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    expect(lessonPhase(booked(), now)).toBe("upcoming");
    expect(lessonPhase(booked(), new Date("2026-11-11T00:00:00Z"))).toBe("done");
    expect(lessonPhase(booked({ status: "pending_payment", payment_status: "unpaid", hold_until: "2026-11-05T10:10:00Z" }), now)).toBe("paying");
    expect(lessonPhase(booked({ status: "pending_payment", payment_status: "unpaid", hold_until: "2026-11-05T09:50:00Z" }), now)).toBe("expired");
  });

  it("words", () => {
    expect(policyLine("48h", "Pat")).toContain("up to 48 hours before");
    expect(policyLine("none", "Pat")).toContain("doesn't refund");
    expect(clock(570)).toBe("9:30");
    expect(hoursLine([{ weekday: 0, start_min: 540, end_min: 1020 }, { weekday: 5, start_min: 480, end_min: 720 }])).toBe("Mon 9:00–17:00 · Sat 8:00–12:00");
  });
});
