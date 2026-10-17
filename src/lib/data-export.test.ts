import { describe, expect, it } from "vitest";
import { EXPORT_SOURCES, exportFileName, scrubRow } from "./data-export";

describe("data export", () => {
  it("has one entry per section, each with a table, column and description", () => {
    const sections = EXPORT_SOURCES.map((s) => s.section);
    expect(new Set(sections).size).toBe(sections.length);
    for (const s of EXPORT_SOURCES) {
      expect(s.table).toMatch(/^[a-z_]+$/);
      expect(s.column).toMatch(/^[a-z_]+$/);
      expect(s.about.length).toBeGreaterThan(5);
    }
  });

  it("covers the member's private details", () => {
    const tables = new Set(EXPORT_SOURCES.map((s) => s.table));
    for (const t of ["profiles", "member_private", "member_birthdates", "member_phones", "messages", "orders"]) expect(tables.has(t)).toBe(true);
  });

  it("covers parent links and approved contacts (0159), without the link's secret", () => {
    const tables = new Set(EXPORT_SOURCES.map((s) => s.table));
    expect(tables.has("guardian_links")).toBe(true);
    expect(tables.has("junior_contacts")).toBe(true);
    expect(scrubRow({ id: 3, status: "approved", token_hash: "a".repeat(64) })).toEqual({ id: 3, status: "approved" });
  });

  it("never lets secrets or staff notes out", () => {
    const row = scrubRow({ id: 1, p256dh: "k", auth: "a", token: "t", invite_token: "x", share_secret: "s", key_hash: "h", moderation_note: "m", hidden_by: "u", title: "Driver" });
    expect(row).toEqual({ id: 1, title: "Driver" });
  });

  it("names the file by date and member", () => {
    expect(exportFileName("1234567890abcdef", new Date("2026-10-13T10:00:00Z"))).toBe("pinpals-my-data-2026-10-13-12345678.json");
  });
});
