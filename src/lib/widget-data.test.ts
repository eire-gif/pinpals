import { describe, expect, it } from "vitest";

import { irishToday, pickFocus, secretFor } from "@/lib/widget-data";

describe("which game the widget shows", () => {
  const r = (id: number, status: string, played_on: string, created_at: string) => ({ id, status, played_on, created_at });
  it("prefers the newest live game", () => {
    expect(pickFocus([r(1, "live", "2026-10-11", "2026-10-11T08:00:00Z"), r(2, "live", "2026-10-11", "2026-10-11T09:00:00Z"), r(3, "finished", "2026-10-11", "2026-10-11T10:00:00Z")], "2026-10-11")?.id).toBe(2);
  });
  it("keeps today's finished game up, but not yesterday's", () => {
    expect(pickFocus([r(1, "finished", "2026-10-11", "2026-10-11T08:00:00Z")], "2026-10-11")?.id).toBe(1);
    expect(pickFocus([r(1, "finished", "2026-10-10", "2026-10-10T08:00:00Z")], "2026-10-11")).toBeNull();
  });
  it("uses the Irish date", () => {
    expect(irishToday(new Date("2026-10-10T23:30:00Z"))).toBe("2026-10-11");
    expect(irishToday(new Date("2026-01-10T23:30:00Z"))).toBe("2026-01-10");
  });
});

describe("a secret leaderboard on the widget and the watch", () => {
  const db = (organiser: boolean | "error") =>
    ({
      rpc: async () => (organiser === "error" ? { data: null, error: { message: "boom" } } : { data: organiser, error: null }),
    }) as never;
  const day = (hidden: boolean | null, createdBy: string | null = "org") => ({ id: 1, leaderboard_hidden: hidden, created_by: createdBy });

  it("is open when the day isn't secret, or to whoever started it", async () => {
    expect(await secretFor(db(false), day(false), "me")).toBe(false);
    expect(await secretFor(db(false), day(null), "me")).toBe(false);
    expect(await secretFor(db(false), day(true, "me"), "me")).toBe(false);
  });
  it("is open to the society event's officers, secret to everyone else — and secret if the check fails", async () => {
    expect(await secretFor(db(true), day(true), "me")).toBe(false);
    expect(await secretFor(db(false), day(true), "me")).toBe(true);
    expect(await secretFor(db("error"), day(true), "me")).toBe(true);
  });
});
