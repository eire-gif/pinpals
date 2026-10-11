import { describe, expect, it } from "vitest";

import { irishToday, pickFocus } from "@/lib/widget-data";

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
