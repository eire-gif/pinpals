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
