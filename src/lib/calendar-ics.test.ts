import { describe, expect, it } from "vitest";

import { buildIcs, signCalendarToken, tzForCountry, verifyCalendarToken, zonedToUtc, type CalEvent } from "./calendar-ics";

const EV: CalEvent = {
  uid: "tee-time-42",
  title: "Golf at Portmarnock Golf Club",
  date: "2026-10-11",
  time: "09:00",
  tz: "Europe/Dublin",
  durationMin: 270,
  location: "Portmarnock Golf Club, Dublin",
  description: "PinPals tee time with Stephen, Guy; and you",
  url: "https://www.pinpals.ie/invite/42",
};

describe("calendar events", () => {
  it("turns a time at the course into the right instant, summer and winter", () => {
    expect(zonedToUtc("2026-10-11", "09:00", "Europe/Dublin").toISOString()).toBe("2026-10-11T08:00:00.000Z");
    expect(zonedToUtc("2026-12-05", "09:00", "Europe/Dublin").toISOString()).toBe("2026-12-05T09:00:00.000Z");
    expect(zonedToUtc("2026-10-11", "09:00", "Europe/Madrid").toISOString()).toBe("2026-10-11T07:00:00.000Z");
    expect(tzForCountry("portugal")).toBe("Europe/Lisbon");
    expect(tzForCountry(null)).toBe("Europe/Dublin");
  });

  it("writes a valid event with a reminder, text escaped", () => {
    const ics = buildIcs(EV, new Date("2026-10-10T12:00:00Z"));
    expect(ics).toContain("DTSTART:20261011T080000Z\r\n");
    expect(ics).toContain("DTEND:20261011T123000Z\r\n");
    expect(ics).toContain("SUMMARY:Golf at Portmarnock Golf Club\r\n");
    expect(ics).toContain("LOCATION:Portmarnock Golf Club\\, Dublin");
    expect(ics).toContain("Stephen\\, Guy\; and you");
    expect(ics).toContain("TRIGGER:-PT60M");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });

  it("a day without a time is an all-day event", () => {
    const ics = buildIcs({ ...EV, time: null });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261011");
    expect(ics).toContain("DTEND;VALUE=DATE:20261012");
    expect(ics).not.toContain("VALARM");
  });

  it("the link only works signed, unaltered and in date", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const token = signCalendarToken(EV, now, "s3cret");
    expect(verifyCalendarToken(token, now, "s3cret")).toEqual(EV);
    expect(verifyCalendarToken(token, now, "other")).toBeNull();
    const [p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), title: "x" })).toString("base64url");
    expect(verifyCalendarToken(`${forged}.${s}`, now, "s3cret")).toBeNull();
    expect(verifyCalendarToken(token, now + 8 * 24 * 3600 * 1000, "s3cret")).toBeNull();
  });
});
