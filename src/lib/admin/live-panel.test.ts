import { describe, expect, it } from "vitest";
import { ago, canSeeLivePanel, changeVsYesterday, formatLabel } from "./live-panel";

describe("canSeeLivePanel", () => {
  it("is super admin only", () => {
    expect(canSeeLivePanel({ role: "super_admin", status: "active" })).toBe(true);
    expect(canSeeLivePanel({ role: "admin", status: "active" })).toBe(false);
    expect(canSeeLivePanel({ role: "super_admin", status: "disabled" })).toBe(false);
    expect(canSeeLivePanel(null)).toBe(false);
  });
});

describe("changeVsYesterday", () => {
  it("compares with the same time yesterday", () => {
    expect(changeVsYesterday(5, 5)?.dir).toBe("same");
    expect(changeVsYesterday(6, 4)).toEqual({ dir: "up", text: "+50% vs this time yesterday" });
    expect(changeVsYesterday(2, 4)).toEqual({ dir: "down", text: "-50% vs this time yesterday" });
    expect(changeVsYesterday(3, 0)).toEqual({ dir: "up", text: "+3 vs none by now yesterday" });
    expect(changeVsYesterday(3, undefined)).toBeNull();
  });
});

describe("ago", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  it("reads naturally", () => {
    expect(ago("2026-10-17T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-10-17T11:56:00Z", now)).toBe("4 min ago");
    expect(ago("2026-10-17T10:00:00Z", now)).toBe("2 h ago");
    expect(ago(null, now)).toBe("");
  });
});

describe("formatLabel", () => {
  it("names formats", () => {
    expect(formatLabel("stableford")).toBe("Stableford");
    expect(formatLabel("texas_scramble")).toBe("Texas scramble");
  });
});

describe("activity drill-down", () => {
  it("parses kinds and ranges safely", async () => {
    const { parseActivityKind, parseActivityRange, activityHref } = await import("./live-panel");
    expect(parseActivityKind("groups")).toBe("groups");
    expect(parseActivityKind("nope")).toBe("scorecards");
    expect(parseActivityRange(undefined)).toBe("today");
    expect(parseActivityRange("7d")).toBe("7d");
    expect(activityHref("tee_times")).toBe("/admin/activity?show=tee_times");
    expect(activityHref("groups", "yesterday")).toBe("/admin/activity?show=groups&range=yesterday");
  });

  it("finds Irish midnight in summer and winter", async () => {
    const { irishMidnight, activityWindow } = await import("./live-panel");
    // Summer time (UTC+1): midnight in Dublin is 23:00 UTC the day before.
    expect(irishMidnight(new Date("2026-10-17T14:00:00Z")).toISOString()).toBe("2026-10-16T23:00:00.000Z");
    // 00:30 UTC on the 17th is already the 17th in Dublin.
    expect(irishMidnight(new Date("2026-10-16T23:30:00Z")).toISOString()).toBe("2026-10-16T23:00:00.000Z");
    // Winter (UTC+0).
    expect(irishMidnight(new Date("2026-12-05T10:00:00Z")).toISOString()).toBe("2026-12-05T00:00:00.000Z");
    const now = new Date("2026-10-17T14:00:00Z");
    expect(activityWindow("yesterday", now).from.toISOString()).toBe("2026-10-15T23:00:00.000Z");
    expect(activityWindow("7d", now).from.toISOString()).toBe("2026-10-10T23:00:00.000Z");
  });
});

describe("cardSummary", () => {
  it("totals the holes played", async () => {
    const { cardSummary, toParText } = await import("./live-panel");
    const s = cardSummary(
      [
        { hole: 1, par: 4, strokes: 5, putts: 2 },
        { hole: 2, par: 3, strokes: 3, putts: 1 },
        { hole: 3, par: 5, strokes: null },
      ],
      18,
    );
    expect(s).toEqual({ gross: 8, played: 2, toPar: 1, complete: false, putts: 3 });
    expect(toParText(0)).toBe("E");
    expect(toParText(3)).toBe("+3");
    expect(toParText(-1)).toBe("-1");
  });
});
