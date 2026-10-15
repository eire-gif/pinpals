import { describe, expect, it } from "vitest";

import {
  activeConsoleHref,
  areasFor,
  canSee,
  consoleNav,
  euros,
  indexLabel,
  parseClock,
  parseDate,
  parseIndex,
  positiveInt,
  roleLabel,
  SOCIETY_AREAS,
  timeLeft,
} from "./rules";

describe("areasFor — matches 0144's society_can", () => {
  it("gives the owner, captain and secretary everything", () => {
    expect(areasFor("owner", null)).toEqual([...SOCIETY_AREAS]);
    expect(areasFor("admin", "captain")).toEqual([...SOCIETY_AREAS]);
    expect(areasFor("admin", "secretary")).toEqual([...SOCIETY_AREAS]);
  });
  it("gives each other office its own areas", () => {
    expect(areasFor("member", "vice_captain")).toEqual(["events", "messages"]);
    expect(areasFor("member", "event_organiser")).toEqual(["events", "messages"]);
    expect(areasFor("member", "treasurer")).toEqual(["money", "messages"]);
    expect(areasFor("member", "handicap_secretary")).toEqual(["handicaps"]);
  });
  it("gives an ordinary member nothing", () => {
    expect(areasFor("member", null)).toEqual([]);
    expect(areasFor(null, null)).toEqual([]);
  });
});

describe("the console sidebar", () => {
  const all = [...SOCIETY_AREAS];
  it("shows the captain and secretary every page", () => {
    const labels = consoleNav(7, "admin", all).flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toContain("Settings");
    expect(labels).toContain("Committee");
    expect(labels).toContain("Payments");
    expect(labels).toContain("Handicaps");
  });
  it("shows the treasurer money and messages, never settings or the committee", () => {
    const labels = consoleNav(7, "member", areasFor("member", "treasurer")).flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toEqual(expect.arrayContaining(["Overview", "Payments", "Annual membership", "Noticeboard", "Send a message", "Results"]));
    expect(labels).not.toContain("Settings");
    expect(labels).not.toContain("Committee");
    expect(labels).not.toContain("Events & entries");
    expect(labels).not.toContain("Members & requests");
  });
  it("shows the handicap secretary handicaps but not money", () => {
    const labels = consoleNav(7, "member", ["handicaps"]).flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toContain("Handicaps");
    expect(labels).not.toContain("Payments");
  });
  it("shows an ordinary member nothing at all", () => {
    expect(consoleNav(7, "member", [])).toEqual([]);
    expect(canSee({}, "member", [])).toBe(false);
  });
  it("links under /society/<id>", () => {
    expect(consoleNav(7, "owner", all)[0].items[0].href).toBe("/society/7");
  });
  it("lights up the closest page", () => {
    const nav = consoleNav(7, "owner", all);
    expect(activeConsoleHref("/society/7/events/12/draw", nav)).toBe("/society/7/events");
    expect(activeConsoleHref("/society/7", nav)).toBe("/society/7");
    expect(activeConsoleHref("/society/8/events", nav)).toBeNull();
  });
});

describe("labels and parsing", () => {
  it("labels roles", () => {
    expect(roleLabel("owner", "captain")).toBe("Owner · Captain");
    expect(roleLabel("member", "treasurer")).toBe("Treasurer");
    expect(roleLabel("member", null)).toBe("Member");
  });
  it("reads handicap indexes, including plus handicaps", () => {
    expect(parseIndex("")).toBeNull();
    expect(parseIndex("12.4")).toBe(12.4);
    expect(parseIndex("12,4")).toBe(12.4);
    expect(parseIndex("+2")).toBe(-2);
    expect(parseIndex("60")).toBeUndefined();
    expect(parseIndex("abc")).toBeUndefined();
    expect(indexLabel(-2)).toBe("+2.0");
    expect(indexLabel(null)).toBe("—");
  });
  it("reads times and dates", () => {
    expect(parseClock("08:30")).toBe("08:30");
    expect(parseClock("8:30")).toBeUndefined();
    expect(parseClock("")).toBeNull();
    expect(parseDate("2026-02-29")).toBeUndefined();
    expect(parseDate("2028-02-29")).toBe("2028-02-29");
  });
  it("reads ids", () => {
    expect(positiveInt("12")).toBe(12);
    expect(positiveInt("0")).toBeNull();
    expect(positiveInt("1.5")).toBeNull();
    expect(positiveInt("x")).toBeNull();
  });
  it("formats money and offers", () => {
    expect(euros(6050)).toBe("€60.50");
    expect(euros(null)).toBe("—");
    const now = new Date("2026-10-15T09:00:00Z");
    expect(timeLeft("2026-10-15T14:30:00Z", now)).toBe("5 hours left");
    expect(timeLeft("2026-10-15T08:00:00Z", now)).toBe("expired");
  });
});
